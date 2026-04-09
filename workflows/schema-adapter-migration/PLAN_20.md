# PLAN_20 — Canonical IntegrationAdapter moved to @relayfile/sdk

Scope: code-movement only. No behavior change. Downstream builds must stay green.

## 1. Public surface of `relayfile/packages/sdk/typescript/src/integration-adapter.ts`

Types (moved verbatim from `schema-adapter.ts`):
- `AdapterContext` = `Record<string, unknown>` (provisional; tightened in WF 21).
- `AdapterWebhookMetadata` — `{ deliveryId?; delivery_id?; timestamp?; [k]: unknown }`.
- `AdapterWebhook` — `{ provider; connectionId?; eventType; objectType; objectId; payload; metadata?; raw? }`.
- `IngestError` — `{ path; error }`.
- `IngestResult` — `{ filesWritten; filesUpdated; filesDeleted; paths; errors }`.

Class — `abstract class IntegrationAdapter`:
- protected `client: RelayFileClient`, `provider: ConnectionProvider`
- `abstract readonly name: string`
- `abstract readonly version: string`
- `constructor(client, provider)`
- `abstract ingestWebhook(workspaceId: string, event: AdapterWebhook): Promise<IngestResult>`
- `abstract computePath(objectType: string, objectId: string, context?: AdapterContext): string`
- `abstract computeSemantics(objectType: string, objectId: string, payload: Record<string, unknown>, context?: AdapterContext): FileSemantics`
- Optional hooks (method signatures; base impl throws `Not implemented`):
  - `supportedEvents?(): string[]`
  - `writeBack?(workspaceId: string, path: string, content: string): Promise<void>`
  - `sync?(resourceName: string, options?: Record<string, unknown>): Promise<IngestResult>`

Re-exported from `relayfile/packages/sdk/typescript/src/index.ts` alongside existing `RelayFileClient`, `ConnectionProvider`, `FileSemantics`, `ProxyResponse`.

## 2. `@relayfile/adapter-core` back-compat re-exports

`relayfile-adapters/packages/core/src/runtime/schema-adapter.ts` keeps the concrete `SchemaAdapter` (mapping-spec logic + writeback helpers) and re-exports the canonical types from the SDK so existing deep imports keep working:

```ts
export {
  IntegrationAdapter,
  type AdapterContext,
  type AdapterWebhook,
  type AdapterWebhookMetadata,
  type IngestError,
  type IngestResult,
} from "@relayfile/sdk";
export { SchemaAdapter, type SchemaAdapterOptions, type MatchedWriteback };
```

`packages/core/src/index.ts` adds the same runtime + type-only re-exports so downstream packages keep importing `IntegrationAdapter` from `@relayfile/adapter-core` without path changes.

## 3. Duplicate-class files to delete + dedup workers

Each file currently declares its own local `abstract class IntegrationAdapter`. One worker per package deletes the local class and imports from `@relayfile/sdk`. Fan-out runs in parallel after `build-adapter-core`.

| # | File | Dedup worker |
|---|---|---|
| 1 | `relayfile-adapters/packages/github/src/types.ts` | `codex-impl-dedup-github` |
| 2 | `relayfile-adapters/packages/slack/src/slack-adapter.ts` | `codex-impl-dedup-slack` |
| 3 | `relayfile-adapters/packages/linear/src/linear-adapter.ts` | `codex-impl-dedup-linear` |
| 4 | `relayfile-adapters/packages/notion/src/adapter.ts` | `codex-impl-dedup-notion` (reconciles `computePath(raw, context)` with canonical `(objectType, objectId, context?)`) |
| 5 | `relayfile-adapters/packages/gitlab/src/types.ts` | `codex-impl-dedup-gitlab` |

Each branch is gated by `pnpm --filter @relayfile/adapter-<name> build`. Reviewer confirms no stale relative imports and type-equivalent shape at the SDK entry point; writes verdict to `REVIEW_20.md`.
