# Naming conventions

When this applies: composing or parsing any canonical/alias path emitted by an adapter under `packages/<name>`.

## Joiner

All adapters use `__` (double underscore) as the joiner between a human-readable slug and the provider's stable ID. The legacy `--` (double hyphen) joiner is no longer emitted by any adapter; readers in `jira` and `confluence` still accept it so mounts written before the cross-adapter convention migration keep resolving.

## Flat vs. directory decision tree

Ask one question: **does this entity own child files on disk?**

- **No child files** -> flat record: `<resource>/<slug>__<id>.json`.
  - Example: `/jira/issues/task-1__10000.json`.
  - Example: `/linear/issues/onboarding-bug__abc-123.json`.
  - Example: `/notion/pages/quarterly-plan__a1b2c3d4.json`.
- **Has child files** (`diff.patch`, `files/**`, `messages/**`, `attachments/**`, ...) -> directory record with `meta.json`: `<resource>/<id>__<slug>/meta.json`.
  - Example: `/github/repos/o/r/pulls/42__fix-thing/meta.json` with siblings `diff.patch`, `files/...`.
  - Example: `/slack/channels/C123__general/meta.json` with sibling `messages/...`.

Note the ID/slug order flips between the two shapes: flat puts the slug first (since the human typically reads the slug to choose a file), directory puts the ID first (since the directory IS the entity and the ID is the deterministic anchor).

## Slug rules

Always go through `slugifyAlias` from `packages/core/src/alias-slug.ts`:

- ASCII only, lowercase, hyphen-separated.
- Truncate to 80 characters at a word boundary.
- `slugifyAlias` implements and enforces this behavior; use it for canonical
  and alias slugs instead of duplicating slug logic.
- Empty input falls back to `untitled` (alias context) or the bare ID (canonical context).
- Never roll your own slugifier.

## ID rules

Use the provider's stable ID verbatim. Do not normalize it — UUIDs, numeric IDs, and string keys (e.g. `ENG-42`) are all fine.
