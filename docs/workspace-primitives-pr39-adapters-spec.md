# Workspace Primitive Skills PR 39 — Adapters Slice

Status: ready
Created: 2026-05-16
Parent spec: relayfile/docs/workspace-primitives-pr39-gap-spec.md
Repo: `relayfile-adapters` (provider path mapping, layout manifests, digest handlers, writeback schemas and provider mutations)

## Purpose

This is the **relayfile-adapters-owned slice** of the PR-39
workspace-primitives gap spec. The `relayfile` slice is already
implemented, tested, and shipped in relayfile#162 — do not re-plan or
re-implement it. This workflow only implements provider-adapter behavior.

Canonicalized contract decisions (from parent spec Work Item A, already
final — do not re-litigate):

- Provider layout path is `LAYOUT.md` (not `.layout.md`).
- Digest header is YAML frontmatter: `date`, `generated_at`, `covers`,
  `providers`, `events`.
- Cloud/runtime digest rendering stays generic over workspace events —
  adapters do NOT own provider-specific digest bullet rendering. Remove
  the unused adapter `digest()` handler expectation from adapter docs and
  the digest contract.
- Writeback discovery surface is sibling `.schema.json` (+
  `.create.example.json` where present).
- `by-edited` is scoped to activity-summary fallback resources.

Execution preference: local/BYOH first against this `relayfile-adapters`
checkout. No publish/deploy in this run.

Approval boundary: run validation, write/modify source and tests, and
read state automatically. Pause and ask for user approval before any
destructive operation, before commits or pushes to git, before opening or
merging pull requests, and before any publish. Default non-destructive.

## Adapters Work Items

### B. Digest Contract Conformance

- Remove the adapter-owned provider-specific `digest()` bullet-rendering
  expectation from adapter docs and the digest/layout contract checks;
  digest rendering is generic over workspace events upstream.
- Where adapters still expose digest-relevant metadata, ensure exports and
  conformance checks match the generic-rendering decision (no required
  per-provider `DigestSection`).

Done when: adapter contract checks no longer require per-provider
`digest()` handlers, and docs state the generic-rendering decision.

### C. Edited-Date Index Emission

- Emit provider-specific `by-edited/YYYY-MM-DD/` aliases for
  activity-summary fallback resources: Notion pages, Linear issues,
  GitHub issues/PRs, Jira/Confluence priority paths.
- Define the date source per provider/resource (`updated_at`,
  `last_edited_time`, merged/closed timestamps where appropriate).
- Emit stable alias filenames that point to the current canonical record;
  clean up stale aliases when the edited date changes.
- Add layout-manifest support so `by-edited` is declared per
  provider/resource.

Done when: Notion, Linear, GitHub, and Jira/Confluence priority paths
have `by-edited` emission tests or a documented exclusion, and a test
resolves a record through the alias.

### D. Writeback Schema/Discovery Source of Truth

- Adapters are the source of truth for `.schema.json` and
  `.create.example.json` (plus `pathPattern` / `idPattern`) for every
  writable resource.
- Ensure discovery metadata is present and correct beside every writable
  resource so runtime/cloud can materialize it consistently.
- Add ignore coverage for partial/`.tmp`/`.partial` writeback filenames
  in adapter schemas where relevant.

Done when: every writable adapter resource ships a sibling
`.schema.json` (+ example where applicable) and a conformance test
asserts presence/shape; partial-filename ignore semantics are covered.

### E. Provider Layout Content

- Provider layout manifests emit `LAYOUT.md` (canonical path) content
  that reflects the actual populated alias indexes (`by-title`, `by-id`,
  `by-name`, `by-state`, `by-edited`) and writeback resources per
  provider — not static/generic text.
- `__`-in-identifier sanitation has tests (provider object whose title
  contains `__` still recovers the stable id from the last `__` segment).

Done when: a provider-layout conformance test asserts each priority
provider's layout lists its real alias segments and writeback schemas,
and `__` sanitation tests pass.

## Validation

Run the relayfile-adapters repo's own test/contract commands for touched
packages after each slice (`npm run test:digest-contracts`,
`npm run test:writeback-discovery`, `npm test`). Do not weaken or skip
gates.
