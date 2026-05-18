// Repo-scoped Vitest config.
//
// Without this file, Vitest walks up the directory tree and picks up the
// workspace-level config at ../vitest.config.mjs, whose
// `include: ['packages/**/*.test.ts']` collects every adapter's `*.test.ts`
// file. Those suites are written for Node's built-in test runner
// (`node --test`, run via `npm test` / turbo), not Vitest, so Vitest reports
// "No test suite found in file" for all 231 of them and exits non-zero.
//
// The only genuine Vitest suite in this repo is the core round-trip harness.
// Scope `include` to it so `npx vitest run` exercises the real Vitest tests
// and passes, while the node:test suites continue to run under their own
// runner.
export default {
  test: {
    include: ['packages/core/tests/round-trip/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: true,
  },
};
