# Adapter writeback discovery

When adding or changing an adapter write endpoint, always ship discoverability artifacts with it. Every `new.json` write template must have sibling `new.schema.json` and `new.example.json` files in that adapter's discovery tree, and each adapter must have a root `.adapter.md` that lists its write endpoints.

Source schemas from the strongest available contract for the integration: JSON Schema, OpenAPI, Postman collections, provider docs, or the adapter writeback resolver. Schemas must use JSON Schema draft 2020-12, include field-level descriptions, make `required` explicit, and include enum values where the provider accepts a fixed set.

Run `npm run test:writeback-discovery` before opening a PR that touches adapter writeback behavior or creates a new adapter.
