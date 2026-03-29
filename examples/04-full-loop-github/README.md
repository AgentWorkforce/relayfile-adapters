# 04 — Full Loop: GitHub PR Lifecycle

**Flagship example.** Walks through the complete adapter lifecycle with the new
shared pieces in place:

```
GitHub webhook → webhook-server → GitHubAdapter → VFS path
    → agent reads PR → agent writes review
    → WritebackConsumer → GitHubWritebackHandler → GitHub API
```

## Prerequisites

- Node.js 20+
- Optional local relayfile stack:

```bash
cd ../AgentWorkforce-relayfile/docker
docker compose up -d
```

## Steps

| # | What happens | Key method |
|---|---|---|
| 1 | Signed webhook arrives | `createWebhookServer()` |
| 2 | GitHub adapter computes the relayfile path | `adapter.ingestWebhook()` |
| 3 | Demo persists the payload in an in-memory VFS | `vfs.set(path, content)` |
| 4 | Agent reads PR metadata and writes a review file | `vfs.get()` / `vfs.set()` |
| 5 | Writeback queue item is created | `listPendingWritebacks()` |
| 6 | Consumer dispatches the review back to GitHub | `WritebackConsumer.pollOnce()` |

Everything is mocked: in-memory VFS, in-memory queue, mock provider, no GitHub token needed.
The provider-facing types come from `@relayfile/sdk`, while the GitHub-specific
logic stays in `@relayfile/adapter-github`.

## Run

```bash
npx tsx examples/04-full-loop-github/index.ts
```
