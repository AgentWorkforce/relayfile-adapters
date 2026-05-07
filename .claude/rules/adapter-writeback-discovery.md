# Adapter writeback discovery

When adding or changing an adapter writeback resource, always ship discoverability artifacts with it. Every writable resource must have a full-record `.schema.json`, a minimal `.create.example.json`, and an `idPattern` entry in `src/resources.ts`; each adapter must have a root `.adapter.md` that lists its writable resources and file-native operations.

Source schemas from the strongest available contract for the integration: JSON Schema, OpenAPI, Postman collections, provider docs, or the adapter writeback resolver. Schemas must use JSON Schema draft 2020-12, include field-level descriptions, make `required` explicit, and include enum values where the provider accepts a fixed set.

New resources must use file-native writeback, not magic filenames. Declare an `idPattern` in `src/resources.ts`, ship a full-record `.schema.json` beside the resource, mark provider-managed fields with `readOnly: true`, and provide a `.create.example.json` for minimal create documents. Creates happen by writing to a non-canonical filename; patches happen by writing mutable fields to a canonical `<id>.json`; deletes happen by removing a canonical `<id>.json`.

Run `npm run test:writeback-discovery` before opening a PR that touches adapter writeback behavior or creates a new adapter.
