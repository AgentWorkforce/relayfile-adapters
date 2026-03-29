# Relayfile Adapter Examples

End-to-end examples showing the three things adapters do:
**path mapping**, **webhook normalization**, and **writeback**.

## Examples

| # | Example | What it covers |
|-|-|-|
| 01 | [GitHub Webhook Ingest](./01-github-webhook-ingest/) | `GitHubAdapter` normalizes a PR webhook → VFS path |
| 02 | [Schema-Driven Adapter](./02-schema-driven-adapter/) | `SchemaAdapter` built from an inline mapping spec (no custom class) |
| 03 | [Writeback](./03-writeback/) | Agent writes a review → adapter maps VFS path back to GitHub API |
| 04 | [Full Loop: GitHub](./04-full-loop-github/) | **Flagship** — webhook → VFS → agent reads → agent writes → writeback |
| 05 | [Custom Adapter: Stripe](./05-custom-adapter/) | Build a Stripe adapter with ~30 lines YAML + few lines TS |

## Running

All examples are self-contained TypeScript files with mocked providers.
No API keys or external services needed.

```bash
# Run any example
npx tsx examples/01-github-webhook-ingest/index.ts
npx tsx examples/04-full-loop-github/index.ts
```

## Adapter packages

| Package | Adapts |
|-|-|
| `@relayfile/adapter-core` | Schema-driven adapter runtime (YAML + OpenAPI) |
| `@relayfile/adapter-github` | GitHub (PRs, issues, reviews, commits) |
| `@relayfile/adapter-gitlab` | GitLab |
| `@relayfile/adapter-slack` | Slack |
| `@relayfile/adapter-teams` | Microsoft Teams |
| `@relayfile/adapter-linear` | Linear |
| `@relayfile/adapter-notion` | Notion |

## How adapters work

```
External Service                    VFS (Virtual Filesystem)
┌──────────────┐                   ┌──────────────────────────────────┐
│   Webhook    │──── normalize ───▶│ /github/repos/acme/api/pulls/42/ │
│   payload    │     + path map    │   metadata.json                  │
└──────────────┘                   └──────────┬───────────────────────┘
                                              │
                                     Agent reads & writes
                                              │
┌──────────────┐                   ┌──────────▼───────────────────────┐
│  GitHub API  │◀─── writeback ────│ /github/repos/acme/api/pulls/42/ │
│  POST review │     (path→API)    │   reviews/agent-review.json      │
└──────────────┘                   └──────────────────────────────────┘
```

See also: `packages/core/examples/resend/` for a real-world schema-driven
adapter built from an OpenAPI spec.
