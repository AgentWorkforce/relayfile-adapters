# Event subscriptions and handler input

`@relayfile/adapter-core/events` defines the versioned data exchanged between an
event source and a handler runtime. It supplies browser-safe TypeScript types,
constructors, and parsers. It does not start listeners or flow runs.

Subscriptions belong before execution: an event that does not match creates no
run. A handler can therefore concentrate on work, without treating a filter
mismatch as cancellation or a successful empty run.

## Declare a subscription

```ts
import { defineEventSubscription } from '@relayfile/adapter-core/events';

export const source = defineEventSubscription({
  provider: 'linear',
  connectionId: 'conn_linear_team',
  eventTypes: ['issue.create', 'issue.update'],
  pathPrefixes: ['/linear/issues'],
});
```

The constructor adds `schema: 'relayfile.event-subscription/1'` and returns a
validated, immutable snapshot. `parseEventSubscription(unknown)` reads the
serialized form, including its schema discriminator. Unknown providers, event
names, schema versions, or selector fields are rejected rather than ignored.

The v1 selector contract is:

- `provider` and `connectionId` must both match the event exactly. The connection
  ID is a host-resolved reference, never a credential or proof of access.
- `eventTypes` is a nonempty, duplicate-free OR list of exact adapter event
  names. For Linear, use `issue.create`, not `linear.issue.create` or `issue.*`.
- `pathPrefixes`, when present, is a nonempty, duplicate-free OR list. At least
  one affected event path must equal a prefix or lie beneath it at a `/` segment
  boundary. `/linear/issues` matches `/linear/issues/ENG-42__issue-42.json`, but
  not `/linear/issues-archive/ENG-42__issue-42.json`. `/` includes every path.
- Omitting `pathPrefixes` selects all paths for the specified connection and
  event types. An empty list is rejected; it does not mean all paths.

Paths must be concrete absolute Relayfile paths. Globs, unresolved `{templates}`,
traversal, empty segments, and trailing slashes other than `/` are rejected.
Use adapter-owned path helpers for record paths; do not concatenate provider
resource paths. An adapter's published resource roots, such as `/linear/issues`,
can be used as literal subtree selectors.

These are matching semantics for the host to implement. Neither subscription
parsing nor event parsing performs matching.

## Preserve the event delivered to the handler

At an adapter-aware ingestion boundary, construct an event using the existing
logical identity and adapter-owned path mapping:

```ts
import { createAdapterEvent } from '@relayfile/adapter-core/events';
import { linearIssuePath } from '@relayfile/adapter-linear/path-mapper';

const event = createAdapterEvent({
  id: 'upstream-logical-event-123',
  provider: 'linear',
  eventType: 'issue.create',
  workspaceId: 'workspace_123',
  connectionId: 'conn_linear_team',
  deliveryId: 'transport-attempt-456',
  occurredAt: '2026-09-14T19:00:00.000Z',
  paths: [linearIssuePath('issue-42', 'ENG-42')],
  payload: { id: 'issue-42', identifier: 'ENG-42', title: 'Fix sign-in' },
});
```

This example's helper produces `/linear/issues/ENG-42__issue-42.json`. It uses
the canonical issue record, not an alias or a legacy `metadata.json` path. The
provider path helper runs at the adapter boundary; the generic events module
itself imports no provider adapter.

The constructor adds `schema: 'relayfile.adapter-event/1'`.
`parseAdapterEvent(unknown)` validates the serialized envelope. Both preserve
and freeze a JSON snapshot; neither fetches a fresher provider record.

| Field | Contract |
| --- | --- |
| `id` | Existing logical event identity, stable across redelivery. The constructor never mints one. |
| `provider`, `eventType` | Canonical provider and exact event name from the existing trigger catalog. |
| `workspaceId`, `connectionId` | Context the host must verify against its authenticated binding. |
| `deliveryId` | Optional transport attempt identity; separate from logical event identity. |
| `occurredAt` | Canonical UTC ISO timestamp, including milliseconds and `Z`. |
| `paths` | Nonempty, duplicate-free concrete affected paths supplied by adapter-owned mapping. |
| `payload` | Preserved finite, acyclic JSON data; provider-specific payload schemas remain separate. |

These parsers validate shape, catalog names, and JSON data. They do not validate
provider payload semantics, authenticate an event, authorize a workspace or
connection, match a subscription, or deduplicate delivery. A parsed event remains
untrusted until the host completes those checks.

## Runtime obligations before execution

The Cloud or CLI host owns the executable binding: subscription identity and
revision, authenticated workspace, connection, handler identity, and executable
version. Those deployment fields are outside the portable subscription selector.

Before activating a subscription, the host must resolve the connection, verify
its provider and workspace ownership, check required authentication and connection
scope, and confirm that the bound handler can execute. At delivery, it must:

1. Authenticate the ingress and verify the event's workspace and connection
   against that binding. Do not trust those IDs merely because parsing succeeded.
2. Resolve the active subscription revision and apply its selectors. No match
   means no run. A stale or unauthorized binding must not invoke the handler.
3. Claim the logical event for the subscription durably before dispatch. Dedupe
   by subscription identity plus logical event identity, within the verified
   workspace/connection boundary; a transport retry must not create another run.
   Record the matched subscription revision with that claim so retries execute
   the original binding rather than silently switching handlers or selectors.
4. Persist the accepted event snapshot with the run and pass that same snapshot
   to the handler on execution and recovery. Keep external-effect idempotency
   separate from delivery deduplication.

An explicit replay or subscription replacement needs its own host policy. A new
transport `deliveryId` or a changed timestamp is not permission to duplicate work.

## Reuse adapter metadata

The events module validates against `KNOWN_TRIGGER_CATALOG` from
`@relayfile/adapter-core/triggers`; it introduces no second provider inventory.
Connection setup can also consume the existing `/inbound`, `/scope-keys`, and
`/writeback-paths` catalogs. Canonical resource paths remain adapter-owned.

The scope-key catalog lists supported connection filter **names**. It does not
describe their value types, discover selectable teams or channels, or grant OAuth
permissions. Consumers must use the adapter's connection/configuration contract
and authenticated discovery for those values. Do not infer a complete connection
form or accept arbitrary filter values from a scope-key name alone.

## Cloud and Flows rollout

The existing Cloud agent `onEvent` envelope requires an explicit bridge. Map its
resource data into `payload`, preserve the exact catalog `eventType`, and carry
verified workspace/connection context and adapter-produced paths into this
envelope. Do not copy a Cloud ID blindly: where Cloud falls back to a timestamp
for identity, retries do not have a sufficient stable dedupe key. Preserve the
upstream logical ID, or derive it at ingress under the existing adapter-owned
logical-key policy before constructing this event. Transport identity belongs in
`deliveryId` when available.

This package adds the contract, not that bridge. Flows' existing `.on(source,
handler)` surface still needs an implementation that binds this subscription to
an executable handler. This document does not introduce a new working Flows API
or claim that Cloud event execution is complete.

Release sequence:

1. Merge this adapter-core change, then publish `core` through the repository's
   publish workflow. Feature PRs leave package versions unchanged.
2. Update Flows to the published core version and implement the event binding.
   A one-off CLI run must accept a supplied event through the same handler path;
   live listening additionally requires an authenticated subscription runtime.
3. Wire Cloud delivery to that handler contract, retaining host authentication,
   matching, durable deduplication, and the accepted event snapshot.
4. Update the builder to consume published metadata and generate the supported
   subscription declaration plus handler function. Verify the authenticated CLI
   and Cloud paths before describing the generated result as runnable end to end.
