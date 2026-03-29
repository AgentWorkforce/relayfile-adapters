# 03 — Writeback

An agent writes a review JSON file to a VFS path. The GitHub adapter's
writeback handler parses the path, extracts the target (owner/repo/PR),
and proxies the review to the GitHub API.

## What it shows

| Step | Detail |
|-|-|
| Agent writes file | `→ /github/repos/acme/api/pulls/42/reviews/agent-review.json` |
| Path extraction | owner=`acme`, repo=`api`, PR=`42` |
| Payload mapping | Agent review JSON → GitHub Create Review API body |
| Code suggestions | `suggestion` field → GitHub suggestion markdown block |
| Proxy call | `POST /repos/acme/api/pulls/42/reviews` via provider |

## Run

```bash
npx tsx examples/03-writeback/index.ts
```
