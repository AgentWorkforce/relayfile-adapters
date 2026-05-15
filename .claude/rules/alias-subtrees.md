# Alias subtrees

When this applies: adding a `by-*` view to an adapter, or reading an entity through one.

## When to add a `by-*` subtree

Add an alias subtree whenever the entity has a natural human-readable lookup key distinct from its stable ID. Common keys:

- `by-id` — when the canonical path embeds a slug, `by-id` is the stable shortcut for "I have the ID and want the record."
- `by-title` / `by-name` — for entities whose human-readable label changes independently of the ID.
- `by-key` — for entities with a provider-issued short key (e.g. Jira `ENG-42`, Linear identifier `ENG-42`).
- `by-state` / `by-status` — when the consumer cares about the lifecycle bucket (`open`, `closed`, `in-progress`, ...).
- `by-parent` — when the entity has a single natural parent (issues -> project, pages -> space).

The enforced category matrix lives in `docs/digest-layout-contract.md` and is
checked by `npm run test:digest-contracts`. If a resource belongs to a matrix
category such as issue-tracking, add the required alias (`by-state` for
issue-tracking, `by-status` for CI/deploy) in the same change as the layout,
emitter, and tests.

Do NOT add an alias for a key that already matches the canonical filename one-to-one — it would be redundant.

## Path shape

```text
/<provider>/<resource>/by-<key>/<slug-or-key>__<id>.json
```

For `by-state`, group records under a state subdirectory:

```text
/<provider>/<resource>/by-state/<state>/<id>.json
```

## Collision handling

Always use `aliasCollisionSuffix` from `packages/core/src/alias-slug.ts` (an 8-char hex of `sha256(id)`). Append it to the alias slug whenever a slug collides with an existing alias. NEVER pick "first writer wins" — the alias must be deterministic across sync runs so that re-emitting the same entity produces the same alias path.

## Alias file content

Each alias file is a minimal pointer, not a full copy of the record:

```json
{ "id": "<id>", "canonicalPath": "/<provider>/<resource>/<slug>__<id>.json", "title": "<optional>" }
```

Readers follow `canonicalPath` to get the full record. This keeps the cost of adding alias views low and means the canonical record is the single source of truth.

## Read pattern

1. If you have a stable ID, read `/<provider>/<resource>/by-id/<id>.json` and follow `canonicalPath`.
2. Otherwise read `_index.json`, filter on the natural field, then follow `canonicalPath` from the alias or read the canonical path directly.
3. Only `ls` the resource directory when you have no key at all.
