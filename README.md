# Relayfile Adapters

Map external services to the [relayfile](https://github.com/AgentWorkforce/relayfile) Virtual File System (VFS).

Each adapter has exactly 3 jobs:
1. **Path mapping** — compute VFS path from webhook events
2. **Webhook normalization** — convert provider-specific payloads to `WebhookInput`
3. **Writeback** — post changes back to source API via provider proxy

## Quick Start

```bash
npm install @relayfile/sdk @relayfile/adapter-github @relayfile/provider-nango
```

### Receive a webhook and write to relayfile

```ts
import { RelayFileClient } from "@relayfile/sdk";
import { GitHubAdapter } from "@relayfile/adapter-github";
import { NangoProvider } from "@relayfile/provider-nango";

// 1. Connect to relayfile (defaults to api.relayfile.dev)
const relayfile = new RelayFileClient({
  token: process.env.RELAYFILE_TOKEN!,
});

// 2. Create a provider (handles auth + API proxying)
const provider = new NangoProvider(relayfile, {
  secretKey: process.env.NANGO_SECRET_KEY!,
});

// 3. Create the adapter
const adapter = new GitHubAdapter({ provider });

// 4. Handle an incoming webhook
app.post("/webhooks/github", async (req, res) => {
  // Normalize the webhook payload
  const event = adapter.normalizeWebhook(req.body, req.headers);

  // Compute the VFS path
  const path = adapter.computePath(event.objectType, event.objectId, {
    owner: req.body.repository.owner.login,
    repo: req.body.repository.name,
  });

  // Write to relayfile VFS
  await relayfile.putFile(process.env.WORKSPACE_ID!, path, {
    content: JSON.stringify(event.payload, null, 2),
    metadata: {
      source: "github",
      eventType: event.eventType,
      objectType: event.objectType,
    },
  });

  res.sendStatus(200);
});
```

### Read back and writeback

```ts
// Read PR data from VFS
const pr = await relayfile.getFile(workspaceId, "/github/repos/acme/api/pulls/42/metadata.json");

// Write a review comment back to GitHub via the adapter
await adapter.writeback({
  provider,
  connectionId: "conn_abc",
  path: "/github/repos/acme/api/pulls/42/reviews",
  payload: {
    body: "LGTM! Ship it.",
    event: "APPROVE",
  },
});
```

## How It Fits Together

```
GitHub/GitLab/Slack/...
        │ webhook
        ▼
   ┌─────────┐     ┌──────────┐     ┌──────────┐
   │ Adapter  │────▶│ Provider │────▶│ relayfile│
   │ (paths,  │     │ (auth,   │     │ (VFS     │
   │  webhook │     │  proxy)  │     │  storage)│
   │  normal- │     └──────────┘     └──────────┘
   │  ization)│           │
   └─────────┘           │ writeback
        ▲                 ▼
        │           External API
        └─────────────────┘
```

- **Adapter** knows _what_ data looks like and _where_ it goes in the VFS
- **Provider** knows _how_ to authenticate and proxy API calls
- **Relayfile** stores the data as files that agents can read

## Packages

| Package | Description |
|---------|-------------|
| `@relayfile/adapter-core` | Schema-driven adapter generator — build adapters from OpenAPI specs |
| `@relayfile/adapter-github` | GitHub (PRs, issues, commits, checks, reviews) |
| `@relayfile/adapter-gitlab` | GitLab (MRs, issues, pipelines, commits) |
| `@relayfile/adapter-teams` | Microsoft Teams (channels, messages, chats) |
| `@relayfile/adapter-slack` | Slack (channels, messages, reactions) |
| `@relayfile/adapter-linear` | Linear (issues, projects, cycles) |
| `@relayfile/adapter-notion` | Notion (pages, databases, blocks, comments) |

## Creating a New Adapter

Use `@relayfile/adapter-core` to generate an adapter from an OpenAPI spec:

```bash
npx adapter-core generate \
  --spec ./openapi.yaml \
  --mapping ./mapping.yaml \
  --output ./src
```

Or implement the `IntegrationAdapter` interface directly:

```ts
import type { IntegrationAdapter, WebhookInput } from "@relayfile/sdk";

export class MyAdapter implements IntegrationAdapter {
  computePath(objectType: string, objectId: string, context?: Record<string, string>): string {
    return `/myservice/${objectType}/${objectId}/metadata.json`;
  }

  normalizeWebhook(payload: unknown, headers?: Record<string, string>): WebhookInput {
    // Convert raw webhook to normalized format
  }

  async writeback(options: WritebackOptions): Promise<void> {
    // Post changes back to the source API
  }
}
```

## Development

```bash
npm install
npx turbo build
npx turbo test
```

## License

MIT
