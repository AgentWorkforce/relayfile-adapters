# Testing

When this applies: before opening any PR in this repo.

## The one command

Run from the repo root:

```bash
npx turbo build typecheck test
```

It must be green before the PR opens. Do not bypass git hooks; if the pre-commit hook fails, fix the underlying issue and create a new commit.

## What each helper needs covered

- **Path-mapper helpers** — round-trip tests: compose with the helper, parse the result back to its inputs, assert equality. Cover at least one ASCII-clean case, one case with characters that the slugifier collapses, and one case with an empty / missing slug input.
- **Alias subtrees** — collision test: emit two entities whose slugs collide, assert that both alias paths are distinct and deterministic (re-emitting produces the same paths), and assert the resource's alias strategy. Minimal pointer aliases must point at different `canonicalPath` values; materialized canonical mirrors must match the canonical provider envelope/body for each entity.
- **`LAYOUT.md` emitter** — non-empty content test asserting:
  - `file.path === '/<provider>/LAYOUT.md'`.
  - `file.contentType === 'text/markdown; charset=utf-8'`.
  - Content length is at least ~1000 bytes (guards against regressing to the generic fallback).
  - Content contains the substrings `ls`, `_index.json`, `jq`, and every `by-*` subtree the adapter ships.

## Writeback discovery

If the PR touches writeback resources, schemas, or `src/resources.ts`, also run:

```bash
node scripts/generate-writeback-discovery.mjs
npm run test:writeback-discovery
```

## Adding a new adapter

Run the package-resolver sanity check to confirm the publish workflow will see your package:

```bash
node scripts/resolve-publish-targets.mjs all
```

The new slug must appear in the output.
