# 05 — Custom Adapter: Stripe

Build a complete Stripe adapter with ~30 lines of YAML and a few lines of
TypeScript. No custom class — just a mapping spec + `SchemaAdapter`.

## Prerequisites

- Node.js 20+
- Optional local relayfile stack:

```bash
cd ../AgentWorkforce-relayfile/docker
docker compose up -d
```

## Files

| File | Purpose |
|---|---|
| `stripe.mapping.yaml` | Declares webhooks, resources, and writebacks |
| `index.ts` | Loads the YAML, creates a SchemaAdapter, exercises it |

## What it shows

- **Webhooks**: `charge.succeeded`, `invoice.payment_succeeded`, `customer.subscription.created`
- **Resources**: `GET /charges/{id}`, `GET /customers/{id}`
- **Writebacks**: Agent writes a refund file → `POST /charges/{id}/refunds`

Formal mapping reference:
[../../docs/MAPPING_YAML_SPEC.md](../../docs/MAPPING_YAML_SPEC.md)

## Run

```bash
npx tsx examples/05-custom-adapter/index.ts
```
