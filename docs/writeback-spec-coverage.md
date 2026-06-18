# Writeback Spec Coverage

This file tracks which file-native writeback discovery schemas are backed by provider contracts rather than hand-authored inline schema objects in `scripts/writeback-discovery-data.mjs`.

Contract-backed means the endpoint uses `contractEndpoint(...)`, loads its request schema through `scripts/writeback-contracts.mjs`, and emits `x-relayfile-source` provenance into the generated `.schema.json`.

## Current Coverage

| Adapter | Contract source | Contract-backed endpoints | Inline endpoints | Notes |
|---|---|---:|---:|---|
| github | OpenAPI snapshot in `scripts/integration-contracts/github/source/openapi.yaml`, selected by `scripts/integration-contracts/github/writeback.openapi.json` | 4 | 0 | `issues/create`, `issues/create-comment`, `pulls/create-review`, and `pulls/create-reply-for-review-comment` are spec-backed with small relayfile overlays. |
| asana | None | 0 | 4 | Inline JS schemas. |
| azure-blob | None | 0 | 2 | Inline JS schemas. |
| box | None | 0 | 2 | Inline JS schemas. |
| clickup | None | 0 | 5 | Inline JS schemas. |
| cloudflare | None | 0 | 0 | Read-only inventory and notification adapter for Workers, Pages, D1, KV, R2, Queues, Tunnels, Zones, DNS records, and Notification webhooks/policies/events; no writeback endpoints. |
| confluence | None | 0 | 2 | Inline JS schemas. |
| docker-hub | None | 0 | 0 | Read-only Composio bridge adapter for repositories, tags, and webhooks; writeback actions are tracked for a later cloud-side integration. |
| dropbox | None | 0 | 2 | Inline JS schemas. |
| fathom | None | 0 | 0 | Read-only adapter for meetings, recording summaries/transcripts, teams, and team members; no writeback endpoints. |
| gcp | None | 0 | 0 | Read-only observer adapter for Cloud Run services, Cloud Monitoring alert policies, and Cloud Billing current state; no writeback endpoints. |
| gcs | None | 0 | 2 | Inline JS schemas. |
| gitlab | None | 0 | 2 | Inline JS schemas. |
| gmail | None | 0 | 3 | Inline JS schemas. |
| google-calendar | None | 0 | 1 | Inline JS schemas. |
| google-drive | None | 0 | 2 | Inline JS schemas. |
| granola | None | 0 | 2 | Inline JS schemas. |
| hubspot | None | 0 | 4 | Inline JS schemas. |
| intercom | None | 0 | 3 | Inline JS schemas. |
| jira | None | 0 | 4 | Inline JS schemas. |
| linear | None | 0 | 7 | Inline JS schemas; issue/comment/label writes proxy Linear GraphQL, while project writes target companion `linear-relay` Nango actions. |
| notion | None | 0 | 9 | Inline JS schemas cover database page creates, page `meta.json` property updates, content replacement, and comments. |
| onedrive | None | 0 | 2 | Inline JS schemas. |
| pipedrive | None | 0 | 4 | Inline JS schemas. |
| postgres | None | 0 | 2 | Inline JS schemas; database/table shape is runtime-native rather than provider OpenAPI. |
| redis | None | 0 | 2 | Inline JS schemas; key/value shape is runtime-native rather than provider OpenAPI. |
| reddit | None | 0 | 2 | Inline JS schemas. |
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
