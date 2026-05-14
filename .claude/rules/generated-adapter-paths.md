# Generated adapter paths

When this applies: adding or editing generated mapping YAML, workflow prompts, README path examples, discovery docs, or `path-mapper.ts` for any adapter.

## Generated templates can be stale

Do not trust generated examples that emit `/<provider>/<resource>/<id>/metadata.json`. That shape is legacy scaffolding from early adapters. The adapter contract wins.

Before merging:

1. Decide whether the entity owns child files.
2. If it owns child files, emit `<id>__<slug>/meta.json`.
3. If it does not own child files, emit `<slug>__<id>.json` or `<id>.json` when there is no useful slug.
4. Update every path example in mapping YAML, README, workflow prompts, discovery docs, and writeback tracking docs.
5. Add path-mapper tests that assert the canonical shape and a back-compat parser test for any old shape consumers may still read.

## GitLab-specific warning

GitLab merge requests, issues, pipelines, and commits all own child files:

- merge requests: `diff.patch`, `discussions/*.json`, `approvals.json`
- issues: `comments/*.json`
- pipelines: `jobs/*.json`
- commits: `comments/*.json`

These must never emit `metadata.json` as their canonical path.
