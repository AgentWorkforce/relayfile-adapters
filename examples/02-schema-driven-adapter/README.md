# 02 — Schema-Driven Adapter

Build an adapter purely from a YAML-style mapping spec — no custom class needed.
Uses `SchemaAdapter` from `@relayfile/adapter-core`.

## Prerequisites

- Node.js 20+
- Optional local relayfile stack:

```bash
cd ../AgentWorkforce-relayfile/docker
docker compose up -d
```

## What it shows

| Capability | How |
|---|---|
| Declarative webhook mapping | `webhooks` in the spec → `computeWebhookPath()` |
| Resource path templates | `resources` in the spec → `computeResourcePath()` |
| Writeback glob matching | `writebacks` in the spec → `matchWriteback()` / `writeBack()` |
| Zero custom code | The entire adapter is driven by the spec object |

See also: `packages/core/examples/resend/` for a real-world Resend email adapter
built the same way from an OpenAPI spec.

Formal mapping reference:
[../../docs/MAPPING_YAML_SPEC.md](../../docs/MAPPING_YAML_SPEC.md)

## Run

```bash
npx tsx examples/02-schema-driven-adapter/index.ts
```
