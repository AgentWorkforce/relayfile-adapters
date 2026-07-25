# Inbound capability and logical-event contract

`@relayfile/adapter-core/inbound` is the source-of-truth surface used by Cloud,
relayfile-cloud, and generated edge artifacts to classify provider-data ingress
and derive the same cross-path logical event identity.

Provider packages own declarations in `packages/<provider>/src/inbound.ts`.
`adapter-core inbound generate` discovers those declarations from built package
outputs and produces:

- `INBOUND_CAPABILITY_CATALOG`
- `INBOUND_CAPABILITY_CATALOG_VERSION`
- `resolveInboundCapability(input)`
- `logicalEventKey(input, capability?)`
- `INBOUND_LOGICAL_EVENT_GOLDEN_VECTORS`

The generated catalog version is SHA-256 over the normalized catalog JSON.
Consumers report and compare this version before enabling a provider slice.
They must not maintain local provider-config allowlists.

## Logical-event hierarchy

Known adapter event kinds use this ordered hierarchy:

1. Immutable provider/source delivery ID scoped by canonical provider,
   provider-config key, connection, and provider object scope.
2. Nango sync-page identity: provider-config key, connection, sync, model, and
   at least one page discriminator (source window/query timestamp or cursor).
   Known Nango sync payloads with incomplete page identity throw
   `IncompleteNangoSyncPageIdentityError` instead of emitting a colliding key.
3. Hookdeck source/delivery identity declared by the adapter.
4. SHA-256 of canonical JSON payload semantics.

Delivery identity is read only from headers named by the adapter declaration.
Payload business identifiers such as a generic `eventId` are never promoted to
transport identity implicitly.

Exact raw bytes are always hashed into `evidence.rawBodySha256`. They become the
logical key only for an unknown event kind or a malformed declaration that
cannot reach the semantic strategy. If an existing claim has the same logical
key but different raw/semantic evidence, the claim owner must quarantine it;
the key helper does not silently choose one payload.

`logicalEventKey` is async and uses Web Crypto so the same implementation runs
in Node and Worker runtimes. Callers pass the original raw body bytes; parsing
for classification must never replace those bytes.

GitLab Hookdeck ingress detects `x-gitlab-*` headers. Its strongest delivery
identity is `x-gitlab-event-uuid`; `x-hookdeck-eventid` is the declared fallback.

## Gmail identity and migration

`@relayfile/gmail/identity` publishes:

| Contract | Value |
|---|---|
| Canonical provider ID | `gmail` |
| Canonical path root | `/gmail` |
| Provider-config aliases | `gmail`, `google-mail`, `google-mail-relay` |
| Legacy provider ID | `google-mail` |
| Legacy path root | `/google-mail` |

The migration policy is additive and non-destructive:

- New materialization writes only the canonical `/gmail` tree.
- Readers and digest compatibility accept both `/gmail` and `/google-mail`.
- Existing legacy files are not modeled as provider deletions.
- A full Gmail resync is required to populate the canonical tree.
- The legacy tree may retire only after reconciliation proves zero references
  and an explicit cutover authorizes retirement.

The adapter does not invent a root-only rewrite for existing records because
the legacy Cloud tree and canonical adapter layout have different resource
shapes. Consumers use the exported identity/policy for read fallback and resync
coordination.

## Regeneration and validation

Build declaring adapters before regenerating:

```bash
npx turbo build
npx adapter-core inbound generate
npx adapter-core inbound check
```

The root `npx turbo build typecheck test` gate runs the drift check after every
workspace build. Feature PRs do not bump package versions; the publish workflow
does that after merge.
