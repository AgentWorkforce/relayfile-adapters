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

### Getting started

**[Relayfile Cloud](https://relayfile.dev/pricing)** handles everything — auth, webhook routing, managed connections, agent permissions. You get a token from the dashboard and start reading/writing files. No infrastructure to manage.

**Self-hosted:** Run the [Go server](https://github.com/AgentWorkforce/relayfile) and [relayauth](https://github.com/AgentWorkforce/relayauth) yourself. Tokens are JWTs you mint via the relayauth SDK or dev scripts.

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

### What agents see

Agents don't use adapters, providers, or even the SDK. They read and write files — that's it:

```bash
# Agent reads a PR — it's a file on disk
cat /relayfile/github/repos/acme/api/pulls/42/metadata.json

# Agent writes a review — it writes a file
echo '{"body": "LGTM! Ship it.", "event": "APPROVE"}' \
  > /relayfile/github/repos/acme/api/pulls/42/reviews/agent-review.json

# Done. The review is now posted to GitHub.
# The agent didn't import anything, call any API, or authenticate.
```

That's the entire agent integration. No SDK. No OAuth. No GitHub API knowledge. The agent writes a file, and relayfile + the adapter + the provider handle everything else:

1. Relayfile detects the file write
2. The adapter matches the path (`/github/.../reviews/`) to a writeback rule
3. The provider authenticates and posts the review to GitHub's API

**The agent doesn't even know GitHub exists.** It just sees files.

For agents using the SDK programmatically (e.g., in a Node.js agent framework):

```ts
// Read
const pr = await relayfile.getFile(workspaceId, "/github/repos/acme/api/pulls/42/metadata.json");

// Write — triggers the review on GitHub automatically
await relayfile.putFile(workspaceId, "/github/repos/acme/api/pulls/42/reviews/agent-review.json", {
  content: JSON.stringify({ body: "LGTM!", event: "APPROVE" }),
});
```

### Programmatic writeback (for app developers)

If you need direct control over the writeback (e.g., in your backend), you can call the adapter explicitly:

```ts
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
