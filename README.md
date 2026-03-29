# Relayfile Adapters

Map external services to the relayfile Virtual File System (VFS).

Each adapter has exactly 3 jobs:
1. **Path mapping** — compute VFS path from webhook events
2. **Webhook normalization** — convert provider-specific payloads to `WebhookInput`
3. **Writeback** — post changes back to source API via provider proxy

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@relayfile/adapter-core` | `@relayfile/adapter-core` | Schema-driven adapter generator |
| `@relayfile/adapter-github` | `@relayfile/adapter-github` | GitHub (PRs, issues, commits, checks, reviews) |
| `@relayfile/adapter-gitlab` | `@relayfile/adapter-gitlab` | GitLab (MRs, issues, pipelines, commits) |
| `@relayfile/adapter-teams` | `@relayfile/adapter-teams` | Microsoft Teams (channels, messages, chats) |
| `@relayfile/adapter-slack` | `@relayfile/adapter-slack` | Slack (channels, messages, reactions) |
| `@relayfile/adapter-linear` | `@relayfile/adapter-linear` | Linear (issues, projects, cycles) |
| `@relayfile/adapter-notion` | `@relayfile/adapter-notion` | Notion (pages, databases, blocks) |

## Development

```bash
npm install
npx turbo build
npx turbo test
```

## License

MIT
