# Relayfile Adapter Examples

Examples for the two halves of the adapter lifecycle:
ingest with `@relayfile/webhook-server`, then write back with
`WritebackConsumer` plus an adapter-specific handler.

## Prerequisites

- Node.js 20+
- These demos are self-contained with mocked providers and an in-memory relayfile stub.
- For a real local relayfile backend, start the sibling stack first:

```bash
cd ../AgentWorkforce-relayfile/docker
docker compose up -d
```

## Examples

| # | Example | What it covers |
|---|---|---|
| 01 | [GitHub Webhook Ingest](./01-github-webhook-ingest/) | `webhook-server` + `GitHubAdapter` + shared `ConnectionProvider` |
| 02 | [Schema-Driven Adapter](./02-schema-driven-adapter/) | `SchemaAdapter` from inline mapping spec ([YAML spec](../docs/MAPPING_YAML_SPEC.md)) |
| 03 | [Writeback Consumer](./03-writeback/) | `WritebackConsumer` + `GitHubWritebackHandler` — pending review → GitHub API |
| 04 | [Full Loop: GitHub](./04-full-loop-github/) | **Flagship** — `webhook-server` + shared `ConnectionProvider` + `WritebackConsumer` |
| 05 | [Custom Adapter: Stripe](./05-custom-adapter/) | YAML mapping + `SchemaAdapter` ([spec](../docs/MAPPING_YAML_SPEC.md)) |

## Running

```bash
npx tsx examples/01-github-webhook-ingest/index.ts
npx tsx examples/03-writeback/index.ts
npx tsx examples/04-full-loop-github/index.ts
```

## How It Fits Together

```text
GitHub webhook
  -> @relayfile/webhook-server
  -> GitHubAdapter
  -> relayfile VFS path + metadata

Agent reads and writes files

WritebackConsumer
  -> GitHubWritebackHandler
  -> provider proxy
  -> GitHub API
```

Key packages:
`@relayfile/webhook-server` for inbound HTTP,
`@relayfile/sdk` for `ConnectionProvider` and `WritebackConsumer`,
`@relayfile/adapter-github` for GitHub-specific routing,
and `@relayfile/adapter-core` for mapping-driven adapters.
