<p align="center">
  <img src="assets/banner.png" alt="Relayfile Adapters — map any SaaS into the relayfile filesystem" />
</p>

# Relayfile Adapters

**Map any SaaS API into the relayfile filesystem — agents read with `cat`, write by saving files.**

An adapter is the small, focused piece of code that turns a SaaS integration into a directory tree. It tells [relayfile](https://github.com/AgentWorkforce/relayfile) where each resource lives in the virtual filesystem, how to interpret incoming webhooks from that service, and how to push agent edits back to the source API. Once an adapter exists for a service, agents can interact with it the same way they interact with any other file: open it, read it, write to it, list it, watch it.

Each adapter has exactly three jobs. **Path mapping** computes the VFS path for an object (a PR, an issue, a Slack message). **Webhook normalization** converts provider-specific event payloads into a uniform `WebhookInput` shape so the rest of the system doesn't care which SaaS sent it. **Writeback** takes a file an agent wrote and posts it back to the source API through a provider proxy. That's the whole contract — three functions, and a SaaS becomes a folder.

### What agents see

Agents don't use adapters, providers, or even the SDK. They read and write files — that's it:

```bash
# Agent reads a PR — it's a file on disk
cat /relayfile/github/repos/acme/api/pulls/42__bump-deps/meta.json

# Agent writes a review — it writes a file
echo '{"body": "LGTM! Ship it.", "event": "APPROVE"}' \
  > /relayfile/github/repos/acme/api/pulls/42__bump-deps/reviews/agent-review.json

# Done. The review is now posted to GitHub.
# The agent didn't import anything, call any API, or authenticate.
```

### Self-describing trees

Every adapter exposes the same navigation primitives so an agent never has to memorize paths:

- **`<sanitized-name>__<id>` filenames** — recover the id from the last `__`-separated segment (GitHub PR/issue dirs are `<number>__<slug>`, id-leading per the GitHub convention).
- **`_index.json` per directory** — sortable, deterministic listings of every entity in the directory.
- **`<integration>/LAYOUT.md`** — markdown guide describing the integration's tree shape, written by the adapter itself.
- **Alias trees** — `by-title/`, `by-id/`, `by-name/`, and `by-state/` mirror canonical entries under semantic keys for direct lookup without traversing the canonical hierarchy.

GitHub repo subtrees can be materialized lazily (opt-in via relayfile `--lazy-repos`) for huge-org workspaces.

That's the entire agent integration. No SDK. No OAuth. No GitHub API knowledge. The agent writes a file, and relayfile + the adapter + the provider handle everything else:

1. Relayfile detects the file write
2. The adapter matches the path (`/github/.../reviews/`) to a writeback rule
3. The provider authenticates and posts the review to GitHub's API

**The agent doesn't even know GitHub exists.** It just sees files.

## Coverage ceiling

The reason this architecture has a structurally larger reach than per-resource VFS projects is the split between **adapters** and **providers**.

- An **adapter** defines path mapping + webhook normalization + writeback for an *integration class* — issue trackers, chat platforms, CRMs, code hosts, and so on.
- A **provider** handles auth and HTTP proxying across an entire ecosystem of apps. [Nango](https://www.nango.dev) ships ~200 integrations. [Composio](https://composio.dev) ships ~250. [Pipedream](https://pipedream.com) ships 2,000+. One provider integration in relayfile unlocks every app that provider supports.

You don't write a new adapter per app. You write the *integration shape* once — what a "PR" looks like, what a "ticket" looks like, what a "chat message" looks like — and the provider layer handles the long tail of authenticating to and calling the actual services.

**Multiplicative coverage, not additive.** Each adapter × each provider's app catalog = the addressable surface. That ceiling scales with the provider ecosystem, not with how many integrations relayfile has personally written.

## Quick Start

```bash
npm install @relayfile/sdk @relayfile/adapter-github @relayfile/provider-nango @relayfile/webhook-server
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

For agents using the SDK programmatically (e.g., in a Node.js agent framework):

```ts
// Read
const pr = await relayfile.getFile(workspaceId, "/github/repos/acme/api/pulls/42__bump-deps/meta.json");

// Write — triggers the review on GitHub automatically
await relayfile.putFile(workspaceId, "/github/repos/acme/api/pulls/42__bump-deps/reviews/agent-review.json", {
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
| `@relayfile/adapter-airtable` | Airtable (bases, tables, records) |
| `@relayfile/adapter-asana` | Asana (projects, tasks, sections) |
| `@relayfile/adapter-calendly` | Calendly (event types, scheduled events, invitees) |
| `@relayfile/adapter-clickup` | ClickUp (spaces, lists, tasks) |
| `@relayfile/adapter-github` | GitHub (PRs, issues, commits, checks, reviews) |
| `@relayfile/adapter-gitlab` | GitLab (MRs, issues, pipelines, commits) |
| `@relayfile/adapter-hubspot` | HubSpot (contacts, deals, companies, tickets) |
| `@relayfile/adapter-intercom` | Intercom (conversations, contacts, articles) |
| `@relayfile/adapter-jira` | Jira (issues, projects, sprints) |
| `@relayfile/adapter-linear` | Linear (issues, projects, cycles) |
| `@relayfile/adapter-mailgun` | Mailgun (domains, messages, events) |
| `@relayfile/adapter-mixpanel` | Mixpanel (events, profiles, cohorts) |
| `@relayfile/adapter-notion` | Notion (pages, databases, blocks, comments) |
| `@relayfile/adapter-pipedrive` | Pipedrive (deals, persons, organizations, activities) |
| `@relayfile/adapter-salesforce` | Salesforce (leads, accounts, opportunities, contacts) |
| `@relayfile/adapter-segment` | Segment (sources, destinations, tracking events) |
| `@relayfile/adapter-sendgrid` | SendGrid (templates, campaigns, contacts) |
| `@relayfile/adapter-shopify` | Shopify (products, orders, customers) |
| `@relayfile/adapter-slack` | Slack (channels, messages, reactions) |
| `@relayfile/adapter-stripe` | Stripe (customers, charges, subscriptions, invoices) |
| `@relayfile/adapter-teams` | Microsoft Teams (channels, messages, chats) |
| `@relayfile/adapter-zendesk` | Zendesk (tickets, users, organizations) |
| `@relayfile/webhook-server` | Hono webhook receiver for adapter-driven relayfile ingestion |

## Mapping YAML Specification

See [docs/MAPPING_YAML_SPEC.md](docs/MAPPING_YAML_SPEC.md) for the formal specification of the mapping YAML format used by `@relayfile/adapter-core`.

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
    return `/myservice/${objectType}/${objectId}/meta.json`;
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

## How this compares

Other "give agents a filesystem" projects exist (e.g. [Mirage](https://github.com/strukto-ai/mirage)), and their work in this space is good. The scope is different: those projects focus on infrastructure and storage primitives — S3, Postgres, Redis, GDrive — exposed as a unified mount. Relayfile adapters focus on **SaaS integrations** — Linear, Notion, GitHub, Slack, HubSpot, Salesforce, Pipedrive, Jira, and the rest — with a uniform read/write/writeback contract per provider. Different scopes, both useful. Pick the one your work lives in.

Relayfile's structural edge for SaaS coverage is the adapter + provider split: one provider integration unlocks every app the provider supports. That's how the resource ceiling scales.

## License

MIT
