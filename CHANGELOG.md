# Changelog

Cross-package release notes for the relayfile adapters workspace. Curate
`[Unreleased]` as PRs land. The publish workflow does not touch this file, so
the release cut is manual: when you run a release, rename `[Unreleased]` to the
published version with a date and open a fresh empty `[Unreleased]` above it.

## [Unreleased]

### Breaking

- Writeback creation is now file-native. The reserved `new.json` create path is no longer special; create operations happen when an agent writes a valid JSON document to any non-canonical filename in a writable resource directory.
- Writeback dispatch is keyed by each resource's declared canonical `idPattern`: canonical `<id>.json` paths edit existing records, non-canonical filenames create new records, and deleting canonical files requests provider-side deletion.

### Migration

- See `docs/migration/file-native-writeback.md` for the new read/edit/create/delete contract, schema discovery flow, writeback status surface, and per-adapter draft filename examples.
- See `docs/migration/new-json-callers.md` for the Cloud and demo caller scan that identifies `new.json` write paths to migrate.

### Added

- Added the Telegram adapter with typed path helpers, rich Bot API writeback resources for messages, reactions, callback answers, inline answers, commands, and menu buttons, plus optional event-sourced conversation history layout and discovery metadata.
- `normalizeWritebackStatus(result, entry?)` + `NormalizedWritebackState` (incl. `'no_receipt'`) and `NormalizedWritebackStatus` in `@relayfile/adapter-core` (and re-exported from the `vfs-client` subpath). Bridges high-level `WritebackResult` (receipt present/absent) with low-level `WritebackStatusEntry` outcomes. First-class support for agent debuggability (writeback no-receipt, W6) so runtime wrappers and terminal status taxonomies share a stable enum without per-adapter code. See updated `WritebackOutcome` and docs.
