# 01 — GitHub Webhook Ingest

Receive a signed GitHub `pull_request.opened` webhook through
`@relayfile/webhook-server`, route it into `GitHubAdapter`, and inspect the
VFS path plus semantics it produces.

## Prerequisites

- Node.js 20+
- Optional local relayfile stack:

```bash
cd ../AgentWorkforce/relayfile/docker
docker compose up -d
```

## What it shows

| Adapter capability | Method |
|---|---|
| Signed webhook routing | `createWebhookServer()` + `POST /github/webhook` |
| Path mapping | `computePath("pull_request", "42")` |
| Semantic extraction | `computeSemantics(objectType, id, payload)` |
| Lower-level adapter hook | `adapter.ingestWebhook()` is what the server calls internally |

## Run

```bash
npx tsx examples/01-github-webhook-ingest/index.ts
```

## Expected output

```
Webhook server status: 200
Computed VFS path: /github/repos/acme/api/pulls/42/metadata.json
File semantics: { "properties": { "provider": "github", ... } }
Server result: { "filesWritten": 1, "paths": [...] }
```
