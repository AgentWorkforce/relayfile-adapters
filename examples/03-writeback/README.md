# 03 — Writeback Consumer

An agent writes a review JSON file to a VFS path. `WritebackConsumer` polls the
pending queue, reads that file, delegates `/github/.../reviews/...` paths to
`GitHubWritebackHandler`, then acknowledges success or failure back to relayfile.

## Prerequisites

- Node.js 20+
- Optional local relayfile stack:

```bash
cd ../AgentWorkforce/relayfile/docker
docker compose up -d
```

## What it shows

| Step | Detail |
|---|---|
| Agent writes file | `→ /github/repos/acme/api/pulls/42/reviews/agent-review.json` |
| Queue polling | `WritebackConsumer.pollOnce()` |
| File lookup | `readFile()` supplies the review JSON payload |
| Path extraction | owner=`acme`, repo=`api`, PR=`42` |
| Proxy call | `POST /repos/acme/api/pulls/42/reviews` via shared `ConnectionProvider` |
| Acknowledgement | `ackWriteback({ success: true })` |

## Run

```bash
npx tsx examples/03-writeback/index.ts
```
