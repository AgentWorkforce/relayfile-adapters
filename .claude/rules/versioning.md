# Versioning

When this applies: any PR that touches `packages/*/package.json` or that changes a path-mapper helper's output shape.

## Never bump `version` in a feature PR

The `version` field in `packages/<adapter>/package.json` is bumped by the publish workflow (`.github/workflows/publish.yml`, `workflow_dispatch`), not by the PR that introduces the change. The pattern in commit history is:

1. Open a feature PR with the source change only — leave `version` fields untouched.
2. After merge, run the publish workflow. It performs the version bump and the npm publish in lockstep.

### Failure mode this prevents

If you bump a version in a feature PR before the publish workflow runs, downstream consumers (e.g. the `cloud` repo) may pin to a version that has not yet been published. Their `npm install` then fails on a missing tarball, blocking deploys until the publish workflow catches up. Always leave the bump to the release flow.

## Path-mapper changes are additive

If you change the output of a path-mapper helper:

- Add the new helper alongside the old one (export both).
- JSDoc-deprecate the old helper with a one-line replacement note.
- Or: implement reader-side back-compat — try the new path, fall back to the old.

NEVER remove or change a helper's output in a single PR. Downstream readers (cloud sync workers, agent consumers) may still be on the old version and will silently miss records if the path moves without a deprecation window.

## Cross-repo bumps

After a path-mapper or LAYOUT.md change ships and is published, mention in the PR body:

- That `cloud` (or any other consumer) needs a dep bump on the new version.
- Whether a full provider resync is required (typically yes for path-mapper changes, no for LAYOUT-only changes).
