/**
 * Publish a reviewed submission, in one command.
 *
 * It existed as four: export three environment variables, approve, commit, push.
 * Every one of them had to be right, and getting the site bucket wrong produced a
 * catalogue entry whose file was never uploaded — a tool that listed and 404ed.
 * Making that unreachable is the point of this script, not saving keystrokes.
 *
 *   npm run publish -- --latest
 *   npm run publish -- <submission-id>
 *
 * The names come from Terraform state rather than from this file, so there is one
 * source of truth for them and no chance of a stale copy.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...opts });

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const target = process.argv.slice(2);
if (target.length === 0) {
  die('usage: npm run publish -- --latest | <submission-id>');
}

// Terraform is asked once, and the answer is passed down. Reading state per value
// would be three times the wait for no benefit.
let outputs;
try {
  outputs = JSON.parse(run('terraform', ['-chdir=terraform', 'output', '-json']));
} catch {
  die(
    'could not read terraform outputs.\n' +
      '  run: terraform -chdir=terraform init -backend-config=backend.hcl\n' +
      '  and make sure AWS_PROFILE is set (mimawsi).',
  );
}

const value = (name) => {
  const found = outputs[name]?.value;
  if (!found) {
    die(`terraform output "${name}" is missing — has the infrastructure been applied?`);
  }
  return found;
};

const env = {
  ...process.env,
  MIMAWSI_BUCKET: value('pending_bucket'),
  MIMAWSI_SITE_BUCKET: value('site_bucket'),
  MIMAWSI_RUNNER_DISTRIBUTION: value('runner_distribution'),
};

// The working tree is checked before anything is published. Committing whatever
// happened to be uncommitted, under a message about publishing a tool, is how
// unrelated changes reach production described as something else.
const dirty = run('git', ['status', '--porcelain']).trim();
if (dirty !== '') {
  die(`working tree is not clean, so a publish commit would carry other changes:\n${dirty}`);
}

process.stdout.write('reviewing…\n');
const approved = run('npm', ['run', 'review', '--silent', '--', 'approve', ...target], { env });
process.stdout.write(`  ${approved.trim()}\n`);

const title = approved.match(/\(([^)]+)\)\s*$/)?.[1] ?? 'a tool';

// Only the catalogue index is expected to change: tool bytes are gitignored and
// went to S3 during the approve. Anything else means the approve did something
// unexpected, and committing it blindly would hide that.
const changed = run('git', ['status', '--porcelain']).trim();
if (changed === '') {
  die('nothing changed — was that submission already published?');
}
const unexpected = changed
  .split('\n')
  .map((line) => line.slice(3))
  .filter((path) => path !== 'packages/site/src/data/published.json');
if (unexpected.length > 0) {
  die(`approve changed files it should not have:\n  ${unexpected.join('\n  ')}`);
}

process.stdout.write('publishing…\n');
run('git', ['add', 'packages/site/src/data/published.json']);
run('git', ['commit', '-m', `Publish ${title}`]);
run('git', ['push', 'origin', 'HEAD']);

process.stdout.write(`\npublished ${title}. CI is deploying it now.\n`);
