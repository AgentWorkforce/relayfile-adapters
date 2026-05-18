# Writeback Spec Coverage

This file tracks which file-native writeback discovery schemas are backed by provider contracts rather than hand-authored inline schema objects in `scripts/writeback-discovery-data.mjs`.

Contract-backed means the endpoint uses `contractEndpoint(...)`, loads its request schema through `scripts/writeback-contracts.mjs`, and emits `x-relayfile-source` provenance into the generated `.schema.json`.

## Current Coverage

| Adapter | Contract source | Contract-backed endpoints | Inline endpoints | Notes |
|---|---|---:|---:|---|
| github | OpenAPI snapshot in `scripts/integration-contracts/github/source/openapi.yaml`, selected by `scripts/integration-contracts/github/writeback.openapi.json` | 3 | 0 | `issues/create`, `issues/create-comment`, and `pulls/create-review` are spec-backed with small relayfile overlays. |
| asana | None | 0 | 4 | Inline JS schemas. |
| azure-blob | None | 0 | 2 | Inline JS schemas. |
| box | None | 0 | 2 | Inline JS schemas. |
| clickup | None | 0 | 5 | Inline JS schemas. |
| confluence | None | 0 | 2 | Inline JS schemas. |
| dropbox | None | 0 | 2 | Inline JS schemas. |
| gcs | None | 0 | 2 | Inline JS schemas. |
| gitlab | None | 0 | 2 | Inline JS schemas. |
| gmail | None | 0 | 3 | Inline JS schemas. |
| google-calendar | None | 0 | 1 | Inline JS schemas. |
| google-drive | None | 0 | 2 | Inline JS schemas. |
| hubspot | None | 0 | 4 | Inline JS schemas. |
| intercom | None | 0 | 3 | Inline JS schemas. |
| jira | None | 0 | 4 | Inline JS schemas. |
| linear | None | 0 | 2 | Inline JS schemas; provider source is GraphQL, not OpenAPI. |
| notion | None | 0 | 1 | Inline JS schemas. |
| onedrive | None | 0 | 2 | Inline JS schemas. |
| pipedrive | None | 0 | 4 | Inline JS schemas. |
| postgres | None | 0 | 2 | Inline JS schemas; database/table shape is runtime-native rather than provider OpenAPI. |
| redis | None | 0 | 2 | Inline JS schemas; key/value shape is runtime-native rather than provider OpenAPI. |
| s3 | None | 0 | 2 | Inline JS schemas. |
| salesforce | None | 0 | 5 | Inline JS schemas. |
| sharepoint | None | 0 | 2 | Inline JS schemas. |
| slack | None | 0 | 4 | Inline JS schemas. |
| teams | None | 0 | 3 | Inline JS schemas. |
| x | None | 0 | 0 | Read-only social search adapter; no writeback endpoints. |
| zendesk | None | 0 | 3 | Inline JS schemas. |

## Updating This File

When an adapter moves an endpoint from `endpoint(...)` to `contractEndpoint(...)`:

1. Add or update a contract manifest under `scripts/integration-contracts/<adapter>/`.
2. Keep full upstream specs under a nested directory such as `source/` so only the manifest is auto-loaded.
3. Regenerate discovery with `node scripts/generate-writeback-discovery.mjs`.
4. Run `npm run test:writeback-discovery`.
5. Update this table with the new contract-backed and inline endpoint counts.

Use overlays only for relayfile-specific behavior or provider spec gaps. If most of a schema is still described in an overlay, leave it marked inline until the contract carries the bulk of the shape.
