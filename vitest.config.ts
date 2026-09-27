import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `scripts/` as well as `packages/`: add-to-catalogue.mjs runs in CI on every
    // publish and was untested until a typo in it left a tool in the catalogue
    // with its collection missing.
    include: ['packages/**/*.{test,contract.test}.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
