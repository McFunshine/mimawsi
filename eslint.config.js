import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The rules that catch defects, and the rules that hold the architecture.
 *
 * Style is not here. Biome formats, and a formatter that runs on every commit
 * settles those questions without anybody arguing about them. What is left is the
 * two kinds of rule that earn the time they cost:
 *
 *   - correctness rules that need type information, which is where the real bugs
 *     in an async, S3-backed codebase are;
 *   - the dependency boundaries from RULE-48, which until now were not enforced
 *     by anything.
 *
 * Deliberately small. Every rule that fires on correct code teaches people to
 * reach for a disable comment, and that habit does not stay confined to the rules
 * that deserved it.
 */

/**
 * RULE-48, actually enforced.
 *
 * The rule says the workspace dependency graph encodes the security boundaries,
 * and gives its reason as: breaching them "cannot be done without editing a
 * package.json, which is visible in review".
 *
 * That is not true of npm. Workspaces hoist to the root node_modules, so
 * `packages/domain` — which declares no dependencies at all — can import
 * `@aws-sdk/client-s3` today and it resolves, typechecks and runs. Probed on
 * 2026-09-06; it passed. The boundary the project believed was mechanical was an
 * honour-system rule with a package.json next to it.
 *
 * These restrictions are what makes the claim true. They are expressed as "what
 * may this package NOT import", because an allowlist would have to be revisited
 * every time a legitimate internal dependency is added, and a rule people edit
 * routinely is one they stop reading.
 */
const AWS_SDK = { group: ['@aws-sdk/*', 'aws-sdk'], message: '' };

const forbid = (patterns, why) =>
  patterns.map((p) => ({ ...(typeof p === 'string' ? { group: [p] } : p), message: why }));

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.astro/**',
      '**/*.astro',
      'terraform/**',
      'packages/site/dist/**',
      'spikes/**',
      // Generated or vendored: linting them reports on decisions nobody here made.
      'packages/lambdas/dist/**',
      'playwright-transform-cache-*/**',
      'node-compile-cache/**',
      'mimawsi-maker-*/**',
      'tests/playwright-report/**',
      'tests/test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // ---- The rules that catch defects ------------------------------------
      //
      // This codebase is read-modify-write against S3 in several places. A
      // promise that is created and not awaited loses a write and reports
      // nothing, which no unit test reliably catches because the process usually
      // exits before the rejection surfaces.
      '@typescript-eslint/no-floating-promises': 'error',
      // An async function handed to something expecting a synchronous callback
      // runs, rejects into nowhere, and the caller carries on as though it
      // succeeded. Every event handler in the pages is a candidate.
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // Off, deliberately. This codebase is built on ports whose methods return
      // Promise<T>, so every fake that satisfies one has async methods with
      // nothing to await — correct code, by design, that this rule reports. A rule
      // that fires on the architecture teaches people to disable rules.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // `any` erases the checking the rest of this relies on. Warned rather than
      // errored: it is occasionally the honest type at a boundary, and an error
      // there would be answered with a disable comment rather than a better type.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // ---- Style, which is Biome's job -------------------------------------
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  // Plain scripts. Node runs these directly and they are outside every tsconfig,
  // so the type-aware rules have nothing to work from. Syntax and correctness
  // rules still apply; the type-aware ones are simply not available here.
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Explicitly off. The type-checked config above turns projectService on for
      // everything, and these files are in no tsconfig — so without this they fail
      // to parse at all and report nothing about themselves.
      parserOptions: { projectService: false, project: null },
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
      },
    },
  },

  // ---- RULE-48: the dependency graph is the security boundary --------------

  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbid(
            [AWS_SDK, '@mimawsi/*'],
            'RULE-48: domain depends on nothing. It is the vocabulary the catalogue, ' +
              'the Lambdas and the pipeline all speak, and it stays speakable by all of ' +
              'them only while it drags none of their dependencies behind it.',
          ),
        },
      ],
    },
  },

  {
    files: ['packages/ports/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbid(
            [AWS_SDK, '@mimawsi/adapters-*', '@mimawsi/lambdas', '@mimawsi/site'],
            'RULE-48: ports may depend on domain alone. A port that knows what is ' +
              'behind it is not a port, and the contract suite stops being evidence ' +
              'that the fake and the real adapter are interchangeable.',
          ),
        },
      ],
    },
  },

  {
    files: ['packages/site/**/*.ts', 'packages/runner/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbid(
            [AWS_SDK, '@mimawsi/adapters-*', '@mimawsi/ports', '@mimawsi/publisher'],
            'RULE-48: the catalogue may depend on domain alone. It holds no ' +
              'credentials, and it cannot hold any as long as it cannot reach the ' +
              'code that would use them.',
          ),
        },
      ],
    },
  },

  {
    // Everything that is not an AWS adapter. The SDK belongs in exactly one place;
    // publisher is the exception the workspace graph already grants it.
    files: ['packages/**/*.ts'],
    ignores: ['packages/adapters-aws/**', 'packages/publisher/**', 'packages/lambdas/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbid(
            [AWS_SDK],
            'RULE-48: only adapters-aws may reach the AWS SDK. This is the boundary ' +
              'that lets phase 0 run on a laptop and every later phase be a swap — ' +
              'and npm hoisting means nothing but this rule prevents the import.',
          ),
        },
      ],
    },
  },

  // CloudFront Functions. `handler` is the entry point AWS calls by name, so it is
  // exported and never referenced by anything in this repository — which is what
  // an unused export looks like to a linter.
  {
    files: ['infra/cloudfront/**/*.js'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },

  // Tests describe behaviour and are allowed to be blunt about it.
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Playwright fixtures are declared `async ({}, use)` — the empty pattern is
      // its API, not an oversight.
      'no-empty-pattern': 'off',
      // `expect(mock.send)` is how vitest assertions are written. The scoping
      // hazard this warns about does not exist for a vi.fn.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
