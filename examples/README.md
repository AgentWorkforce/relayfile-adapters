# Relayfile Adapter Examples

End-to-end examples showing the three things adapters do:
**path mapping**, **webhook normalization**, and **writeback**.

## Examples

| # | Example | What it covers |
|-|-|-|
| 01 | [GitHub Webhook Ingest](./01-github-webhook-ingest/) | `webhook-server` + `GitHubAdapter` — webhook → VFS path |
| 02 | [Schema-Driven Adapter](./02-schema-driven-adapter/) | `SchemaAdapter` from inline mapping spec ([YAML spec](../docs/MAPPING_YAML_SPEC.md)) |
| 03 | [Writeback](./03-writeback/) | `GitHubWritebackHandler` — VFS review → GitHub API |
| 04 | [Full Loop: GitHub](./04-full-loop-github/) | **Flagship** — webhook-server → VFS → agent → WritebackHandler |
| 05 | [Custom Adapter: Stripe](./05-custom-adapter/) | 30-line YAML ([spec](../docs/MAPPING_YAML_SPEC.md)) + few lines TS |

## Running

All examples are self-contained with mocked providers. No API keys needed.

```bash
npx tsx examples/01-github-webhook-ingest/index.ts
npx tsx examples/04-full-loop-github/index.ts
```

## Docker

Run the webhook-server with Docker for production deployments:

```bash
# Build
docker build -t relayfile-webhook-server .

# Run with secrets injected via environment
docker run -p 3000:3000 \
  -e GITHUB_WEBHOOK_SECRET=your_secret \
  -e WORKSPACE_ID=ws_prod \
  relayfile-webhook-server
```

The server exposes `POST /:provider/webhook` — point GitHub/Slack webhook
URLs at `https://your-host:3000/github/webhook`.

## How it fits together

```
Webhook → webhook-server → GitHubAdapter → VFS
                                            ↕  Agent reads & writes
GitHub API ← GitHubWritebackHandler ← VFS review file
```

Key packages: `@relayfile/webhook-server` (HTTP + sig verify),
`@relayfile/adapter-github` (adapter + `GitHubWritebackHandler`),
`@relayfile/adapter-core` (YAML-driven `SchemaAdapter`).
