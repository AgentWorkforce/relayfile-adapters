# `@relayfile/adapter-airtable`

Airtable adapter for Relayfile. The package still supports canonical base, table, and record ingestion/writeback, and it now also exposes a lazy proactive-runtime webhook surface for Airtable’s notification-only webhooks.

## Quick start

```ts
import {
  AirtableAdapter,
  buildSummary,
  createAirtableFetchOnDemand,
  normalizeAirtableNotification,
} from '@relayfile/adapter-airtable';
```

## Canonical VFS paths

```text
/airtable/bases/{baseId}.json
/airtable/bases/{baseId}/tables/{tableId}.json
/airtable/bases/{baseId}/tables/{tableId}/records/{recordId}.json
/airtable/bases/{baseId}/_notifications/{webhookId}.json
```

## Lazy Airtable webhook flow

The proactive-runtime receive path is intentionally shallow:

1. `normalizeAirtableNotification(rawPayload, headers, options)` validates the request and extracts only the cheap notification metadata.
2. Persist that metadata at `/airtable/bases/{baseId}/_notifications/{webhookId}.json`.
3. `buildSummary(notification)` derives a routing-safe summary from `changedFieldIds` plus the first 50 change hints already present in the notification payload.
4. `createAirtableFetchOnDemand(provider, options)` returns a gateway-facing loader that materializes the full Airtable payload page only when `expand("full")` is invoked.

## Gateway wiring

```ts
const notification = normalizeAirtableNotification(rawBody, headers, {
  webhookSecret: process.env.AIRTABLE_WEBHOOK_SECRET,
});

const summary = buildSummary(notification);
const fetchOnDemand = createAirtableFetchOnDemand(provider, {
  connectionId: notification.connectionId,
  providerConfigKey: notification.providerConfigKey,
});

const full = await fetchOnDemand(notification);
```

`fetchOnDemand(...)` accepts either the normalized notification object, the canonical notification path, or a `<baseId>:<webhookId>` identifier. The string forms stay keyed by `webhookId` so downstream expand handlers can reconstruct Airtable’s `/v0/bases/{baseId}/webhooks/{webhookId}/payloads` endpoint without a second lookup.
