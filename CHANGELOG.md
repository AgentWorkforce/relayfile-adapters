# Changelog

## Unreleased

### Breaking

- Writeback creation is now file-native. The reserved `new.json` create path is no longer special; create operations happen when an agent writes a valid JSON document to any non-canonical filename in a writable resource directory.
- Writeback dispatch is keyed by each resource's declared canonical `idPattern`: canonical `<id>.json` paths edit existing records, non-canonical filenames create new records, and deleting canonical files requests provider-side deletion.

### Migration

- See `docs/migration/file-native-writeback.md` for the new read/edit/create/delete contract, schema discovery flow, writeback status surface, and per-adapter draft filename examples.
- See `docs/migration/new-json-callers.md` for the Cloud and demo caller scan that identifies `new.json` write paths to migrate.
