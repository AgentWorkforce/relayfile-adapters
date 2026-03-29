# 04 — Full Loop: GitHub PR Lifecycle

**Flagship example.** Walks through the complete adapter lifecycle:

```
GitHub webhook → Adapter normalizes → VFS write
    → Agent reads PR → Agent writes review → Writeback → GitHub API
```

## Steps

| # | What happens | Key method |
|-|-|-|
| 1 | `pull_request.opened` webhook arrives | `adapter.ingestWebhook()` |
| 2 | PR metadata stored in VFS | `relayFileClient.putFile()` |
| 3 | Agent reads the PR from VFS | `relayFileClient.getFile()` |
| 4 | Agent writes a review file to VFS | `relayFileClient.putFile()` |
| 5 | Adapter posts review to GitHub | `adapter.writeBack()` |

Everything is mocked (in-memory VFS, mock provider) — no GitHub token needed.

## Run

```bash
npx tsx examples/04-full-loop-github/index.ts
```
