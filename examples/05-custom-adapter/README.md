# 05 — Custom Adapter: Stripe

Build a complete Stripe adapter with ~30 lines of YAML and a few lines of
TypeScript. No custom class — just a mapping spec + `SchemaAdapter`.

## Files

| File | Purpose |
|-|-|
| `stripe.mapping.yaml` | Declares webhooks, resources, and writebacks |
| `index.ts` | Loads the YAML, creates a SchemaAdapter, exercises it |

## What it shows

- **Webhooks**: `charge.succeeded`, `invoice.payment_succeeded`, `customer.subscription.created`
- **Resources**: `GET /charges/{id}`, `GET /customers/{id}`
- **Writebacks**: Agent writes a refund file → `POST /charges/{id}/refunds`

## Run

```bash
npx tsx examples/05-custom-adapter/index.ts
```
