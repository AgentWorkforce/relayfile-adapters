# 01 — GitHub Webhook Ingest

Receive a GitHub `pull_request.opened` webhook, normalize it with
`GitHubAdapter`, and see the VFS path + file semantics it produces.

## What it shows

| Adapter capability | Method |
|-|-|
| Path mapping | `computePath("pull_request", "42")` |
| Webhook normalization | `ingestWebhook(workspaceId, event)` |
| Semantic extraction | `computeSemantics(objectType, id, payload)` |

## Run

```bash
npx tsx examples/01-github-webhook-ingest/index.ts
```

## Expected output

```
Computed VFS path: /github/repos/acme/api/pulls/42/metadata.json
File semantics: { "properties": { "provider": "github", ... } }
Ingest result: { "filesWritten": 1, "paths": [...] }
```
