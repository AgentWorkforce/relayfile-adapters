import { workflow } from '@agent-relay/sdk/workflows';
import * as rickyWorkflowFs from 'node:fs';
import * as rickyWorkflowPath from 'node:path';

// IMPLEMENTATION_WORKFLOW_CONTRACT: implementation specs must produce source changes, tests, non-empty diff evidence, and PR/result reporting.
// RICKY_WORKFLOW_ENV_LOADER: load repo-local env files before spawning workflow agents.

function loadRickyWorkflowEnv(cwd = process.cwd()) {
  for (const file of ['.env.local', '.env']) {
    const path = rickyWorkflowPath.join(cwd, file);
    if (!rickyWorkflowFs.existsSync(path)) continue;
    const body = rickyWorkflowFs.readFileSync(path, 'utf8');
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!key || rawValue === undefined || process.env[key] !== undefined) continue;
      process.env[key] = unquoteRickyWorkflowEnvValue(rawValue);
    }
  }
}

function unquoteRickyWorkflowEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function assertRickyWorkflowEnv(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`MISSING_ENV_VAR: ${missing.join(', ')}. Add missing values to .env.local or export them before rerunning.`);
  }
}

async function main() {
  loadRickyWorkflowEnv();
  const result = await workflow("ricky-launch-catalog-spec-beat-mirage-by-launch-status")
    .description("# Launch Catalog Spec — Beat Mirage by Launch\n\nStatus: **draft v0** • Owner: relayfile-adapters • Target: launch +7d\n\n## 1. Goal\n\nShip a catalog that is **visibly larger than [Mirage's 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn't have.\n\nHard targets:\n\n- **≥ 50 catalog entries** at launch (vs Mirage's 32). Headline number on the site.\n- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.\n- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.\n- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.\n- Every Mirage-listed SaaS we don't already cover gets at least a Tier-3 entry, so no `mirage-vs-relayfile` matrix has a row where Mirage wins on coverage.\n\nNon-goals for launch:\n\n- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.\n- Replacing Pipedream/Nango on the auth side — we're a thin schema layer over them.\n- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single `query.json` writeback for now.\n\n## 2. Strategy: leverage what Mirage doesn't have\n\nThree multipliers we already have in-tree:\n\n1. **Schema-driven generation** — `@relayfile/adapter-core` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**\n2. **Provider matrix** — every adapter inherits OAuth from `@relayfile/provider-{nango,pipedream,composio,clerk}`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.\n3. **Webhook + writeback primitives** — already in `webhook-server` + adapter `writeback.ts`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.\n\n## 3. Tier definitions\n\n| Tier | Read | Write | Ingest | Sig verify | Tests | Use case |\n|---|---|---|---|---|---|---|\n| **T1** | ✓ | ✓ | webhook | required | path-mapper + writeback + signature fixtures | Daily-driver action surface |\n| **T2** | ✓ | ✓ | polling (cursor) | n/a | path-mapper + writeback fixtures | Webhook-less or write-rare APIs |\n| **T3** | ✓ | optional | polling | n/a | OpenAPI parse + smoke fixture | Long-tail + reference data |\n\nPromotion path: T3 → T2 once a write surface is justified by demand; T2 → T1 once webhooks land or polling becomes the bottleneck.\n\n## 4. Catalog (52 entries)\n\nBold = ships at launch. *Italic* = exists today.\n\n| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |\n|---|---|---|---|---|---|\n| **Local & primitives** ||||||\n| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing `relayfile-mount` |\n| 2 | **in-memory** | T1 | RAM | none | existing |\n| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |\n| **Object storage** ||||||\n| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |\n| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |\n| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |\n| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |\n| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |\n| **File storage SaaS** ||||||\n| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + `changes.watch` push |\n| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |\n| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |\n| **Microsoft 365** ||||||\n| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph `/me/messages` + Graph subscriptions |\n| 13 | **onedrive** | T2 | — | nango/pipedream | Graph `/drives` + subscriptions |\n| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |\n| **Google Workspace** ||||||\n| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub `users.watch` |\n| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + `events.watch` push |\n| 17 | **google-docs** | T2 | Docs | nango/pipedream | Docs v1 (read), Drive change events for ingest |\n| 18 | **google-sheets** | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |\n| 19 | **google-slides** | T3 | Slides | nango/pipedream | Slides v1 |\n| **Code & DevOps** ||||||\n| 20 | *github* | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |\n| 21 | *gitlab* | T1 | — | nango | REST v4 + webhooks |\n| 22 | **bitbucket** | T2 | — | nango | Cloud REST 2.0 + webhooks |\n| 23 | **vercel** | T2 | Vercel | nango | REST + deployment webhooks |\n| 24 | **netlify** | T3 | — | nango | REST + outgoing webhooks |\n| **Issue / Project** ||||||\n| 25 | *linear* | T1 | Linear | nango/pipedream | GraphQL + webhooks |\n| 26 | **jira** | T1 | — | nango/pipedream | REST v3 + webhooks |\n| 27 | **asana** | T1 | — | nango/pipedream | REST + webhooks |\n| 28 | **trello** | T2 | Trello | nango | REST + webhook callbacks |\n| 29 | **clickup** | T2 | — | nango | API v2 + webhooks |\n| 30 | **shortcut** | T3 | — | nango | REST v3 |\n| **Docs / Notes** ||||||\n| 31 | *notion* | T1 | Notion | nango (notion-ingest exists) | API + recently added webhooks |\n| 32 | **confluence** | T2 | — | nango/pipedream | REST + webhooks (Atlassian Connect) |\n| 33 | **coda** | T3 | — | nango | API v1 + webhooks |\n| **Chat** ||||||\n| 34 | *slack* | T1 | Slack | nango/pipedream | Web API + Events API |\n| 35 | *teams* | T2 | — | nango/pipedream | Graph chats + change notifications |\n| 36 | **discord** | T1 | Discord | nango | REST v10 + interaction webhooks |\n| 37 | **telegram** | T2 | Telegram | nango | Bot API + webhook setWebhook |\n| **CRM** ||||||\n| 38 | **hubspot** | T1 | — | nango/pipedream | CRM v3 + webhooks v3 |\n| 39 | **salesforce** | T2 | — | nango/pipedream | REST + Streaming/Platform Events |\n| 40 | **pipedrive** | T3 | — | nango | API v2 + webhooks v1 |\n| **Support** ||||||\n| 41 | **intercom** | T1 | — | nango/pipedream | REST + webhook topics |\n| 42 | **zendesk** | T2 | — | nango/pipedream | REST + webhooks/triggers |\n| 43 | **freshdesk** | T3 | — | nango | REST + webhook automations |\n| **Observability / incident** ||||||\n| 44 | **sentry** | T1 | — | nango | REST + webhook integrations |\n| 45 | **datadog** | T2 | — | nango | API v2 + webhooks integration |\n| 46 | **posthog** | T2 | PostHog | nango | API + action webhooks |\n| 47 | **pagerduty** | T1 | — | nango | REST + webhook subscriptions v3 |\n| 48 | **langfuse** | T3 | Langfuse | direct PAT | OpenAPI |\n| **DB / payments / email / research** ||||||\n| 49 | **postgres** | T3 | Postgres | direct DSN | LISTEN/NOTIFY for ingest, query.json writeback |\n| 50 | **mongodb** | T3 | MongoDB | direct DSN | change streams, query.json writeback |\n| 51 | **stripe** | T1 | — | nango | REST + signed webhooks |\n| 52 | **smtp-imap** | T2 | Email | direct creds | RFC 5321/3501 |\n| 53 | **semantic-scholar** | T3 | Semantic Scholar | optional API key | Graph API v1 |\n| 54 | **arxiv** | T3 | — | none | OAI-PMH / Atom feed |\n\n**54 entries; 32 in Mirage.** Of those, **17 Tier-1 (incl. existing)**, **18 Tier-2**, **19 Tier-3**.\n\nMirage rows we deliberately *don't* match:\n- **OPFS** — browser-only mount, covered conceptually by `local-disk` in our agent-side mount layer. Not a SaaS adapter.\n- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.\n- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.\n\nIf the marketing team wants 60+ headline number for splash, the \"stretch row\" candidates are: `oci`, `webflow`, `airtable`, `mailchimp`, `shopify`, `quickbooks` — all already have Nango templates and OpenAPI specs available.\n\n## 5. Tier-1 adapter spec sheets\n\nCompact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.\n\n### 5.1 `jira`\n\n- **Base URL**: `https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3`\n- **Auth**: OAuth 2.0 (3LO), `cloudid` resolved via `/oauth/token/accessible-resources`\n- **Pagination**: `startAt` / `maxResults` (offset, default 50, max 100); newer endpoints use `nextPageToken` (next-token)\n- **Webhooks**: registered via Connect app or REST `/rest/api/3/webhook`; signature header `X-Atlassian-Webhook-Identifier`\n- **Path mapping**:\n  - `/jira/projects/{projectKey}/issues/{issueKey}/metadata.json`\n  - `/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json`\n- **Webhook events**: `jira:issue_created|updated|deleted`, `comment_created|updated|deleted`\n- **Writeback globs**:\n  - `/jira/projects/*/issues/*/comments/*.json` → `POST /issue/{issueKey}/comment`\n  - `/jira/projects/*/issues/*/transition.json` → `POST /issue/{issueKey}/transitions`\n  - `/jira/projects/*/issues/*/metadata.json` (PUT) → `PUT /issue/{issueKey}`\n- **Nango template ref**: `integrations/jira`\n\n### 5.2 `asana`\n\n- **Base URL**: `https://app.asana.com/api/1.0`\n- **Auth**: OAuth 2.0 or PAT\n- **Pagination**: `offset` token in `next_page.offset`, `limit` 1–100\n- **Webhooks**: `POST /webhooks` with `target` URL; handshake via `X-Hook-Secret` echo; subsequent deliveries signed with `X-Hook-Signature` (HMAC-SHA256)\n- **Path mapping**:\n  - `/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json`\n  - `/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json`\n- **Webhook events**: `task.{added|changed|deleted}`, `story.added`\n- **Writeback globs**:\n  - `/asana/.../tasks/*/stories/*.json` → `POST /tasks/{tid}/stories`\n  - `/asana/.../tasks/*/metadata.json` (PUT) → `PUT /tasks/{tid}`\n- **Nango template ref**: `integrations/asana`\n\n### 5.3 `discord`\n\n- **Base URL**: `https://discord.com/api/v10`\n- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads\n- **Pagination**: `before` / `after` snowflake cursors\n- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)\n- **Signature verify**: Ed25519 over `X-Signature-Ed25519` + `X-Signature-Timestamp` (interactions). Channel webhooks aren't signed; rely on URL secrecy + IP allowlist.\n- **Path mapping**:\n  - `/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json`\n  - `/discord/guilds/{gid}/members/{uid}.json`\n- **Writeback globs**:\n  - `/discord/guilds/*/channels/*/messages/post.json` → `POST /channels/{cid}/messages`\n  - `/discord/guilds/*/channels/*/messages/*.json` (PUT) → `PATCH /channels/{cid}/messages/{mid}`\n\n### 5.4 `hubspot`\n\n- **Base URL**: `https://api.hubapi.com`\n- **Auth**: OAuth 2.0 or private app token\n- **Pagination**: `paging.next.after` cursor (`limit` ≤ 100)\n- **Webhooks**: configured per-app in HubSpot dev portal; signed with `X-HubSpot-Signature-v3` (HMAC-SHA256 over method + URI + body + timestamp)\n- **Path mapping**:\n  - `/hubspot/objects/contacts/{id}.json`\n  - `/hubspot/objects/deals/{id}.json`\n  - `/hubspot/objects/companies/{id}.json`\n- **Webhook events**: `contact.creation|propertyChange|deletion`, `deal.*`, `company.*`\n- **Writeback globs**:\n  - `/hubspot/objects/contacts/*.json` (PUT) → `PATCH /crm/v3/objects/contacts/{id}`\n  - `/hubspot/objects/contacts/create.json` → `POST /crm/v3/objects/contacts`\n- **Nango template ref**: `integrations/hubspot`\n\n### 5.5 `intercom`\n\n- **Base URL**: `https://api.intercom.io`\n- **Auth**: OAuth or access token\n- **Pagination**: `pages.next.starting_after` cursor (Conversations API)\n- **Webhooks**: per-app subscriptions, signed with `X-Hub-Signature` (HMAC-SHA1 over body using app client secret)\n- **Path mapping**:\n  - `/intercom/conversations/{id}/metadata.json`\n  - `/intercom/conversations/{id}/parts/{partId}.json`\n  - `/intercom/contacts/{id}.json`\n- **Webhook events**: `conversation.user.created|replied`, `conversation.admin.replied|noted`, `contact.*`\n- **Writeback globs**:\n  - `/intercom/conversations/*/reply.json` → `POST /conversations/{id}/reply`\n  - `/intercom/contacts/*.json` (PUT) → `PUT /contacts/{id}`\n\n### 5.6 `pagerduty`\n\n- **Base URL**: `https://api.pagerduty.com`\n- **Auth**: OAuth or REST API token (`Authorization: Token token=...`)\n- **Pagination**: `offset` / `limit` (max 100); newer endpoints use `cursor`\n- **Webhooks**: v3 subscriptions API (`POST /webhook_subscriptions`), signed with `X-PagerDuty-Signature` (HMAC-SHA256)\n- **Path mapping**:\n  - `/pagerduty/services/{sid}/incidents/{iid}/metadata.json`\n  - `/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json`\n- **Webhook events**: `incident.triggered|acknowledged|resolved|annotated`\n- **Writeback globs**:\n  - `/pagerduty/.../incidents/*/notes.json` → `POST /incidents/{iid}/notes`\n  - `/pagerduty/.../incidents/*/metadata.json` (PUT) → `PUT /incidents/{iid}`\n\n### 5.7 `sentry`\n\n- **Base URL**: `https://sentry.io/api/0`\n- **Auth**: OAuth or auth token (org-scoped)\n- **Pagination**: `Link` header cursor (link-header strategy)\n- **Webhooks**: per-integration; signed with `Sentry-Hook-Signature` (HMAC-SHA256 of body using integration client secret)\n- **Path mapping**:\n  - `/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json`\n  - `/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json`\n- **Webhook events**: `issue.created|resolved|assigned`, `error.created`\n- **Writeback globs**:\n  - `/sentry/.../issues/*/metadata.json` (PUT) → `PUT /issues/{issueId}`\n  - `/sentry/.../issues/*/comments.json` → `POST /issues/{issueId}/comments`\n\n### 5.8 `stripe`\n\n- **Base URL**: `https://api.stripe.com/v1`\n- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)\n- **Pagination**: `starting_after` cursor (objects sortable by creation)\n- **Webhooks**: signed with `Stripe-Signature` (timestamp + v1 HMAC-SHA256, anti-replay window)\n- **Path mapping**:\n  - `/stripe/customers/{cid}.json`\n  - `/stripe/customers/{cid}/subscriptions/{sid}.json`\n  - `/stripe/charges/{chargeId}.json`\n- **Webhook events**: `customer.*`, `invoice.*`, `charge.*`, `payment_intent.*`\n- **Writeback globs**:\n  - `/stripe/customers/*.json` (PUT) → `POST /customers/{cid}` (form-encoded)\n  - `/stripe/customers/*/refund.json` → `POST /refunds`\n\n### 5.9 `gmail`\n\n- **Base URL**: `https://gmail.googleapis.com/gmail/v1`\n- **Auth**: OAuth 2.0 (scopes: `gmail.readonly` + `gmail.send` + `gmail.modify`)\n- **Pagination**: `pageToken` (next-token)\n- **Ingest**: `users.watch` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream's Gmail trigger as ingest source)\n- **Path mapping**:\n  - `/gmail/messages/{messageId}/metadata.json`\n  - `/gmail/messages/{messageId}/raw.eml`\n  - `/gmail/labels/{labelId}/messages/` (virtual list)\n- **Writeback globs**:\n  - `/gmail/messages/send.json` → `POST /users/me/messages/send`\n  - `/gmail/messages/*/labels.json` (PUT) → `POST /users/me/messages/{id}/modify`\n\n### 5.10 `google-calendar`\n\n- **Base URL**: `https://www.googleapis.com/calendar/v3`\n- **Auth**: OAuth 2.0 (scope `calendar.events`)\n- **Pagination**: `pageToken` (next-token); incremental sync via `syncToken`\n- **Ingest**: `events.watch` push channels → webhook (channels expire ≤30d, need refresher)\n- **Path mapping**:\n  - `/gcal/calendars/{calId}/events/{eventId}.json`\n- **Webhook events**: `events.changed` (Google sends a sync ping; adapter pulls delta)\n- **Writeback globs**:\n  - `/gcal/calendars/*/events/*.json` (PUT) → `PUT /calendars/{calId}/events/{eventId}`\n  - `/gcal/calendars/*/events/create.json` → `POST /calendars/{calId}/events`\n\n### 5.11 `google-drive`\n\n- **Base URL**: `https://www.googleapis.com/drive/v3`\n- **Auth**: OAuth 2.0 (scopes: `drive` or `drive.file`)\n- **Pagination**: `pageToken` (next-token)\n- **Ingest**: `changes.watch` push channels (account-wide change feed)\n- **Path mapping**:\n  - `/gdrive/files/{fileId}/metadata.json`\n  - `/gdrive/files/{fileId}/content` (binary, exported per mimeType)\n- **Writeback globs**:\n  - `/gdrive/files/*/metadata.json` (PUT) → `PATCH /files/{fileId}` (rename, move via `addParents`/`removeParents`)\n  - `/gdrive/files/upload.json` → resumable upload `POST /upload/drive/v3/files`\n\n### 5.12 `slack` *(existing — list for completeness; verify parity)*\n\n- **Base URL**: `https://slack.com/api`\n- **Auth**: OAuth 2.0 (bot + user scopes)\n- **Pagination**: `response_metadata.next_cursor`\n- **Ingest**: Events API webhook, signed with `X-Slack-Signature` (v0 HMAC-SHA256 + timestamp)\n- **Already shipping** — confirm webhook signature and writeback globs match this spec.\n\n### 5.13 `linear` *(existing)*\n\n- GraphQL only. Confirm webhook subscriptions are configured during connection setup.\n\n### 5.14 `notion` *(existing)*\n\n- Notion shipped webhooks in 2025; mapping should add webhook entries for `page.updated`, `database.updated`, `comment.created`. Existing `notion-ingest-handler` in `provider-nango` should keep working as polling fallback.\n\n### 5.15 `s3`\n\n- **Base URL**: `https://{bucket}.s3.{region}.amazonaws.com`\n- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials\n- **Pagination**: `ContinuationToken` (cursor)\n- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)\n- **Path mapping**:\n  - `/s3/{bucket}/{key}` (binary content)\n  - `/s3/{bucket}/{key}/metadata.json` (object headers)\n- **Writeback globs**:\n  - `/s3/{bucket}/*` (PUT) → `PUT /{bucket}/{key}` (multipart for >5MB)\n\n### 5.16 `github` *(existing)*\n\n- Reference for everything. Don't change.\n\n### 5.17 `local-disk` *(existing — primitive)*\n\n- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by `relayfile-mount`.\n\n## 6. Tier-2 spec sheets (compact)\n\nFor T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.\n\n| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |\n|---|---|---|---|---|\n| `salesforce` | `https://{instance}.my.salesforce.com/services/data/v60.0` | next-record-url (link-style) | Streaming API / Platform Events sidecar | `/sf/objects/Account/*.json`, `/sf/objects/Contact/*.json` |\n| `zendesk` | `https://{sub}.zendesk.com/api/v2` | cursor (`after_cursor`) | Webhooks resource (`/webhooks`) signed with `X-Zendesk-Webhook-Signature` | `/zendesk/tickets/{id}/comments.json` |\n| `confluence` | `https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2` | `cursor` | Connect-app webhooks | `/confluence/spaces/{key}/pages/{id}/body.json` |\n| `bitbucket` | `https://api.bitbucket.org/2.0` | `next` URL | Repository webhooks | `/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json` |\n| `vercel` | `https://api.vercel.com` | `next` cursor | Deployment / log-drain webhooks | `/vercel/projects/{id}/env/*.json` |\n| `outlook-mail` | `https://graph.microsoft.com/v1.0/me` | `@odata.nextLink` | Graph subscriptions | `/outlook/messages/send.json` |\n| `onedrive` | `https://graph.microsoft.com/v1.0/me/drive` | `@odata.nextLink` | Graph subscriptions | `/onedrive/items/{id}` content + metadata |\n| `dropbox` | `https://api.dropboxapi.com/2` | `cursor` | account webhook + `files/list_folder/longpoll` | `/dropbox/files/{path}` |\n| `box` | `https://api.box.com/2.0` | `marker` | webhooks v2 (signed) | `/box/files/{id}`, `/box/folders/{id}/items` |\n| `posthog` | `https://app.posthog.com/api` | `next` URL | action webhooks | `/posthog/projects/{id}/insights/{iid}.json` |\n| `datadog` | `https://api.datadoghq.com/api/v2` | `next_cursor` | webhooks integration | `/datadog/monitors/{id}.json`, `/datadog/incidents/{id}.json` |\n| `gcs` | `https://storage.googleapis.com/storage/v1` | `pageToken` | Pub/Sub object change notifications | `/gcs/{bucket}/{object}` |\n| `azure-blob` | `https://{account}.blob.core.windows.net` | `marker` | Event Grid → relay | `/azureblob/{container}/{blob}` |\n| `r2` | S3-compatible | continuation-token | bucket → queue → relay | `/r2/{bucket}/{key}` |\n| `supabase` | `https://{ref}.supabase.co` | range header | already supported | reuse existing |\n| `clickup` | `https://api.clickup.com/api/v2` | `page` | webhooks | `/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json` |\n| `trello` | `https://api.trello.com/1` | none (list-based) | webhook callbacks | `/trello/boards/{id}/cards/{cardId}.json` |\n| `telegram` | `https://api.telegram.org/bot{token}` | `offset` | `setWebhook` | `/telegram/chats/{chatId}/messages/send.json` |\n| `teams` | Graph chats | `@odata.nextLink` | change notifications | already shipping; confirm |\n| `smtp-imap` | `imap://...` / `smtp://...` | IMAP UID | IMAP IDLE sidecar | `/email/inbox/{uid}.eml`, `/email/send.json` |\n| `ssh` | host:port | n/a | none | `/ssh/{host}/...` |\n\n## 7. Tier-3 spec sheets (catalog-only)\n\nEach T3 adapter ships:\n\n- A mapping YAML pointing at the public OpenAPI spec (or hand-written `samples` if no OpenAPI exists).\n- A read-only resource set generated by the schema adapter.\n- A single placeholder writeback (`/{adapter}/_unsupported.json` returns 501) to keep the contract consistent.\n- One smoke test fixture per object type.\n\nAdapters: `freshdesk`, `pipedrive`, `shortcut`, `coda`, `langfuse`, `sharepoint`, `google-slides`, `netlify`, `postgres`, `mongodb`, `semantic-scholar`, `arxiv`.\n\nFor `postgres` and `mongodb`, the read surface is a synthetic VFS:\n\n- `/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json` — generated by introspection\n- `/postgres/{db}/queries/{name}.sql` (write) → executes prepared statement, results land at `/postgres/{db}/queries/{name}.results.json`\n- `mongodb` analogous with collections + `.find.json` / `.results.json`\n\nThese are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage's Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.\n\n## 8. Build plan (7 days)\n\n| Day | Deliverable |\n|---|---|\n| **Mon** | Land scaffolding tooling: a `pnpm gen:adapter <name>` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a `templates/<name>.hints.yaml` for each row. |\n| **Tue** | T1 batch A: `jira`, `asana`, `hubspot`, `stripe` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |\n| **Wed** | T1 batch B: `intercom`, `pagerduty`, `sentry`, `discord` (4). |\n| **Thu** | T1 batch C: `gmail`, `google-calendar`, `google-drive`, `s3` (4). Push-channel/EventBridge ingest stubs land here. |\n| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |\n| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |\n| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a `mirage-vs-relayfile.md` row, and a smoke test in CI. Cut `@relayfile/adapters@<launch>` versions. |\n\nParallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever's free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.\n\n## 9. Quality bar\n\nPer-adapter checklist before a tag is cut:\n\n- [ ] `mapping.yaml` validated by `@relayfile/adapter-core` parser (zero warnings).\n- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.\n- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).\n- [ ] Pagination strategy declared and exercised by at least one fixture.\n- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.\n- [ ] One-line README + a row in `docs/CATALOG.md`.\n- [ ] Provider compatibility matrix (which providers are tested for this adapter).\n\nCI gate: a `pnpm catalog:audit` script asserts that the published catalog count ≥ Mirage's tracked count (manually maintained in `docs/MIRAGE_PARITY.md` and grepped from their docs weekly).\n\n## 10. Open questions\n\n1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.\n2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?\n3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.\n4. **Database adapters** (`postgres`, `mongodb`, `mysql`): is `query.json` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?\n5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?\n\n## 11. References\n\n- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)\n- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from `integrations/<name>/syncs/*.ts`\n- [`docs/MAPPING_YAML_SPEC.md`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into\n- [`docs/PATH_SLUGIFICATION_SPEC.md`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow\n- Provider package READMEs in `relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}`")
    .pattern("pipeline")
    .channel("wf-ricky-launch-catalog-spec-beat-mirage-by-launch-status")
    .maxConcurrency(1)
    .timeout(2700000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 1000 })

    .agent("lead-claude", { cli: "claude", interactive: false, role: "Plans task shape, ownership, non-goals, and verification gates.", retries: 1 })
    .agent("impl-primary-codex", { cli: "codex", role: "Primary implementer for the generated code-writing workflow.", retries: 2 })
    .agent("impl-tests-codex", { cli: "codex", role: "Adds or updates tests and validation coverage for the changed surface.", retries: 2 })
    .agent("reviewer-claude", { cli: "claude", preset: "reviewer", role: "Reviews product fit, scope control, and workflow evidence quality.", retries: 1 })
    .agent("reviewer-codex", { cli: "codex", preset: "reviewer", role: "Reviews TypeScript correctness, deterministic gates, and test coverage.", retries: 1 })
    .agent("validator-claude", { cli: "claude", preset: "worker", role: "Runs the 80-to-100 fix loop and verifies final readiness.", retries: 2 })

    .step("prepare-context", {
      type: 'deterministic',
      command: "mkdir -p '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status' && printf '%s\\n' '# Launch Catalog Spec — Beat Mirage by Launch\n\nStatus: **draft v0** • Owner: relayfile-adapters • Target: launch +7d\n\n## 1. Goal\n\nShip a catalog that is **visibly larger than [Mirage'\\''s 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn'\\''t have.\n\nHard targets:\n\n- **≥ 50 catalog entries** at launch (vs Mirage'\\''s 32). Headline number on the site.\n- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.\n- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.\n- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.\n- Every Mirage-listed SaaS we don'\\''t already cover gets at least a Tier-3 entry, so no `mirage-vs-relayfile` matrix has a row where Mirage wins on coverage.\n\nNon-goals for launch:\n\n- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.\n- Replacing Pipedream/Nango on the auth side — we'\\''re a thin schema layer over them.\n- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single `query.json` writeback for now.\n\n## 2. Strategy: leverage what Mirage doesn'\\''t have\n\nThree multipliers we already have in-tree:\n\n1. **Schema-driven generation** — `@relayfile/adapter-core` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**\n2. **Provider matrix** — every adapter inherits OAuth from `@relayfile/provider-{nango,pipedream,composio,clerk}`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.\n3. **Webhook + writeback primitives** — already in `webhook-server` + adapter `writeback.ts`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.\n\n## 3. Tier definitions\n\n| Tier | Read | Write | Ingest | Sig verify | Tests | Use case |\n|---|---|---|---|---|---|---|\n| **T1** | ✓ | ✓ | webhook | required | path-mapper + writeback + signature fixtures | Daily-driver action surface |\n| **T2** | ✓ | ✓ | polling (cursor) | n/a | path-mapper + writeback fixtures | Webhook-less or write-rare APIs |\n| **T3** | ✓ | optional | polling | n/a | OpenAPI parse + smoke fixture | Long-tail + reference data |\n\nPromotion path: T3 → T2 once a write surface is justified by demand; T2 → T1 once webhooks land or polling becomes the bottleneck.\n\n## 4. Catalog (52 entries)\n\nBold = ships at launch. *Italic* = exists today.\n\n| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |\n|---|---|---|---|---|---|\n| **Local & primitives** ||||||\n| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing `relayfile-mount` |\n| 2 | **in-memory** | T1 | RAM | none | existing |\n| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |\n| **Object storage** ||||||\n| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |\n| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |\n| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |\n| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |\n| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |\n| **File storage SaaS** ||||||\n| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + `changes.watch` push |\n| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |\n| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |\n| **Microsoft 365** ||||||\n| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph `/me/messages` + Graph subscriptions |\n| 13 | **onedrive** | T2 | — | nango/pipedream | Graph `/drives` + subscriptions |\n| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |\n| **Google Workspace** ||||||\n| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub `users.watch` |\n| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + `events.watch` push |\n| 17 | **google-docs** | T2 | Docs | nango/pipedream | Docs v1 (read), Drive change events for ingest |\n| 18 | **google-sheets** | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |\n| 19 | **google-slides** | T3 | Slides | nango/pipedream | Slides v1 |\n| **Code & DevOps** ||||||\n| 20 | *github* | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |\n| 21 | *gitlab* | T1 | — | nango | REST v4 + webhooks |\n| 22 | **bitbucket** | T2 | — | nango | Cloud REST 2.0 + webhooks |\n| 23 | **vercel** | T2 | Vercel | nango | REST + deployment webhooks |\n| 24 | **netlify** | T3 | — | nango | REST + outgoing webhooks |\n| **Issue / Project** ||||||\n| 25 | *linear* | T1 | Linear | nango/pipedream | GraphQL + webhooks |\n| 26 | **jira** | T1 | — | nango/pipedream | REST v3 + webhooks |\n| 27 | **asana** | T1 | — | nango/pipedream | REST + webhooks |\n| 28 | **trello** | T2 | Trello | nango | REST + webhook callbacks |\n| 29 | **clickup** | T2 | — | nango | API v2 + webhooks |\n| 30 | **shortcut** | T3 | — | nango | REST v3 |\n| **Docs / Notes** ||||||\n| 31 | *notion* | T1 | Notion | nango (notion-ingest exists) | API + recently added webhooks |\n| 32 | **confluence** | T2 | — | nango/pipedream | REST + webhooks (Atlassian Connect) |\n| 33 | **coda** | T3 | — | nango | API v1 + webhooks |\n| **Chat** ||||||\n| 34 | *slack* | T1 | Slack | nango/pipedream | Web API + Events API |\n| 35 | *teams* | T2 | — | nango/pipedream | Graph chats + change notifications |\n| 36 | **discord** | T1 | Discord | nango | REST v10 + interaction webhooks |\n| 37 | **telegram** | T2 | Telegram | nango | Bot API + webhook setWebhook |\n| **CRM** ||||||\n| 38 | **hubspot** | T1 | — | nango/pipedream | CRM v3 + webhooks v3 |\n| 39 | **salesforce** | T2 | — | nango/pipedream | REST + Streaming/Platform Events |\n| 40 | **pipedrive** | T3 | — | nango | API v2 + webhooks v1 |\n| **Support** ||||||\n| 41 | **intercom** | T1 | — | nango/pipedream | REST + webhook topics |\n| 42 | **zendesk** | T2 | — | nango/pipedream | REST + webhooks/triggers |\n| 43 | **freshdesk** | T3 | — | nango | REST + webhook automations |\n| **Observability / incident** ||||||\n| 44 | **sentry** | T1 | — | nango | REST + webhook integrations |\n| 45 | **datadog** | T2 | — | nango | API v2 + webhooks integration |\n| 46 | **posthog** | T2 | PostHog | nango | API + action webhooks |\n| 47 | **pagerduty** | T1 | — | nango | REST + webhook subscriptions v3 |\n| 48 | **langfuse** | T3 | Langfuse | direct PAT | OpenAPI |\n| **DB / payments / email / research** ||||||\n| 49 | **postgres** | T3 | Postgres | direct DSN | LISTEN/NOTIFY for ingest, query.json writeback |\n| 50 | **mongodb** | T3 | MongoDB | direct DSN | change streams, query.json writeback |\n| 51 | **stripe** | T1 | — | nango | REST + signed webhooks |\n| 52 | **smtp-imap** | T2 | Email | direct creds | RFC 5321/3501 |\n| 53 | **semantic-scholar** | T3 | Semantic Scholar | optional API key | Graph API v1 |\n| 54 | **arxiv** | T3 | — | none | OAI-PMH / Atom feed |\n\n**54 entries; 32 in Mirage.** Of those, **17 Tier-1 (incl. existing)**, **18 Tier-2**, **19 Tier-3**.\n\nMirage rows we deliberately *don'\\''t* match:\n- **OPFS** — browser-only mount, covered conceptually by `local-disk` in our agent-side mount layer. Not a SaaS adapter.\n- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.\n- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.\n\nIf the marketing team wants 60+ headline number for splash, the \"stretch row\" candidates are: `oci`, `webflow`, `airtable`, `mailchimp`, `shopify`, `quickbooks` — all already have Nango templates and OpenAPI specs available.\n\n## 5. Tier-1 adapter spec sheets\n\nCompact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.\n\n### 5.1 `jira`\n\n- **Base URL**: `https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3`\n- **Auth**: OAuth 2.0 (3LO), `cloudid` resolved via `/oauth/token/accessible-resources`\n- **Pagination**: `startAt` / `maxResults` (offset, default 50, max 100); newer endpoints use `nextPageToken` (next-token)\n- **Webhooks**: registered via Connect app or REST `/rest/api/3/webhook`; signature header `X-Atlassian-Webhook-Identifier`\n- **Path mapping**:\n  - `/jira/projects/{projectKey}/issues/{issueKey}/metadata.json`\n  - `/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json`\n- **Webhook events**: `jira:issue_created|updated|deleted`, `comment_created|updated|deleted`\n- **Writeback globs**:\n  - `/jira/projects/*/issues/*/comments/*.json` → `POST /issue/{issueKey}/comment`\n  - `/jira/projects/*/issues/*/transition.json` → `POST /issue/{issueKey}/transitions`\n  - `/jira/projects/*/issues/*/metadata.json` (PUT) → `PUT /issue/{issueKey}`\n- **Nango template ref**: `integrations/jira`\n\n### 5.2 `asana`\n\n- **Base URL**: `https://app.asana.com/api/1.0`\n- **Auth**: OAuth 2.0 or PAT\n- **Pagination**: `offset` token in `next_page.offset`, `limit` 1–100\n- **Webhooks**: `POST /webhooks` with `target` URL; handshake via `X-Hook-Secret` echo; subsequent deliveries signed with `X-Hook-Signature` (HMAC-SHA256)\n- **Path mapping**:\n  - `/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json`\n  - `/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json`\n- **Webhook events**: `task.{added|changed|deleted}`, `story.added`\n- **Writeback globs**:\n  - `/asana/.../tasks/*/stories/*.json` → `POST /tasks/{tid}/stories`\n  - `/asana/.../tasks/*/metadata.json` (PUT) → `PUT /tasks/{tid}`\n- **Nango template ref**: `integrations/asana`\n\n### 5.3 `discord`\n\n- **Base URL**: `https://discord.com/api/v10`\n- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads\n- **Pagination**: `before` / `after` snowflake cursors\n- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)\n- **Signature verify**: Ed25519 over `X-Signature-Ed25519` + `X-Signature-Timestamp` (interactions). Channel webhooks aren'\\''t signed; rely on URL secrecy + IP allowlist.\n- **Path mapping**:\n  - `/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json`\n  - `/discord/guilds/{gid}/members/{uid}.json`\n- **Writeback globs**:\n  - `/discord/guilds/*/channels/*/messages/post.json` → `POST /channels/{cid}/messages`\n  - `/discord/guilds/*/channels/*/messages/*.json` (PUT) → `PATCH /channels/{cid}/messages/{mid}`\n\n### 5.4 `hubspot`\n\n- **Base URL**: `https://api.hubapi.com`\n- **Auth**: OAuth 2.0 or private app token\n- **Pagination**: `paging.next.after` cursor (`limit` ≤ 100)\n- **Webhooks**: configured per-app in HubSpot dev portal; signed with `X-HubSpot-Signature-v3` (HMAC-SHA256 over method + URI + body + timestamp)\n- **Path mapping**:\n  - `/hubspot/objects/contacts/{id}.json`\n  - `/hubspot/objects/deals/{id}.json`\n  - `/hubspot/objects/companies/{id}.json`\n- **Webhook events**: `contact.creation|propertyChange|deletion`, `deal.*`, `company.*`\n- **Writeback globs**:\n  - `/hubspot/objects/contacts/*.json` (PUT) → `PATCH /crm/v3/objects/contacts/{id}`\n  - `/hubspot/objects/contacts/create.json` → `POST /crm/v3/objects/contacts`\n- **Nango template ref**: `integrations/hubspot`\n\n### 5.5 `intercom`\n\n- **Base URL**: `https://api.intercom.io`\n- **Auth**: OAuth or access token\n- **Pagination**: `pages.next.starting_after` cursor (Conversations API)\n- **Webhooks**: per-app subscriptions, signed with `X-Hub-Signature` (HMAC-SHA1 over body using app client secret)\n- **Path mapping**:\n  - `/intercom/conversations/{id}/metadata.json`\n  - `/intercom/conversations/{id}/parts/{partId}.json`\n  - `/intercom/contacts/{id}.json`\n- **Webhook events**: `conversation.user.created|replied`, `conversation.admin.replied|noted`, `contact.*`\n- **Writeback globs**:\n  - `/intercom/conversations/*/reply.json` → `POST /conversations/{id}/reply`\n  - `/intercom/contacts/*.json` (PUT) → `PUT /contacts/{id}`\n\n### 5.6 `pagerduty`\n\n- **Base URL**: `https://api.pagerduty.com`\n- **Auth**: OAuth or REST API token (`Authorization: Token token=...`)\n- **Pagination**: `offset` / `limit` (max 100); newer endpoints use `cursor`\n- **Webhooks**: v3 subscriptions API (`POST /webhook_subscriptions`), signed with `X-PagerDuty-Signature` (HMAC-SHA256)\n- **Path mapping**:\n  - `/pagerduty/services/{sid}/incidents/{iid}/metadata.json`\n  - `/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json`\n- **Webhook events**: `incident.triggered|acknowledged|resolved|annotated`\n- **Writeback globs**:\n  - `/pagerduty/.../incidents/*/notes.json` → `POST /incidents/{iid}/notes`\n  - `/pagerduty/.../incidents/*/metadata.json` (PUT) → `PUT /incidents/{iid}`\n\n### 5.7 `sentry`\n\n- **Base URL**: `https://sentry.io/api/0`\n- **Auth**: OAuth or auth token (org-scoped)\n- **Pagination**: `Link` header cursor (link-header strategy)\n- **Webhooks**: per-integration; signed with `Sentry-Hook-Signature` (HMAC-SHA256 of body using integration client secret)\n- **Path mapping**:\n  - `/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json`\n  - `/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json`\n- **Webhook events**: `issue.created|resolved|assigned`, `error.created`\n- **Writeback globs**:\n  - `/sentry/.../issues/*/metadata.json` (PUT) → `PUT /issues/{issueId}`\n  - `/sentry/.../issues/*/comments.json` → `POST /issues/{issueId}/comments`\n\n### 5.8 `stripe`\n\n- **Base URL**: `https://api.stripe.com/v1`\n- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)\n- **Pagination**: `starting_after` cursor (objects sortable by creation)\n- **Webhooks**: signed with `Stripe-Signature` (timestamp + v1 HMAC-SHA256, anti-replay window)\n- **Path mapping**:\n  - `/stripe/customers/{cid}.json`\n  - `/stripe/customers/{cid}/subscriptions/{sid}.json`\n  - `/stripe/charges/{chargeId}.json`\n- **Webhook events**: `customer.*`, `invoice.*`, `charge.*`, `payment_intent.*`\n- **Writeback globs**:\n  - `/stripe/customers/*.json` (PUT) → `POST /customers/{cid}` (form-encoded)\n  - `/stripe/customers/*/refund.json` → `POST /refunds`\n\n### 5.9 `gmail`\n\n- **Base URL**: `https://gmail.googleapis.com/gmail/v1`\n- **Auth**: OAuth 2.0 (scopes: `gmail.readonly` + `gmail.send` + `gmail.modify`)\n- **Pagination**: `pageToken` (next-token)\n- **Ingest**: `users.watch` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream'\\''s Gmail trigger as ingest source)\n- **Path mapping**:\n  - `/gmail/messages/{messageId}/metadata.json`\n  - `/gmail/messages/{messageId}/raw.eml`\n  - `/gmail/labels/{labelId}/messages/` (virtual list)\n- **Writeback globs**:\n  - `/gmail/messages/send.json` → `POST /users/me/messages/send`\n  - `/gmail/messages/*/labels.json` (PUT) → `POST /users/me/messages/{id}/modify`\n\n### 5.10 `google-calendar`\n\n- **Base URL**: `https://www.googleapis.com/calendar/v3`\n- **Auth**: OAuth 2.0 (scope `calendar.events`)\n- **Pagination**: `pageToken` (next-token); incremental sync via `syncToken`\n- **Ingest**: `events.watch` push channels → webhook (channels expire ≤30d, need refresher)\n- **Path mapping**:\n  - `/gcal/calendars/{calId}/events/{eventId}.json`\n- **Webhook events**: `events.changed` (Google sends a sync ping; adapter pulls delta)\n- **Writeback globs**:\n  - `/gcal/calendars/*/events/*.json` (PUT) → `PUT /calendars/{calId}/events/{eventId}`\n  - `/gcal/calendars/*/events/create.json` → `POST /calendars/{calId}/events`\n\n### 5.11 `google-drive`\n\n- **Base URL**: `https://www.googleapis.com/drive/v3`\n- **Auth**: OAuth 2.0 (scopes: `drive` or `drive.file`)\n- **Pagination**: `pageToken` (next-token)\n- **Ingest**: `changes.watch` push channels (account-wide change feed)\n- **Path mapping**:\n  - `/gdrive/files/{fileId}/metadata.json`\n  - `/gdrive/files/{fileId}/content` (binary, exported per mimeType)\n- **Writeback globs**:\n  - `/gdrive/files/*/metadata.json` (PUT) → `PATCH /files/{fileId}` (rename, move via `addParents`/`removeParents`)\n  - `/gdrive/files/upload.json` → resumable upload `POST /upload/drive/v3/files`\n\n### 5.12 `slack` *(existing — list for completeness; verify parity)*\n\n- **Base URL**: `https://slack.com/api`\n- **Auth**: OAuth 2.0 (bot + user scopes)\n- **Pagination**: `response_metadata.next_cursor`\n- **Ingest**: Events API webhook, signed with `X-Slack-Signature` (v0 HMAC-SHA256 + timestamp)\n- **Already shipping** — confirm webhook signature and writeback globs match this spec.\n\n### 5.13 `linear` *(existing)*\n\n- GraphQL only. Confirm webhook subscriptions are configured during connection setup.\n\n### 5.14 `notion` *(existing)*\n\n- Notion shipped webhooks in 2025; mapping should add webhook entries for `page.updated`, `database.updated`, `comment.created`. Existing `notion-ingest-handler` in `provider-nango` should keep working as polling fallback.\n\n### 5.15 `s3`\n\n- **Base URL**: `https://{bucket}.s3.{region}.amazonaws.com`\n- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials\n- **Pagination**: `ContinuationToken` (cursor)\n- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)\n- **Path mapping**:\n  - `/s3/{bucket}/{key}` (binary content)\n  - `/s3/{bucket}/{key}/metadata.json` (object headers)\n- **Writeback globs**:\n  - `/s3/{bucket}/*` (PUT) → `PUT /{bucket}/{key}` (multipart for >5MB)\n\n### 5.16 `github` *(existing)*\n\n- Reference for everything. Don'\\''t change.\n\n### 5.17 `local-disk` *(existing — primitive)*\n\n- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by `relayfile-mount`.\n\n## 6. Tier-2 spec sheets (compact)\n\nFor T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.\n\n| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |\n|---|---|---|---|---|\n| `salesforce` | `https://{instance}.my.salesforce.com/services/data/v60.0` | next-record-url (link-style) | Streaming API / Platform Events sidecar | `/sf/objects/Account/*.json`, `/sf/objects/Contact/*.json` |\n| `zendesk` | `https://{sub}.zendesk.com/api/v2` | cursor (`after_cursor`) | Webhooks resource (`/webhooks`) signed with `X-Zendesk-Webhook-Signature` | `/zendesk/tickets/{id}/comments.json` |\n| `confluence` | `https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2` | `cursor` | Connect-app webhooks | `/confluence/spaces/{key}/pages/{id}/body.json` |\n| `bitbucket` | `https://api.bitbucket.org/2.0` | `next` URL | Repository webhooks | `/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json` |\n| `vercel` | `https://api.vercel.com` | `next` cursor | Deployment / log-drain webhooks | `/vercel/projects/{id}/env/*.json` |\n| `outlook-mail` | `https://graph.microsoft.com/v1.0/me` | `@odata.nextLink` | Graph subscriptions | `/outlook/messages/send.json` |\n| `onedrive` | `https://graph.microsoft.com/v1.0/me/drive` | `@odata.nextLink` | Graph subscriptions | `/onedrive/items/{id}` content + metadata |\n| `dropbox` | `https://api.dropboxapi.com/2` | `cursor` | account webhook + `files/list_folder/longpoll` | `/dropbox/files/{path}` |\n| `box` | `https://api.box.com/2.0` | `marker` | webhooks v2 (signed) | `/box/files/{id}`, `/box/folders/{id}/items` |\n| `posthog` | `https://app.posthog.com/api` | `next` URL | action webhooks | `/posthog/projects/{id}/insights/{iid}.json` |\n| `datadog` | `https://api.datadoghq.com/api/v2` | `next_cursor` | webhooks integration | `/datadog/monitors/{id}.json`, `/datadog/incidents/{id}.json` |\n| `gcs` | `https://storage.googleapis.com/storage/v1` | `pageToken` | Pub/Sub object change notifications | `/gcs/{bucket}/{object}` |\n| `azure-blob` | `https://{account}.blob.core.windows.net` | `marker` | Event Grid → relay | `/azureblob/{container}/{blob}` |\n| `r2` | S3-compatible | continuation-token | bucket → queue → relay | `/r2/{bucket}/{key}` |\n| `supabase` | `https://{ref}.supabase.co` | range header | already supported | reuse existing |\n| `clickup` | `https://api.clickup.com/api/v2` | `page` | webhooks | `/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json` |\n| `trello` | `https://api.trello.com/1` | none (list-based) | webhook callbacks | `/trello/boards/{id}/cards/{cardId}.json` |\n| `telegram` | `https://api.telegram.org/bot{token}` | `offset` | `setWebhook` | `/telegram/chats/{chatId}/messages/send.json` |\n| `teams` | Graph chats | `@odata.nextLink` | change notifications | already shipping; confirm |\n| `smtp-imap` | `imap://...` / `smtp://...` | IMAP UID | IMAP IDLE sidecar | `/email/inbox/{uid}.eml`, `/email/send.json` |\n| `ssh` | host:port | n/a | none | `/ssh/{host}/...` |\n\n## 7. Tier-3 spec sheets (catalog-only)\n\nEach T3 adapter ships:\n\n- A mapping YAML pointing at the public OpenAPI spec (or hand-written `samples` if no OpenAPI exists).\n- A read-only resource set generated by the schema adapter.\n- A single placeholder writeback (`/{adapter}/_unsupported.json` returns 501) to keep the contract consistent.\n- One smoke test fixture per object type.\n\nAdapters: `freshdesk`, `pipedrive`, `shortcut`, `coda`, `langfuse`, `sharepoint`, `google-slides`, `netlify`, `postgres`, `mongodb`, `semantic-scholar`, `arxiv`.\n\nFor `postgres` and `mongodb`, the read surface is a synthetic VFS:\n\n- `/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json` — generated by introspection\n- `/postgres/{db}/queries/{name}.sql` (write) → executes prepared statement, results land at `/postgres/{db}/queries/{name}.results.json`\n- `mongodb` analogous with collections + `.find.json` / `.results.json`\n\nThese are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage'\\''s Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.\n\n## 8. Build plan (7 days)\n\n| Day | Deliverable |\n|---|---|\n| **Mon** | Land scaffolding tooling: a `pnpm gen:adapter <name>` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a `templates/<name>.hints.yaml` for each row. |\n| **Tue** | T1 batch A: `jira`, `asana`, `hubspot`, `stripe` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |\n| **Wed** | T1 batch B: `intercom`, `pagerduty`, `sentry`, `discord` (4). |\n| **Thu** | T1 batch C: `gmail`, `google-calendar`, `google-drive`, `s3` (4). Push-channel/EventBridge ingest stubs land here. |\n| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |\n| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |\n| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a `mirage-vs-relayfile.md` row, and a smoke test in CI. Cut `@relayfile/adapters@<launch>` versions. |\n\nParallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever'\\''s free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.\n\n## 9. Quality bar\n\nPer-adapter checklist before a tag is cut:\n\n- [ ] `mapping.yaml` validated by `@relayfile/adapter-core` parser (zero warnings).\n- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.\n- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).\n- [ ] Pagination strategy declared and exercised by at least one fixture.\n- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.\n- [ ] One-line README + a row in `docs/CATALOG.md`.\n- [ ] Provider compatibility matrix (which providers are tested for this adapter).\n\nCI gate: a `pnpm catalog:audit` script asserts that the published catalog count ≥ Mirage'\\''s tracked count (manually maintained in `docs/MIRAGE_PARITY.md` and grepped from their docs weekly).\n\n## 10. Open questions\n\n1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.\n2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?\n3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.\n4. **Database adapters** (`postgres`, `mongodb`, `mysql`): is `query.json` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?\n5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?\n\n## 11. References\n\n- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)\n- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from `integrations/<name>/syncs/*.ts`\n- [`docs/MAPPING_YAML_SPEC.md`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into\n- [`docs/PATH_SLUGIFICATION_SPEC.md`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow\n- Provider package READMEs in `relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}`' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/normalized-spec.txt' && printf '%s\\n' 'pattern=pipeline; reason=Selected pipeline using choosing-swarm-patterns because the request is high risk and can proceed through a linear reliability ladder.' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/pattern-decision.txt' && printf '%s\\n' 'relay-80-100-workflow confidence=1 reason=Spec text mentions \"must\". Spec text mentions \"validate\". Spec text mentions \"before\". Spec text mentions \"covers\". Spec text mentions \"going\". Spec text mentions \"code\". Spec text mentions \"feature\". Spec text mentions \"works\". Spec text mentions \"tested\". Spec text mentions \"in-memory\". Spec text mentions \"postgres\". Spec text mentions \"sandbox\". Spec text mentions \"verify\". Spec text mentions \"after\". Spec text mentions \"every\". Spec text mentions \"full\". Spec text mentions \"passing\". Spec text mentions \"tests\". evidence=keyword:must, keyword:validate, keyword:before, keyword:covers, keyword:going, keyword:code, keyword:feature, keyword:works, keyword:tested, keyword:in-memory, keyword:postgres, keyword:sandbox, keyword:verify, keyword:after, keyword:every, keyword:full, keyword:passing, keyword:tests\nwriting-agent-relay-workflows confidence=1 reason=Spec text mentions \"relay\". Spec text mentions \"covers\". Spec text mentions \"agent\". Spec text mentions \"definitions\". Spec text mentions \"verification\". Spec text mentions \"owner\". Spec text mentions \"channels\". Spec text mentions \"channel\". Spec text mentions \"error\". Spec text mentions \"event\". Spec text mentions \"rules\". Spec text mentions \"team\". evidence=keyword:relay, keyword:covers, keyword:agent, keyword:definitions, keyword:verification, keyword:owner, keyword:channels, keyword:channel, keyword:error, keyword:event, keyword:rules, keyword:team\nrunning-headless-orchestrator confidence=0.8 reason=Spec text mentions \"agent\". Spec text mentions \"team\". Spec text mentions \"covers\". Spec text mentions \"without\". evidence=keyword:agent, keyword:team, keyword:covers, keyword:without\nchoosing-swarm-patterns confidence=0.4 reason=Spec text mentions \"pick\". Spec text mentions \"covers\". evidence=keyword:pick, keyword:covers' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/loaded-skills.txt' && printf '%s\\n' '[{\"id\":\"relay-80-100-workflow\",\"name\":\"relay-80-100-workflow\",\"confidence\":1,\"reason\":\"Spec text mentions \\\"must\\\". Spec text mentions \\\"validate\\\". Spec text mentions \\\"before\\\". Spec text mentions \\\"covers\\\". Spec text mentions \\\"going\\\". Spec text mentions \\\"code\\\". Spec text mentions \\\"feature\\\". Spec text mentions \\\"works\\\". Spec text mentions \\\"tested\\\". Spec text mentions \\\"in-memory\\\". Spec text mentions \\\"postgres\\\". Spec text mentions \\\"sandbox\\\". Spec text mentions \\\"verify\\\". Spec text mentions \\\"after\\\". Spec text mentions \\\"every\\\". Spec text mentions \\\"full\\\". Spec text mentions \\\"passing\\\". Spec text mentions \\\"tests\\\".\",\"evidence\":[{\"trigger\":\"must\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"must\\\".\"},{\"trigger\":\"validate\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"validate\\\".\"},{\"trigger\":\"before\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"before\\\".\"},{\"trigger\":\"covers\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"covers\\\".\"},{\"trigger\":\"going\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"going\\\".\"},{\"trigger\":\"code\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"code\\\".\"},{\"trigger\":\"feature\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"feature\\\".\"},{\"trigger\":\"works\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"works\\\".\"},{\"trigger\":\"tested\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"tested\\\".\"},{\"trigger\":\"in-memory\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"in-memory\\\".\"},{\"trigger\":\"postgres\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"postgres\\\".\"},{\"trigger\":\"sandbox\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"sandbox\\\".\"},{\"trigger\":\"verify\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"verify\\\".\"},{\"trigger\":\"after\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"after\\\".\"},{\"trigger\":\"every\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"every\\\".\"},{\"trigger\":\"full\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"full\\\".\"},{\"trigger\":\"passing\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"passing\\\".\"},{\"trigger\":\"tests\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"tests\\\".\"}]},{\"id\":\"writing-agent-relay-workflows\",\"name\":\"writing-agent-relay-workflows\",\"confidence\":1,\"reason\":\"Spec text mentions \\\"relay\\\". Spec text mentions \\\"covers\\\". Spec text mentions \\\"agent\\\". Spec text mentions \\\"definitions\\\". Spec text mentions \\\"verification\\\". Spec text mentions \\\"owner\\\". Spec text mentions \\\"channels\\\". Spec text mentions \\\"channel\\\". Spec text mentions \\\"error\\\". Spec text mentions \\\"event\\\". Spec text mentions \\\"rules\\\". Spec text mentions \\\"team\\\".\",\"evidence\":[{\"trigger\":\"relay\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"relay\\\".\"},{\"trigger\":\"covers\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"covers\\\".\"},{\"trigger\":\"agent\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agent\\\".\"},{\"trigger\":\"definitions\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"definitions\\\".\"},{\"trigger\":\"verification\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"verification\\\".\"},{\"trigger\":\"owner\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"owner\\\".\"},{\"trigger\":\"channels\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"channels\\\".\"},{\"trigger\":\"channel\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"channel\\\".\"},{\"trigger\":\"error\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"error\\\".\"},{\"trigger\":\"event\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"event\\\".\"},{\"trigger\":\"rules\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"rules\\\".\"},{\"trigger\":\"team\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"team\\\".\"}]},{\"id\":\"running-headless-orchestrator\",\"name\":\"running-headless-orchestrator\",\"confidence\":0.8,\"reason\":\"Spec text mentions \\\"agent\\\". Spec text mentions \\\"team\\\". Spec text mentions \\\"covers\\\". Spec text mentions \\\"without\\\".\",\"evidence\":[{\"trigger\":\"agent\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agent\\\".\"},{\"trigger\":\"team\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"team\\\".\"},{\"trigger\":\"covers\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"covers\\\".\"},{\"trigger\":\"without\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"without\\\".\"}]},{\"id\":\"choosing-swarm-patterns\",\"name\":\"choosing-swarm-patterns\",\"confidence\":0.4,\"reason\":\"Spec text mentions \\\"pick\\\". Spec text mentions \\\"covers\\\".\",\"evidence\":[{\"trigger\":\"pick\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"pick\\\".\"},{\"trigger\":\"covers\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"covers\\\".\"}]}]' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-matches.json' && printf '%s\\n' '[{\"stepId\":\"lead-plan\",\"agent\":\"lead-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"implement-artifact\",\"agent\":\"impl-primary-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"review-claude\",\"agent\":\"reviewer-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"review-codex\",\"agent\":\"reviewer-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"fix-loop\",\"agent\":\"validator-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-review-claude\",\"agent\":\"reviewer-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-review-codex\",\"agent\":\"reviewer-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-signoff\",\"agent\":\"validator-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"}]' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/tool-selection.json' && printf '%s\\n' '{\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"boundary\":\"Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.\",\"loadedSkills\":[\"relay-80-100-workflow\",\"writing-agent-relay-workflows\",\"running-headless-orchestrator\",\"choosing-swarm-patterns\"],\"applicationEvidence\":[{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected relay-80-100-workflow during workflow generation. Spec text mentions \\\"must\\\". Spec text mentions \\\"validate\\\". Spec text mentions \\\"before\\\". Spec text mentions \\\"covers\\\". Spec text mentions \\\"going\\\". Spec text mentions \\\"code\\\". Spec text mentions \\\"feature\\\". Spec text mentions \\\"works\\\". Spec text mentions \\\"tested\\\". Spec text mentions \\\"in-memory\\\". Spec text mentions \\\"postgres\\\". Spec text mentions \\\"sandbox\\\". Spec text mentions \\\"verify\\\". Spec text mentions \\\"after\\\". Spec text mentions \\\"every\\\". Spec text mentions \\\"full\\\". Spec text mentions \\\"passing\\\". Spec text mentions \\\"tests\\\".\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded relay-80-100-workflow descriptor before template rendering.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected writing-agent-relay-workflows during workflow generation. Spec text mentions \\\"relay\\\". Spec text mentions \\\"covers\\\". Spec text mentions \\\"agent\\\". Spec text mentions \\\"definitions\\\". Spec text mentions \\\"verification\\\". Spec text mentions \\\"owner\\\". Spec text mentions \\\"channels\\\". Spec text mentions \\\"channel\\\". Spec text mentions \\\"error\\\". Spec text mentions \\\"event\\\". Spec text mentions \\\"rules\\\". Spec text mentions \\\"team\\\".\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded writing-agent-relay-workflows descriptor before template rendering.\"},{\"skillName\":\"running-headless-orchestrator\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected running-headless-orchestrator during workflow generation. Spec text mentions \\\"agent\\\". Spec text mentions \\\"team\\\". Spec text mentions \\\"covers\\\". Spec text mentions \\\"without\\\".\"},{\"skillName\":\"running-headless-orchestrator\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded running-headless-orchestrator descriptor before template rendering.\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected choosing-swarm-patterns during workflow generation. Spec text mentions \\\"pick\\\". Spec text mentions \\\"covers\\\".\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded choosing-swarm-patterns descriptor before template rendering.\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_rendering\",\"effect\":\"pattern_selection\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered the selected swarm pattern into the workflow builder so Ricky chooses the coordination shape before authoring tasks.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_rendering\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 10 workflow tasks with dedicated channel setup, explicit agents, step dependencies, review stages, and final signoff.\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_rendering\",\"effect\":\"validation_gates\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 12 deterministic gates including initial soft validation, fix-loop checks, final hard validation, git diff, and regression gates.\"}]}' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && printf '%s\\n' 'Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-runtime-boundary.txt' && : > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && printf '%s\\n' '\n# relay-80-100-workflow\nreason=Spec text mentions \"must\". Spec text mentions \"validate\". Spec text mentions \"before\". Spec text mentions \"covers\". Spec text mentions \"going\". Spec text mentions \"code\". Spec text mentions \"feature\". Spec text mentions \"works\". Spec text mentions \"tested\". Spec text mentions \"in-memory\". Spec text mentions \"postgres\". Spec text mentions \"sandbox\". Spec text mentions \"verify\". Spec text mentions \"after\". Spec text mentions \"every\". Spec text mentions \"full\". Spec text mentions \"passing\". Spec text mentions \"tests\".\n' >> '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && printf '%s\\n' '---\nname: relay-80-100-workflow\ndescription: Use when writing agent-relay workflows that must fully validate features end-to-end before merging. Covers the 80-to-100 pattern - going beyond \"code compiles\" to \"feature works, tested E2E locally.\" Includes PGlite for in-memory Postgres testing, mock sandbox patterns, test-fix-rerun loops, verify gates after every edit, and the full lifecycle from implementation through passing tests to commit.\n---\n\n### Overview\n\nMost agent workflows get features to ~80%: code written, types check, maybe a build passes. This skill covers the **80-to-100 gap** — making workflows that fully validate features end-to-end before committing. The goal: every feature merged via these workflows is **tested, verified, and known-working**, not just \"it compiles.\"\n\n### When to Use\n\n- Writing workflows where the deliverable must be **production-ready**, not just code-complete\n- Features that touch databases, APIs, or infrastructure that can be tested locally\n- Any workflow where \"it compiles\" is not sufficient proof of correctness\n- When you want confidence that the commit actually works before deploying\n\n### Core Principle: Test In The Workflow\n\n#### The key insight: **run tests as deterministic steps inside the workflow itself**. Don'\\''t just write test files — execute them, verify they pass, fix failures, and re-run. The workflow doesn'\\''t commit until tests are green.\n\n```\nimplement → write tests → run tests → fix failures → re-run → build check → regression check → commit\n```\n\n\n### The Test-Fix-Rerun Pattern\n\n#### Every testable feature in a workflow should follow this three-step pattern:\n\n```typescript\n// Step 1: Run tests (allow failure — we expect issues on first run)\n.step('\\''run-tests'\\'', {\n  type: '\\''deterministic'\\'',\n  dependsOn: ['\\''create-tests'\\''],\n  command: '\\''npx tsx --test tests/my-feature.test.ts 2>&1 | tail -60'\\'',\n  captureOutput: true,\n  failOnError: false,  // <-- Don'\\''t fail the workflow, let the agent fix it\n})\n\n// Step 2: Agent reads output, fixes issues, re-runs until green\n.step('\\''fix-tests'\\'', {\n  agent: '\\''tester'\\'',\n  dependsOn: ['\\''run-tests'\\''],\n  task: `Check the test output and fix any failures.\n\nTest output:\n{{steps.run-tests.output}}\n\nIf all tests passed, do nothing.\nIf there are failures:\n1. Read the failing test file and source files\n2. Fix the issues (could be in test or source)\n3. Re-run: npx tsx --test tests/my-feature.test.ts\n4. Keep fixing until ALL tests pass.`,\n  verification: { type: '\\''exit_code'\\'' },\n})\n\n// Step 3: Deterministic final run — this one MUST pass\n.step('\\''run-tests-final'\\'', {\n  type: '\\''deterministic'\\'',\n  dependsOn: ['\\''fix-tests'\\''],\n  command: '\\''npx tsx --test tests/my-feature.test.ts 2>&1'\\'',\n  captureOutput: true,\n  failOnError: true,  // <-- Hard fail if tests still broken\n})\n```\n\n\n### PGlite: In-Memory Postgres for Database Testing\n\n#### Setup\n\n```typescript\n.step('\\''install-pglite'\\'', {\n  type: '\\''deterministic'\\'',\n  command: '\\''npm install --save-dev @electric-sql/pglite 2>&1 | tail -5'\\'',\n  captureOutput: true,\n})\n```\n\n#### Test Helper Pattern\n\n```typescript\n// tests/helpers/pglite-db.ts\nimport { PGlite } from '\\''@electric-sql/pglite'\\'';\nimport { drizzle } from '\\''drizzle-orm/pglite'\\'';\nimport * as schema from '\\''../../packages/web/lib/db/schema.js'\\'';\n\n// Raw DDL matching your Drizzle schema — PGlite doesn'\\''t run Drizzle migrations\nconst MY_TABLE_DDL = `\nCREATE TABLE IF NOT EXISTS my_table (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  name TEXT NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n`;\n\nexport async function createTestDb() {\n  const pg = new PGlite();\n  await pg.exec(MY_TABLE_DDL);\n  const db = drizzle(pg, { schema });\n  return { db, pg, schema, cleanup: () => pg.close() };\n}\n```\n\n#### Test Structure\n\n```typescript\n// tests/my-feature.test.ts\nimport { describe, it } from '\\''node:test'\\'';\nimport assert from '\\''node:assert/strict'\\'';\nimport { randomUUID } from '\\''node:crypto'\\'';\nimport { createTestDb } from '\\''./helpers/pglite-db.js'\\'';\n\ndescribe('\\''my feature'\\'', () => {\n  it('\\''does the thing correctly'\\'', async () => {\n    const { db, schema, cleanup } = await createTestDb();\n    try {\n      // Arrange\n      const testId = randomUUID();\n      // Act — use your module against the real (in-memory) Postgres\n      // Assert\n      assert.equal(result.name, '\\''expected'\\'');\n    } finally {\n      await cleanup();\n    }\n  });\n});\n```\n\n\n### Verify Gates After Every Edit\n\n#### Never trust that an agent edited a file correctly. Add a deterministic verify gate after every agent edit step:\n\n```typescript\n// Agent edits a file\n.step('\\''edit-schema'\\'', {\n  agent: '\\''impl'\\'',\n  dependsOn: ['\\''read-schema'\\''],\n  task: `Edit packages/web/lib/db/schema.ts...`,\n  verification: { type: '\\''exit_code'\\'' },\n})\n\n// Deterministic verification — did the edit actually land?\n.step('\\''verify-schema'\\'', {\n  type: '\\''deterministic'\\'',\n  dependsOn: ['\\''edit-schema'\\''],\n  command: `if git diff --quiet packages/web/lib/db/schema.ts; then echo \"NOT MODIFIED\"; exit 1; fi\ngrep \"my_new_table\" packages/web/lib/db/schema.ts >/dev/null && echo \"OK\" || (echo \"MISSING\"; exit 1)`,\n  failOnError: true,\n  captureOutput: true,\n})\n```\n\n\n### Mock Sandbox Pattern\n\n#### When testing code that interacts with Daytona sandboxes, use inline mock objects matching the existing test conventions:\n\n```typescript\nconst daytona = {\n  create: async () => ({\n    id: '\\''sandbox-id'\\'',\n    process: {\n      executeCommand: async (cmd, cwd, env) => ({\n        result: '\\''output'\\'',\n        exitCode: 0,\n      }),\n    },\n    fs: {\n      uploadFile: async () => undefined,\n    },\n    getUserHomeDir: async () => '\\''/home/daytona'\\'',\n  }),\n  remove: async () => undefined,\n};\n```\n\n\n### Regression Testing\n\n#### After your new tests pass, always run the **existing test suite** to catch regressions:\n\n```typescript\n.step('\\''run-existing-tests'\\'', {\n  type: '\\''deterministic'\\'',\n  dependsOn: ['\\''fix-build'\\''],\n  command: '\\''npm run orchestrator:test 2>&1 | tail -40'\\'',\n  captureOutput: true,\n  failOnError: false,\n})\n\n.step('\\''fix-regressions'\\'', {\n  agent: '\\''impl'\\'',\n  dependsOn: ['\\''run-existing-tests'\\''],\n  task: `Check the full test suite for regressions caused by our changes.\n\nTest output:\n{{steps.run-existing-tests.output}}\n\nIf all tests passed, do nothing.\nIf EXISTING tests broke, read the failing test, find what we broke, fix it.\nMost likely cause: constructor signatures changed, new required fields added\nwithout defaults, or import paths shifted.\n\nRun: npm run orchestrator:test\nFix until all tests pass.`,\n  verification: { type: '\\''exit_code'\\'' },\n})\n```\n\n\n### Full Workflow Template\n\n#### Here'\\''s the complete pattern for a feature that touches the database:\n\n```typescript\nimport { workflow } from '\\''@agent-relay/sdk/workflows'\\'';\n\nconst result = await workflow('\\''my-feature'\\'')\n  .description('\\''Add feature X with full E2E validation'\\'')\n  .pattern('\\''dag'\\'')\n  .channel('\\''wf-my-feature'\\'')\n  .maxConcurrency(3)\n  .timeout(3_600_000)\n\n  .agent('\\''impl'\\'', { cli: '\\''claude'\\'', preset: '\\''worker'\\'', retries: 2 })\n  .agent('\\''tester'\\'', { cli: '\\''claude'\\'', preset: '\\''worker'\\'', retries: 2 })\n\n  // ── Phase 1: Read ────────────────────────────────────────────────\n  .step('\\''read-target'\\'', {\n    type: '\\''deterministic'\\'',\n    command: '\\''cat path/to/file.ts'\\'',\n    captureOutput: true,\n  })\n\n  // ── Phase 2: Implement ───────────────────────────────────────────\n  .step('\\''edit-target'\\'', {\n    agent: '\\''impl'\\'',\n    dependsOn: ['\\''read-target'\\''],\n    task: `Edit path/to/file.ts. Current contents:\n{{steps.lead-plan.output}}\n<specific instructions>\nOnly edit this one file.`,\n    verification: { type: '\\''exit_code'\\'' },\n  })\n  .step('\\''verify-target'\\'', {\n    type: '\\''deterministic'\\'',\n    dependsOn: ['\\''edit-target'\\''],\n    command: '\\''git diff --quiet path/to/file.ts && (echo \"NOT MODIFIED\"; exit 1) || echo \"OK\"'\\'',\n    failOnError: true,\n    captureOutput: true,\n  })\n\n  // ── Phase 3: Test infrastructure ─────────────────────────────────\n  .step('\\''install-pglite'\\'', {\n    type: '\\''deterministic'\\'',\n    command: '\\''npm install --save-dev @electric-sql/pglite 2>&1 | tail -5'\\'',\n    captureOutput: true,\n  })\n  .step('\\''create-test-helpers'\\'', {\n    agent: '\\''tester'\\'',\n    dependsOn: ['\\''install-pglite'\\''],\n    task: '\\''Create tests/helpers/pglite-db.ts with <DDL for your tables>...'\\'',\n    verification: { type: '\\''file_exists'\\'', value: '\\''tests/helpers/pglite-db.ts'\\'' },\n  })\n  .step('\\''create-tests'\\'', {\n    agent: '\\''tester'\\'',\n    dependsOn: ['\\''create-test-helpers'\\'', '\\''verify-target'\\''],\n    task: '\\''Create tests/my-feature.test.ts with <test descriptions>...'\\'',\n    verification: { type: '\\''file_exists'\\'', value: '\\''tests/my-feature.test.ts'\\'' },\n  })\n\n  // ── Phase 4: Test-fix-rerun loop ─────────────────────────────────\n  .step('\\''run-tests'\\'', {\n    type: '\\''deterministic'\\'',\n    dependsOn: ['\\''create-tests'\\''],\n    command: '\\''npx tsx --test tests/my-feature.test.ts 2>&1 | tail -60'\\'',\n    captureOutput: true,\n    failOnError: false,\n  })\n  .step('\\''fix-tests'\\'', {\n    agent: '\\''tester'\\'',\n    dependsOn: ['\\''run-tests'\\''],\n    task: `Fix any test failures. Output:\\n{{steps.run-tests.output}}`,\n    verification: { type: '\\''exit_code'\\'' },\n  })\n  .step('\\''run-tests-final'\\'', {\n    type: '\\''deterministic'\\'',\n    dependsOn: ['\\''fix-tests'\\''],\n    command: '\\''npx tsx --test tests/my-feature.test.ts 2>&1'\\'',\n    captureOutput: true,\n    failOnError: true,\n  })\n\n  // ── Phase 5: Build + regression ──────────────────────────────────\n  .step('\\''build-check'\\'', {\n    type: '\\''deterministic'\\'',\n    dependsOn: ['\\''run-tests-final'\\''],\n    command: '\\''npx tsc --noEmit 2>&1 | tail -20; echo \"EXIT: $?\"'\\'',\n    captureOutput: true,\n    failOnError: false,\n  })\n  .step('\\''fix-build'\\'', {\n    agent: '\\''impl'\\'',\n    dependsOn: ['\\''build-check'\\''],\n    task: `Fix type errors if any. Output:\\n{{steps.build-check.output}}`,\n    verification: { type: '\\''exit_code'\\'' },\n  })\n  .step('\\''run-existing-tests'\\'', {\n    type: '\\''deterministic'\\'',\n    dependsOn: ['\\''fix-build'\\''],\n    command: '\\''npm test 2>&1 | tail -40'\\'',\n    captureOutput: true,\n    failOnError: false,\n  })\n  .step('\\''fix-regressions'\\'', {\n    agent: '\\''impl'\\'',\n    dependsOn: ['\\''run-existing-tests'\\''],\n    task: `Fix regressions if any. Output:\\n{{steps.run-existing-tests.output}}`,\n    verification: { type: '\\''exit_code'\\'' },\n  })\n\n  // ── Phase 6: Commit ──────────────────────────────────────────────\n  .step('\\''commit'\\'', {\n    type: '\\''deterministic'\\'',\n    dependsOn: ['\\''fix-regressions'\\''],\n    command: '\\''git add <files> && git commit -m \"feat: ...\"'\\'',\n    captureOutput: true,\n    failOnError: true,\n  })\n\n  .onError('\\''retry'\\'', { maxRetries: 2, retryDelayMs: 10_000 })\n  .run({ cwd: process.cwd() });\n```\n\n\n### Checklist: Is Your Workflow 80-to-100?\n\n| Check | How |\n|-------|-----|\n| Tests exist | `file_exists` verification on test file |\n| Tests actually run | Deterministic step executes them |\n| Test failures get fixed | Agent step reads output, fixes, re-runs |\n| Final test run is hard-gated | `failOnError: true` on last test step |\n| Build passes | `npx tsc --noEmit` deterministic step |\n| No regressions | Existing test suite runs after changes |\n| Every edit is verified | `git diff --quiet` + grep after each agent edit |\n| Commit only happens after all gates | `dependsOn` chains to final verification |\n\n### Common Anti-Patterns\n\n| Anti-pattern | Why it fails | Fix |\n|-------------|-------------|-----|\n| Tests written but never executed | Agent claims they pass, they don'\\''t | Add deterministic `run-tests` step |\n| Single `failOnError: true` test run | First failure kills workflow, no chance to fix | Use the three-step test-fix-rerun pattern |\n| No regression test | New feature works, old features break | Run `npm test` after build check |\n| Agent asked to \"write and run tests\" in one step | Agent writes tests, runs them, they fail, it edits, output is garbled | Separate write/run/fix into distinct steps |\n| PGlite DDL doesn'\\''t match Drizzle schema | Tests pass on wrong schema | Derive DDL from schema.ts or test with real migration |\n| `failOnError: false` on final test run | Broken tests get committed | Always `failOnError: true` on the gate step |\n| Testing only happy path | Edge cases break in prod | Specify edge case tests in the task prompt |\n| No verify gate after agent edits | Agent exits 0 without writing anything | Add `git diff --quiet` check after every edit |\n' >> '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && printf '%s\\n' '\n# writing-agent-relay-workflows\nreason=Spec text mentions \"relay\". Spec text mentions \"covers\". Spec text mentions \"agent\". Spec text mentions \"definitions\". Spec text mentions \"verification\". Spec text mentions \"owner\". Spec text mentions \"channels\". Spec text mentions \"channel\". Spec text mentions \"error\". Spec text mentions \"event\". Spec text mentions \"rules\". Spec text mentions \"team\".\n' >> '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && printf '%s\\n' '---\nname: writing-agent-relay-workflows\ndescription: Use when building multi-agent workflows with the relay broker-sdk - covers the WorkflowBuilder API, DAG step dependencies, agent definitions, step output chaining via {{steps.\\.output}}, verification gates, evidence-based completion, owner decisions, dedicated channels, dynamic channel management (subscribe/unsubscribe/mute/unmute), swarm patterns, error handling, event listeners, step sizing rules, authoring best practices, and the lead+workers team pattern for complex steps\n---\n\n### Overview\n\nThe relay broker-sdk workflow system orchestrates multiple AI agents (Claude, Codex, Gemini, Aider, Goose) through typed DAG-based workflows. Workflows can be written in **TypeScript** (preferred), **Python**, or **YAML**.\n\n**Language preference:** TypeScript > Python > YAML. Use TypeScript unless the project is Python-only or a simple config-driven workflow suits YAML.\n\n**Pattern selection:** Do not default to `dag` blindly. If the job needs a different swarm/workflow type, consult the `choosing-swarm-patterns` skill when available and select the pattern that best matches the coordination problem.\n\n### When to Use\n\n- Building multi-agent workflows with step dependencies\n- Orchestrating different AI CLIs (claude, codex, gemini, aider, goose)\n- Creating DAG, pipeline, fan-out, or other swarm patterns\n- Needing verification gates, retries, or step output chaining\n- Dynamic channel management: agents joining/leaving/muting channels mid-workflow\n\n### Quick Reference\n\n#### ```typescript\n\n```typescript\nimport { workflow } from '\\''@agent-relay/sdk/workflows'\\'';\n\nconst result = await workflow('\\''my-workflow'\\'')\n  .description('\\''What this workflow does'\\'')\n  .pattern('\\''dag'\\'') // or '\\''pipeline'\\'', '\\''fan-out'\\'', etc.\n  .channel('\\''wf-my-workflow'\\'') // dedicated channel (auto-generated if omitted)\n  .maxConcurrency(3)\n  .timeout(3_600_000) // global timeout (ms)\n\n  .agent('\\''lead'\\'', { cli: '\\''claude'\\'', role: '\\''Architect'\\'', retries: 2 })\n  .agent('\\''worker'\\'', { cli: '\\''codex'\\'', role: '\\''Implementer'\\'', retries: 2 })\n\n  .step('\\''plan'\\'', {\n    agent: '\\''lead'\\'',\n    task: `Analyze the codebase and produce a plan.`,\n    retries: 2,\n    verification: { type: '\\''output_contains'\\'', value: '\\''PLAN_COMPLETE'\\'' },\n  })\n  .step('\\''implement'\\'', {\n    agent: '\\''worker'\\'',\n    task: `Implement based on this plan:\\n{{steps.\\.output}}`,\n    dependsOn: ['\\''plan'\\''],\n    verification: { type: '\\''exit_code'\\'' },\n  })\n\n  .onError('\\''retry'\\'', { maxRetries: 2, retryDelayMs: 10_000 })\n  .run({ cwd: process.cwd() });\n\n  console.log('\\''Result:'\\'', result.status);\n```\n\n\n### ⚡ Parallelism — Design for Speed\n\n#### Cross-Workflow Parallelism: Wave Planning\n\n```bash\n# BAD — sequential (14 hours for 27 workflows at ~30 min each)\nagent-relay run workflows/34-sst-wiring.ts\nagent-relay run workflows/35-env-config.ts\nagent-relay run workflows/36-loading-states.ts\n# ... one at a time\n\n# GOOD — parallel waves (3-4 hours for 27 workflows)\n# Wave 1: independent infra (parallel)\nagent-relay run workflows/34-sst-wiring.ts &\nagent-relay run workflows/35-env-config.ts &\nagent-relay run workflows/36-loading-states.ts &\nagent-relay run workflows/37-responsive.ts &\nwait\ngit add -A && git commit -m \"Wave 1\"\n\n# Wave 2: testing (parallel — independent test suites)\nagent-relay run workflows/40-unit-tests.ts &\nagent-relay run workflows/41-integration-tests.ts &\nagent-relay run workflows/42-e2e-tests.ts &\nwait\ngit add -A && git commit -m \"Wave 2\"\n```\n\n#### Declare File Scope for Planning\n\n```typescript\nworkflow('\\''48-comparison-mode'\\'')\n  .packages(['\\''web'\\'', '\\''core'\\''])                // monorepo packages touched\n  .isolatedFrom(['\\''49-feedback-system'\\''])      // explicitly safe to parallelize\n  .requiresBefore(['\\''46-admin-dashboard'\\''])    // explicit ordering constraint\n```\n\n#### Within-Workflow Parallelism\n\n```typescript\n// BAD — unnecessary sequential chain\n.step('\\''fix-component-a'\\'', { agent: '\\''worker'\\'', dependsOn: ['\\''review'\\''] })\n.step('\\''fix-component-b'\\'', { agent: '\\''worker'\\'', dependsOn: ['\\''fix-component-a'\\''] })  // why wait?\n\n// GOOD — parallel fan-out, merge at the end\n.step('\\''fix-component-a'\\'', { agent: '\\''impl-1'\\'', dependsOn: ['\\''review'\\''] })\n.step('\\''fix-component-b'\\'', { agent: '\\''impl-2'\\'', dependsOn: ['\\''review'\\''] })  // same dep = parallel\n.step('\\''verify-all'\\'', { agent: '\\''reviewer'\\'', dependsOn: ['\\''fix-component-a'\\'', '\\''fix-component-b'\\''] })\n```\n\n\n### Failure Prevention\n\n#### 1. Do not use raw top-level `await`\n\n```ts\nasync function runWorkflow() {\n  const result = await workflow('\\''my-workflow'\\'')\n    // ...\n    .run({ cwd: process.cwd() });\n\n  console.log('\\''Workflow status:'\\'', result.status);\n}\n\nrunWorkflow().catch((error) => {\n  console.error(error);\n  process.exit(1);\n});\n```\n\n#### 3. Keep final verification boring and deterministic\n\n```bash\ngrep -Eq \"foo|bar|baz\" file.ts\n```\n\n#### 6. Be explicit about shell requirements\n\n```bash\n/opt/homebrew/bin/bash workflows/your-workflow/execute.sh --wave 2\n```\n\n\n### End-to-End Bug Fix Workflows\n\n- **Capture the original failure**\n- Reproduce the bug first in a deterministic or evidence-capturing step\n- Save exact commands, logs, status codes, or screenshots/artifacts\n- **State the acceptance contract**\n- Define the exact end-to-end success criteria before implementation\n- Include the real entrypoint a user would run\n- **Implement the fix**\n- **Rebuild / reinstall from scratch**\n- Do not trust dirty local state\n- Prefer a clean environment when install/bootstrap behavior is involved\n- **Run targeted regression checks**\n- Unit/integration tests are helpful but not sufficient by themselves\n- **Run a full end-to-end validation**\n- Use the real CLI / API / install path\n- Prefer a clean environment (Docker, sandbox, cloud workspace, Daytona, etc.) for install/runtime issues\n- **Compare before vs after evidence**\n- Show that the original failure no longer occurs\n- **Record residual risks**\n- Call out what was not covered\n- disposable sandbox / cloud workspace\n- Docker / containerized environment\n- fresh local shell with isolated paths\n- compares candidate validation environments\n- defines the acceptance contract\n- chooses the best swarm pattern\n- then authors the final fix/validation workflow\n\n### Key Concepts\n\n#### Verification Gates\n\n```typescript\nverification: { type: '\\''exit_code'\\'' }                        // preferred for code-editing steps\nverification: { type: '\\''output_contains'\\'', value: '\\''DONE'\\'' }   // optional accelerator\nverification: { type: '\\''file_exists'\\'', value: '\\''src/out.ts'\\'' } // deterministic file check\n```\n\n#### DAG Dependencies\n\n```typescript\n.step('\\''fix-types'\\'',  { agent: '\\''worker'\\'', dependsOn: ['\\''review'\\''], ... })\n.step('\\''fix-tests'\\'',  { agent: '\\''worker'\\'', dependsOn: ['\\''review'\\''], ... })\n.step('\\''final'\\'',      { agent: '\\''lead'\\'',   dependsOn: ['\\''fix-types'\\'', '\\''fix-tests'\\''], ... })\n```\n\n#### SDK API\n\n```typescript\n// Subscribe an agent to additional channels post-spawn\nrelay.subscribe({ agent: '\\''security-auditor'\\'', channels: ['\\''review-pr-456'\\''] });\n\n// Unsubscribe — agent leaves the channel entirely\nrelay.unsubscribe({ agent: '\\''security-auditor'\\'', channels: ['\\''general'\\''] });\n\n// Mute — agent stays subscribed (history access) but messages are NOT injected into PTY\nrelay.mute({ agent: '\\''security-auditor'\\'', channel: '\\''review-pr-123'\\'' });\n\n// Unmute — resume PTY injection\nrelay.unmute({ agent: '\\''security-auditor'\\'', channel: '\\''review-pr-123'\\'' });\n```\n\n#### Events\n\n```typescript\nrelay.onChannelSubscribed = (agent, channels) => { /* ... */ };\nrelay.onChannelUnsubscribed = (agent, channels) => { /* ... */ };\nrelay.onChannelMuted = (agent, channel) => { /* ... */ };\nrelay.onChannelUnmuted = (agent, channel) => { /* ... */ };\n```\n\n\n### Agent Definition\n\n#### ```typescript\n\n```typescript\n.agent('\\''name'\\'', {\n  cli: '\\''claude'\\'' | '\\''codex'\\'' | '\\''gemini'\\'' | '\\''aider'\\'' | '\\''goose'\\'' | '\\''opencode'\\'' | '\\''droid'\\'',\n  role?: string,\n  preset?: '\\''lead'\\'' | '\\''worker'\\'' | '\\''reviewer'\\'' | '\\''analyst'\\'',\n  retries?: number,\n  model?: string,\n  interactive?: boolean, // default: true\n})\n```\n\n#### Model Constants\n\n```typescript\nimport { ClaudeModels, CodexModels, GeminiModels } from '\\''@agent-relay/config'\\'';\n\n.agent('\\''planner'\\'', { cli: '\\''claude'\\'', model: ClaudeModels.OPUS })    // not '\\''opus'\\''\n.agent('\\''worker'\\'',  { cli: '\\''claude'\\'', model: ClaudeModels.SONNET })  // not '\\''sonnet'\\''\n.agent('\\''coder'\\'',   { cli: '\\''codex'\\'',  model: CodexModels.GPT_5_4 })  // not '\\''gpt-5.4'\\''\n```\n\n\n### Step Definition\n\n#### Agent Steps\n\n```typescript\n.step('\\''name'\\'', {\n  agent: string,\n  task: string,                   // supports {{var}} and {{steps.\\.output}}\n  dependsOn?: string[],\n  verification?: VerificationCheck,\n  retries?: number,\n})\n```\n\n#### Deterministic Steps (Shell Commands)\n\n```typescript\n.step('\\''verify-files'\\'', {\n  type: '\\''deterministic'\\'',\n  command: '\\''test -f src/auth.ts && echo \"FILE_EXISTS\"'\\'',\n  dependsOn: ['\\''implement'\\''],\n  captureOutput: true,\n  failOnError: true,\n})\n```\n\n\n### Common Patterns\n\n#### Interactive Team (lead + workers on shared channel)\n\n```typescript\n.agent('\\''lead'\\'', {\n  cli: '\\''claude'\\'',\n  model: ClaudeModels.OPUS,\n  role: '\\''Architect and reviewer — assigns work, reviews, posts feedback'\\'',\n  retries: 1,\n  // No preset — interactive by default\n})\n\n.agent('\\''impl-new'\\'', {\n  cli: '\\''codex'\\'',\n  model: CodexModels.O3,\n  role: '\\''Creates new files. Listens on channel for assignments and feedback.'\\'',\n  retries: 2,\n  // No preset — interactive, receives channel messages\n})\n\n.agent('\\''impl-modify'\\'', {\n  cli: '\\''codex'\\'',\n  model: CodexModels.O3,\n  role: '\\''Edits existing files. Listens on channel for assignments and feedback.'\\'',\n  retries: 2,\n})\n\n// All three share the same dependsOn — they start concurrently (no deadlock)\n.step('\\''lead-coordinate'\\'', {\n  agent: '\\''lead'\\'',\n  dependsOn: ['\\''context'\\''],\n  task: `You are the lead on #channel. Workers: impl-new, impl-modify.\nPost the plan. Assign files. Review their work. Post feedback if needed.\nWorkers iterate based on your feedback. Exit when all files are correct.`,\n})\n.step('\\''impl-new-work'\\'', {\n  agent: '\\''impl-new'\\'',\n  dependsOn: ['\\''context'\\''],   // same dep as lead = parallel start\n  task: `You are impl-new on #channel. Wait for the lead'\\''s plan.\nCreate files as assigned. Report completion. Fix issues from feedback.`,\n})\n.step('\\''impl-modify-work'\\'', {\n  agent: '\\''impl-modify'\\'',\n  dependsOn: ['\\''context'\\''],   // same dep as lead = parallel start\n  task: `You are impl-modify on #channel. Wait for the lead'\\''s plan.\nEdit files as assigned. Report completion. Fix issues from feedback.`,\n})\n// Downstream gates on lead (lead exits when satisfied)\n.step('\\''verify'\\'', { type: '\\''deterministic'\\'', dependsOn: ['\\''lead-coordinate'\\''], ... })\n```\n\n#### Pipeline (sequential handoff)\n\n```typescript\n.pattern('\\''pipeline'\\'')\n.step('\\''analyze'\\'', { agent: '\\''analyst'\\'', task: '\\''...'\\'' })\n.step('\\''implement'\\'', { agent: '\\''dev'\\'', task: '\\''{{steps.analyze.output}}'\\'', dependsOn: ['\\''analyze'\\''] })\n.step('\\''test'\\'', { agent: '\\''tester'\\'', task: '\\''{{steps.implement.output}}'\\'', dependsOn: ['\\''implement'\\''] })\n```\n\n#### Error Handling\n\n```typescript\n.onError('\\''fail-fast'\\'')   // stop on first failure (default)\n.onError('\\''continue'\\'')    // skip failed branches, continue others\n.onError('\\''retry'\\'', { maxRetries: 3, retryDelayMs: 5000 })\n```\n\n\n### Multi-File Edit Pattern\n\n#### When a workflow needs to modify multiple existing files, **use one agent step per file** with a deterministic verify gate after each. Agents reliably edit 1-2 files per step but fail on 4+.\n\n```yaml\nsteps:\n  - name: read-types\n    type: deterministic\n    command: cat src/types.ts\n    captureOutput: true\n\n  - name: edit-types\n    agent: dev\n    dependsOn: [read-types]\n    task: |\n      Edit src/types.ts. Current contents:\n      {{steps.lead-plan.output}}\n      Add '\\''pending'\\'' to the Status union type.\n      Only edit this one file.\n    verification:\n      type: exit_code\n\n  - name: verify-types\n    type: deterministic\n    dependsOn: [edit-types]\n    command: '\\''if git diff --quiet src/types.ts; then echo \"NOT MODIFIED\"; exit 1; fi; echo \"OK\"'\\''\n    failOnError: true\n\n  - name: read-service\n    type: deterministic\n    dependsOn: [verify-types]\n    command: cat src/service.ts\n    captureOutput: true\n\n  - name: edit-service\n    agent: dev\n    dependsOn: [read-service]\n    task: |\n      Edit src/service.ts. Current contents:\n      {{steps.lead-plan.output}}\n      Add a handlePending() method.\n      Only edit this one file.\n    verification:\n      type: exit_code\n\n  - name: verify-service\n    type: deterministic\n    dependsOn: [edit-service]\n    command: '\\''if git diff --quiet src/service.ts; then echo \"NOT MODIFIED\"; exit 1; fi; echo \"OK\"'\\''\n    failOnError: true\n\n  # Deterministic commit — never rely on agents to commit\n  - name: commit\n    type: deterministic\n    dependsOn: [verify-service]\n    command: git add src/types.ts src/service.ts && git commit -m \"feat: add pending status\"\n    failOnError: true\n```\n\n\n### File Materialization: Verify Before Proceeding\n\n#### After any step that creates files, add a deterministic `file_exists` check before proceeding. Non-interactive agents may exit 0 without writing anything (wrong cwd, stdout instead of disk).\n\n```yaml\n- name: verify-files\n  type: deterministic\n  dependsOn: [impl-auth, impl-storage]\n  command: |\n    missing=0\n    for f in src/auth/credentials.ts src/storage/client.ts; do\n      if [ ! -f \"$f\" ]; then echo \"MISSING: $f\"; missing=$((missing+1)); fi\n    done\n    if [ $missing -gt 0 ]; then echo \"$missing files missing\"; exit 1; fi\n    echo \"All files present\"\n  failOnError: true\n```\n\n\n### DAG Deadlock Anti-Pattern\n\n#### ```yaml\n\n```yaml\n# WRONG — deadlock: coordinate depends on context, work-a depends on coordinate\nsteps:\n  - name: coordinate\n    dependsOn: [context]    # lead waits for WORKER_DONE...\n  - name: work-a\n    dependsOn: [coordinate] # ...but work-a can'\\''t start until coordinate finishes\n\n# RIGHT — workers and lead start in parallel\nsteps:\n  - name: context\n    type: deterministic\n  - name: work-a\n    dependsOn: [context]    # starts with lead\n  - name: coordinate\n    dependsOn: [context]    # starts with workers\n  - name: merge\n    dependsOn: [work-a, coordinate]\n```\n\n\n### Step Sizing\n\n#### **One agent, one deliverable.** A step'\\''s task prompt should be 10-20 lines max.\n\n```yaml\n# Team pattern: lead + workers on a shared channel\nsteps:\n  - name: track-lead-coord\n    agent: track-lead\n    dependsOn: [prior-step]\n    task: |\n      Lead the track on #my-track. Workers: track-worker-1, track-worker-2.\n      Post assignments to the channel. Review worker output.\n\n  - name: track-worker-1-impl\n    agent: track-worker-1\n    dependsOn: [prior-step]  # same dep as lead — starts concurrently\n    task: |\n      Join #my-track. track-lead will post your assignment.\n      Implement the file as directed.\n    verification:\n      type: exit_code\n\n  - name: next-step\n    dependsOn: [track-lead-coord]  # downstream depends on lead, not workers\n```\n\n\n### Supervisor Pattern\n\nWhen you set `.pattern('\\''supervisor'\\'')` (or `hub-spoke`, `fan-out`), the runner auto-assigns a supervisor agent as owner for worker steps. The supervisor monitors progress, nudges idle workers, and issues `OWNER_DECISION`.\n\n**Auto-hardening only activates for hub patterns** — not `pipeline` or `dag`.\n\n| Use case | Pattern | Why |\n|----------|---------|-----|\n| Sequential, no monitoring | `pipeline` | Simple, no overhead |\n| Workers need oversight | `supervisor` | Auto-owner monitors |\n| Local/small models | `supervisor` | Supervisor catches stuck workers |\n| All non-interactive | `pipeline` or `dag` | No PTY = no supervision needed |\n\n### Concurrency\n\n**Cap `maxConcurrency` at 4-6.** Spawning 10+ agents simultaneously causes broker timeouts.\n\n| Parallel agents | `maxConcurrency` |\n|-----------------|-------------------|\n| 2-4             | 4 (default safe)  |\n| 5-10            | 5                 |\n| 10+             | 6-8 max           |\n\n### Common Mistakes\n\n| Mistake | Fix |\n|---------|-----|\n| All workflows run sequentially | Group independent workflows into parallel waves (4-7x speedup) |\n| Every step depends on the previous one | Only add `dependsOn` when there'\\''s a real data dependency |\n| Self-review step with no timeout | Set `timeout: 300_000` (5 min) — Codex hangs in non-interactive review |\n| One giant workflow per feature | Split into smaller workflows that can run in parallel waves |\n| Adding exit instructions to tasks | Runner handles self-termination automatically |\n| Setting `timeoutMs` on agents/steps | Use global `.timeout()` only |\n| Using `general` channel | Set `.channel('\\''wf-name'\\'')` for isolation |\n| `{{steps.\\.output}}` without `dependsOn: ['\\''X'\\'']` | Output won'\\''t be available yet |\n| Requiring exact sentinel as only completion gate | Use `exit_code` or `file_exists` verification |\n| Writing 100-line task prompts | Split into lead + workers on a channel |\n| `maxConcurrency: 16` with many parallel steps | Cap at 5-6 |\n| Non-interactive agent reading large files via tools | Pre-read in deterministic step, inject via `{{steps.\\.output}}` |\n| Workers depending on lead step (deadlock) | Both depend on shared context step |\n| `fan-out`/`hub-spoke` for simple parallel workers | Use `dag` instead |\n| `pipeline` but expecting auto-supervisor | Only hub patterns auto-harden. Use `.pattern('\\''supervisor'\\'')` |\n| Workers without `preset: '\\''worker'\\''` in one-shot DAG lead+worker flows | Add preset for clean stdout when chaining `{{steps.\\.output}}` (not needed for interactive team patterns) |\n| Using `_` in YAML numbers (`timeoutMs: 1_200_000`) | YAML doesn'\\''t support `_` separators |\n| Workflow timeout under 30 min for complex workflows | Use `3600000` (1 hour) as default |\n| Using `require()` in ESM projects | Check `package.json` for `\"type\": \"module\"` — use `import` if ESM |\n| Wrapping in `async function main()` in ESM | ESM supports top-level `await` — no wrapper needed |\n| Using `createWorkflowRenderer` | Does not exist. Use `.run({ cwd: process.cwd() })` |\n| `export default workflow(...)...build()` | No `.build()`. Chain ends with `.run()` — the file must call `.run()`, not just export config |\n| Relative import `'\\''../workflows/builder.js'\\''` | Use `import { workflow } from '\\''@agent-relay/sdk/workflows'\\''` |\n| Hardcoded model strings (`model: '\\''opus'\\''`) | Use constants: `import { ClaudeModels } from '\\''@agent-relay/config'\\''` → `model: ClaudeModels.OPUS` |\n| Thinking `agent-relay run` inspects exports | It executes the file as a subprocess. Only `.run()` invocations trigger steps |\n| `pattern('\\''single'\\'')` on cloud runner | Not supported — use `dag` |\n| `pattern('\\''supervisor'\\'')` with one agent | Same agent is owner + specialist. Use `dag` |\n| Invalid verification type (`type: '\\''deterministic'\\''`) | Only `exit_code`, `output_contains`, `file_exists`, `custom` are valid |\n| Chaining `{{steps.\\.output}}` from interactive agents | PTY output is garbled. Use deterministic steps or `preset: '\\''worker'\\''` |\n| Single step editing 4+ files | Agents modify 1-2 then exit. Split to one file per step with verify gates |\n| Relying on agents to `git commit` | Agents emit markers without running git. Use deterministic commit step |\n| File-writing steps without `file_exists` verification | `exit_code` auto-passes even if no file written |\n| Manual peer fanout in `handleChannelMessage()` | Use broker-managed channel subscriptions — broker fans out to all subscribers automatically |\n| Client-side `personaNames.has(from)` filtering | Use `relay.subscribe()`/`relay.unsubscribe()` — only subscribed agents receive messages |\n| Agents receiving noisy cross-channel messages during focused work | Use `relay.mute({ agent, channel })` to silence non-primary channels without leaving them |\n| Hardcoding all channels at spawn time | Use `agent.subscribe()` / `agent.unsubscribe()` for dynamic channel membership post-spawn |\n| Using `preset: '\\''worker'\\''` for Codex in *interactive team* patterns when coordination is needed | Codex interactive mode works fine with PTY channel injection. Drop the preset for interactive team patterns (keep it for one-shot DAG workers where clean stdout matters) |\n| Separate reviewer agent from lead in interactive team | Merge lead + reviewer into one interactive Claude agent — reviews between rounds, fewer agents |\n| Not printing PR URL after `gh pr create` | Add a final deterministic step: `echo \"PR: $(cat pr-url.txt)\"` or capture in the `gh pr create` command |\n| Workflow ending without worktree + PR for cross-repo changes | Add `setup-worktree` at start and `push-and-pr` + `cleanup-worktree` at end |\n\n### YAML Alternative\n\n#### ```yaml\n\n```yaml\nversion: '\\''1.0'\\''\nname: my-workflow\nswarm:\n  pattern: dag\n  channel: wf-my-workflow\nagents:\n  - name: lead\n    cli: claude\n    role: Architect\n  - name: worker\n    cli: codex\n    role: Implementer\nworkflows:\n  - name: default\n    steps:\n      - name: plan\n        agent: lead\n        task: '\\''Produce a detailed implementation plan.'\\''\n      - name: implement\n        agent: worker\n        task: '\\''Implement: {{steps.\\.output}}'\\''\n        dependsOn: [plan]\n        verification:\n          type: exit_code\n```\n\n\n### Available Swarm Patterns\n\n`dag` (default), `fan-out`, `pipeline`, `hub-spoke`, `consensus`, `mesh`, `handoff`, `cascade`, `debate`, `hierarchical`, `map-reduce`, `scatter-gather`, `supervisor`, `reflection`, `red-team`, `verifier`, `auction`, `escalation`, `saga`, `circuit-breaker`, `blackboard`, `swarm`\n\nSee skill `choosing-swarm-patterns` for pattern selection guidance.\n' >> '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && printf '%s\\n' '\n# running-headless-orchestrator\nreason=Spec text mentions \"agent\". Spec text mentions \"team\". Spec text mentions \"covers\". Spec text mentions \"without\".\n' >> '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && printf '%s\\n' '---\nname: running-headless-orchestrator\ndescription: Use when an agent needs to self-bootstrap agent-relay and autonomously manage a team of workers - covers infrastructure startup, agent spawning, lifecycle monitoring, and team coordination without human intervention\n---\n\n### Overview\n\nA headless orchestrator is an agent that:\n1. Starts the relay infrastructure itself (`agent-relay up`)\n2. Spawns and manages worker agents\n3. Monitors agent lifecycle events\n4. Coordinates work without human intervention\n\n### When to Use\n\n- Agent needs full control over its worker team\n- No human available to run `agent-relay up` manually\n- Agent should manage agent lifecycle autonomously\n- Building self-contained multi-agent systems\n\n### Quick Reference\n\n| Step | Command/Tool |\n|------|--------------|\n| Verify installation | `command -v agent-relay` or `npx agent-relay --version` |\n| Verify Node runtime if shim fails | `node --version` or fix mise/asdf first |\n| Start infrastructure | `agent-relay up --no-dashboard --verbose` |\n| Check status | `agent-relay status` |\n| Spawn worker | `agent-relay spawn Worker1 claude \"task\"` |\n| List workers | `agent-relay who` |\n| View worker logs | `agent-relay agents:logs Worker1` |\n| Send message | `agent-relay send Worker1 \"message\"` |\n| Release worker | `agent-relay release Worker1` |\n| Stop infrastructure | `agent-relay down` |\n\n### Bootstrap Flow\n\n#### Step 0: Verify Installation\n\n```bash\n# Check if agent-relay is available\ncommand -v agent-relay || npx agent-relay --version\n\n# If your shell reports a mise/asdf shim error, fix Node first\nnode --version\n# e.g. for mise: mise use -g node@22.22.1\n\n# If not installed, install globally\nnpm install -g agent-relay\n\n# Or use npx (no global install)\nnpx agent-relay --version\n```\n\n#### Step 1: Start Infrastructure\n\n```bash\n# Preferred: run broker in foreground/stdin mode and keep the session open\nagent-relay up --no-dashboard --verbose\n```\n\n#### Step 2: Spawn Workers via MCP\n\n```\nmcp__relaycast__agent_add(\n  name: \"Worker1\",\n  cli: \"claude\",\n  task: \"Implement the authentication module following the existing patterns\"\n)\n```\n\n#### Step 3: Monitor and Coordinate\n\n```\n# Check for worker messages\nmcp__relaycast__message_inbox_check()\n\n# Send follow-up instructions\nmcp__relaycast__message_dm_send(to: \"Worker1\", text: \"Also add unit tests\")\n\n# List active workers\nmcp__relaycast__agent_list()\n```\n\n#### Step 4: Release Workers\n\n```\nmcp__relaycast__agent_remove(name: \"Worker1\")\n```\n\n#### Step 5: Shutdown (optional)\n\n```bash\nagent-relay down\n```\n\n\n### CLI Commands for Orchestration\n\n#### Spawning and Messaging\n\n```bash\n# Spawn a worker\nagent-relay spawn Worker1 claude \"Implement auth module\"\n\n# Send message to worker\nagent-relay send Worker1 \"Add unit tests too\"\n\n# Release when done\nagent-relay release Worker1\n```\n\n#### Monitoring Workers (Essential)\n\n```bash\n# Show currently active agents\nagent-relay who\n\n# View real-time output from a worker (critical for debugging)\nagent-relay agents:logs Worker1\n\n# View recent message history\nagent-relay history\n\n# Check overall system status\nagent-relay status\n```\n\n#### Troubleshooting\n\n```bash\n# Kill unresponsive worker\nagent-relay agents:kill Worker1\n\n# Re-check broker status\nagent-relay status\n\n# If a worker looks stuck, inspect its logs first\nagent-relay agents:logs Worker1\n```\n\n\n### Orchestrator Instructions Template\n\n#### Give your lead agent these instructions:\n\n```\nYou are an autonomous orchestrator. Bootstrap the relay infrastructure and manage a team of workers.\n\n## Step 1: Verify Installation\nRun: command -v agent-relay || npx agent-relay --version\nIf you hit a mise/asdf shim error: verify Node first with `node --version`, then fix the runtime manager\nIf not found: npm install -g agent-relay\n\n## Step 2: Start Infrastructure\nRun: agent-relay up --no-dashboard --verbose\nVerify: agent-relay status (should show \"running\")\n\n## Step 3: Manage Your Team\n\nSpawn workers:\n  agent-relay spawn Worker1 claude \"Task description\"\n\nMonitor workers (do this frequently):\n  agent-relay who              # List active workers\n  agent-relay agents:logs Worker1  # View worker output/progress\n\nSend instructions:\n  agent-relay send Worker1 \"Additional instructions\"\n\nRelease when done:\n  agent-relay release Worker1\n\n## Protocol\n- Workers will ACK when they receive tasks\n- Workers will send DONE when complete\n- Use `agent-relay agents:logs <name>` to monitor progress\n- Use `agent-relay history` to see message flow\n```\n\n\n### Lifecycle Events\n\nThe broker emits these events (available via SDK subscriptions):\n\n| Event | When |\n|-------|------|\n| `agent_spawned` | Worker process started |\n| `worker_ready` | Worker connected to relay |\n| `agent_idle` | Worker waiting for messages |\n| `agent_exited` | Worker process ended |\n| `agent_permanently_dead` | Worker failed after retries |\n\n### Common Mistakes\n\n| Mistake | Fix |\n|---------|-----|\n| `agent-relay: command not found` or mise/asdf shim error | Ensure Node is available first (`node --version`); if a shim is broken, fix the runtime manager, then install/use `agent-relay` |\n| \"Nested session\" error | Broker handles this automatically; if running manually, unset `CLAUDECODE` env var |\n| Broker not starting | Try `agent-relay down` first, then use foreground `agent-relay up --no-dashboard --verbose` to see readiness logs |\n| Background broker says started but status is STOPPED | Prefer foreground mode for that project/session; background mode may have detached incorrectly |\n| Spawn fails with `internal reply dropped` | Broker likely is not fully ready yet; wait for readiness, then spawn one worker first |\n| Workers not connecting | Ensure broker started; check `agent-relay who` and worker logs |\n| Not monitoring workers | Use `agent-relay agents:logs <name>` frequently to track progress |\n| Workers seem stuck | Check logs with `agent-relay agents:logs <name>` for errors |\n| Messages not delivered | Check `agent-relay history` to verify message flow |\n\n### Overview\n\nSelf-bootstrap agent-relay infrastructure and manage a team of agents autonomously.\n\n### Prerequisites\n\n#### 1. **agent-relay CLI installed** (required)\n\n```bash\nnpm install -g agent-relay\n   # Or use npx without installing: npx agent-relay <command>\n```\n' >> '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && printf '%s\\n' '\n# choosing-swarm-patterns\nreason=Spec text mentions \"pick\". Spec text mentions \"covers\".\n' >> '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && printf '%s\\n' '---\nname: choosing-swarm-patterns\ndescription: Use when coordinating multiple AI agents and need to pick the right orchestration pattern - covers 10 patterns (fan-out, pipeline, hub-spoke, consensus, mesh, handoff, cascade, dag, debate, hierarchical) with decision framework and reflection protocol\n---\n\n### Overview\n\n10 orchestration patterns for multi-agent workflows. Pick the simplest pattern that solves the problem — add complexity only when the system proves it'\\''s insufficient.\n\n### Quick Decision Framework\n\n#### ```\n\n```\nIs the task independent per agent?\n  YES → fan-out (parallel workers)\n\nDoes each step need the previous step'\\''s output?\n  YES → Is it strictly linear?\n    YES → pipeline\n    NO  → dag (parallel where possible)\n\nDoes a coordinator need to stay alive and adapt?\n  YES → Is there one level of management?\n    YES → hub-spoke\n    NO  → hierarchical (multi-level)\n\nIs the task about making a decision?\n  YES → Do agents need to argue opposing sides?\n    YES → debate (adversarial)\n    NO  → consensus (cooperative voting)\n\nDoes the right specialist emerge during processing?\n  YES → handoff (dynamic routing)\n\nDo all agents need to freely collaborate?\n  YES → mesh (peer-to-peer)\n\nIs cost the primary concern?\n  YES → cascade (cheap model first, escalate if needed)\n```\n\n\n### Pattern Reference\n\n| # | Pattern | Topology | Agents | Best For |\n|---|---------|----------|--------|----------|\n| 1 | **fan-out** | Star (SDK center) | N parallel | Independent subtasks (reviews, research, tests) |\n| 2 | **pipeline** | Linear chain | Sequential | Ordered stages (design → implement → test) |\n| 3 | **hub-spoke** | Star (live hub) | 1 lead + N workers | Dynamic coordination, lead reviews/adjusts |\n| 4 | **consensus** | Broadcast + vote | N voters | Architecture decisions, approval gates |\n| 5 | **mesh** | Fully connected | N peers | Brainstorming, collaborative debugging |\n| 6 | **handoff** | Routing chain | 1 active at a time | Triage, specialist routing, support flows |\n| 7 | **cascade** | Tiered escalation | Cheapest → most capable | Cost optimization, production workloads |\n| 8 | **dag** | Dependency graph | Parallel + joins | Complex projects with mixed dependencies |\n| 9 | **debate** | Adversarial rounds | 2+ debaters + judge | Rigorous evaluation, architecture trade-offs |\n| 10 | **hierarchical** | Tree (multi-level) | Lead → coordinators → workers | Large teams, domain separation |\n\n### Pattern Details\n\n#### 1. fan-out — Parallel Workers\n\n```ts\nfanOut([\n  { task: \"Review auth.ts\", name: \"AuthReviewer\" },\n  { task: \"Review db.ts\", name: \"DbReviewer\" },\n], { cli: \"claude\" });\n```\n\n#### 2. pipeline — Sequential Stages\n\n```ts\npipeline([\n  { task: \"Design the API schema\", name: \"Designer\" },\n  { task: \"Implement the endpoints\", name: \"Implementer\" },\n  { task: \"Write integration tests\", name: \"Tester\" },\n]);\n```\n\n#### 3. hub-spoke — Persistent Coordinator\n\n```ts\nhubAndSpoke({\n  hub: { task: \"Coordinate building a REST API\", name: \"Lead\" },\n  workers: [\n    { task: \"Build database models\", name: \"DbWorker\" },\n    { task: \"Build route handlers\", name: \"ApiWorker\" },\n  ],\n});\n```\n\n#### 4. consensus — Cooperative Voting\n\n```ts\nconsensus({\n  proposal: \"Should we migrate to Fastify?\",\n  voters: [\n    { task: \"Evaluate performance\", name: \"PerfExpert\" },\n    { task: \"Evaluate DX\", name: \"DxExpert\" },\n  ],\n  consensusType: \"majority\",\n});\n```\n\n#### 5. mesh — Peer Collaboration\n\n```ts\nmesh({\n  goal: \"Debug the auth flow returning 500\",\n  agents: [\n    { task: \"Check server logs\", name: \"LogAnalyst\" },\n    { task: \"Review auth code\", name: \"CodeReviewer\" },\n    { task: \"Write repro test\", name: \"Tester\" },\n  ],\n});\n```\n\n#### 6. handoff — Dynamic Routing\n\n```ts\nhandoff({\n  entryPoint: { task: \"Triage the request\", name: \"Triage\" },\n  routes: [\n    { agent: { task: \"Handle billing\", name: \"Billing\" }, condition: \"billing, payment\" },\n    { agent: { task: \"Handle tech issues\", name: \"TechSupport\" }, condition: \"error, bug\" },\n  ],\n  maxHandoffs: 3,\n});\n```\n\n#### 7. cascade — Cost-Aware Escalation\n\n```ts\ncascade({\n  tiers: [\n    { agent: { task: \"Answer this\", cli: \"claude\" }, confidenceThreshold: 0.7, costWeight: 1 },\n    { agent: { task: \"Answer this\", cli: \"claude\" }, confidenceThreshold: 0.85, costWeight: 5 },\n    { agent: { task: \"Answer this\", cli: \"claude\" }, costWeight: 20 },\n  ],\n});\n```\n\n#### 8. dag — Directed Acyclic Graph\n\n```ts\ndag({\n  nodes: [\n    { id: \"scaffold\", task: \"Create project scaffold\" },\n    { id: \"frontend\", task: \"Build React UI\", dependsOn: [\"scaffold\"] },\n    { id: \"backend\", task: \"Build API\", dependsOn: [\"scaffold\"] },\n    { id: \"integrate\", task: \"Wire together\", dependsOn: [\"frontend\", \"backend\"] },\n  ],\n  maxConcurrency: 3,\n});\n```\n\n#### 9. debate — Adversarial Refinement\n\n```ts\ndebate({\n  topic: \"Monorepo vs polyrepo for the new platform?\",\n  debaters: [\n    { task: \"Argue for monorepo\", position: \"monorepo\" },\n    { task: \"Argue for polyrepo\", position: \"polyrepo\" },\n  ],\n  judge: { task: \"Judge and decide\", name: \"ArchJudge\" },\n  maxRounds: 3,\n});\n```\n\n#### 10. hierarchical — Multi-Level Delegation\n\n```ts\nhierarchical({\n  agents: [\n    { id: \"lead\", task: \"Coordinate full-stack app\", role: \"lead\" },\n    { id: \"fe-coord\", task: \"Manage frontend\", role: \"coordinator\", reportsTo: \"lead\" },\n    { id: \"be-coord\", task: \"Manage backend\", role: \"coordinator\", reportsTo: \"lead\" },\n    { id: \"fe-dev\", task: \"Build components\", role: \"worker\", reportsTo: \"fe-coord\" },\n    { id: \"be-dev\", task: \"Build API\", role: \"worker\", reportsTo: \"be-coord\" },\n  ],\n});\n```\n\n\n### Reflection Protocol\n\n#### All patterns support reflection — periodic synthesis that enables course correction. Enabled via `reflectionThreshold` on WorkflowOptions.\n\n```ts\n{\n  reflectionThreshold: 10, // trigger after 10 agent messages\n  onReflect: async (ctx) => {\n    // Examine ctx.recentMessages, ctx.agentStatuses\n    // Return adjustments or null\n  },\n}\n```\n\n\n### Common Mistakes\n\n| Mistake | Why It Fails | Fix |\n|---------|-------------|-----|\n| Using mesh for everything | O(n^2) communication, debugging nightmare | Use hub-spoke for most tasks |\n| Pipeline for independent work | Sequential bottleneck | Use fan-out or dag |\n| Hub-spoke for simple parallel tasks | Hub is unnecessary overhead | Use fan-out |\n| Consensus for non-decisions | Voting on implementation tasks wastes time | Use hub-spoke, let lead decide |\n| No circuit breaker on handoff | Infinite routing loops | Always set maxHandoffs |\n| Cascade without confidence parsing | Agents don'\\''t report confidence | Convention injection handles this |\n| Hierarchical for 3 agents | Management overhead exceeds benefit | Use hub-spoke for small teams |\n\n### DAG Executor — Proven Pattern\n\n#### Agent Completion: Detect → Release → Collect\n\n```\nAgent writes summary file → Orchestrator polls (5s) → Detects new mtime →\n  Reads summary → Calls client.release(agent) → agent_exited fires → Node marked complete\n```\n\n#### State & Resume\n\n```ts\nsaveState(completed, depsOutput, results, startTime);\n// Restart with --resume to skip completed nodes\n```\n\n\n### YAML Workflow Definition\n\n#### Any pattern can be defined in YAML for portability:\n\n```yaml\nversion: \"1.0\"\nname: feature-dev\npattern: hub-spoke\nagents:\n  - id: lead\n    role: lead\n    cli: claude\n  - id: developer\n    role: worker\n    cli: codex\n    reportsTo: lead\nsteps:\n  - id: plan\n    agent: lead\n    prompt: \"Create a development plan for: {{task}}\"\n    expects: \"PLAN_COMPLETE\"\n  - id: implement\n    agent: developer\n    dependsOn: [plan]\n    prompt: \"Implement: {{steps.\\.output}}\"\n    expects: \"DONE\"\nreflection:\n  enabled: true\n  threshold: 10\ntrajectory:\n  enabled: true\n```\n' >> '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md' && echo GENERATED_WORKFLOW_CONTEXT_READY",
      captureOutput: true,
      failOnError: true,
    })

    .step("skill-boundary-metadata-gate", {
      type: 'deterministic',
      dependsOn: ["prepare-context"],
      command: "test -f '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && test -f '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-matches.json' && test -f '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/tool-selection.json' && grep -F 'generation_time_only' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"runtimeEmbodiment\":false' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F 'relay-80-100-workflow' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F 'writing-agent-relay-workflows' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F 'running-headless-orchestrator' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F 'choosing-swarm-patterns' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"stage\":\"generation_selection\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"stage\":\"generation_loading\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"effect\":\"metadata\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"effect\":\"pattern_selection\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"effect\":\"workflow_contract\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json' && grep -F '\"effect\":\"validation_gates\"' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json'",
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['skill-boundary-metadata-gate'],
      timeoutMs: 600000,
      task: `Plan the workflow execution from the normalized spec.

Generation-time skill boundary:
- Read .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json and treat it as generator metadata only.
- Skills are applied by Ricky during selection, loading, and template rendering.
- Do not claim generated agents load, retain, or embody skill files at runtime unless a future runtime test proves that path.

Description:
# Launch Catalog Spec — Beat Mirage by Launch

Status: **draft v0** • Owner: relayfile-adapters • Target: launch +7d

## 1. Goal

Ship a catalog that is **visibly larger than [Mirage's 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn't have.

Hard targets:

- **≥ 50 catalog entries** at launch (vs Mirage's 32). Headline number on the site.
- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.
- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.
- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.
- Every Mirage-listed SaaS we don't already cover gets at least a Tier-3 entry, so no \`mirage-vs-relayfile\` matrix has a row where Mirage wins on coverage.

Non-goals for launch:

- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.
- Replacing Pipedream/Nango on the auth side — we're a thin schema layer over them.
- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single \`query.json\` writeback for now.

## 2. Strategy: leverage what Mirage doesn't have

Three multipliers we already have in-tree:

1. **Schema-driven generation** — \`@relayfile/adapter-core\` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**
2. **Provider matrix** — every adapter inherits OAuth from \`@relayfile/provider-{nango,pipedream,composio,clerk}\`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.
3. **Webhook + writeback primitives** — already in \`webhook-server\` + adapter \`writeback.ts\`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.

## 3. Tier definitions

| Tier | Read | Write | Ingest | Sig verify | Tests | Use case |
|---|---|---|---|---|---|---|
| **T1** | ✓ | ✓ | webhook | required | path-mapper + writeback + signature fixtures | Daily-driver action surface |
| **T2** | ✓ | ✓ | polling (cursor) | n/a | path-mapper + writeback fixtures | Webhook-less or write-rare APIs |
| **T3** | ✓ | optional | polling | n/a | OpenAPI parse + smoke fixture | Long-tail + reference data |

Promotion path: T3 → T2 once a write surface is justified by demand; T2 → T1 once webhooks land or polling becomes the bottleneck.

## 4. Catalog (52 entries)

Bold = ships at launch. *Italic* = exists today.

| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |
|---|---|---|---|---|---|
| **Local & primitives** ||||||
| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing \`relayfile-mount\` |
| 2 | **in-memory** | T1 | RAM | none | existing |
| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |
| **Object storage** ||||||
| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |
| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |
| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |
| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |
| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |
| **File storage SaaS** ||||||
| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + \`changes.watch\` push |
| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |
| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |
| **Microsoft 365** ||||||
| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph \`/me/messages\` + Graph subscriptions |
| 13 | **onedrive** | T2 | — | nango/pipedream | Graph \`/drives\` + subscriptions |
| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |
| **Google Workspace** ||||||
| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub \`users.watch\` |
| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + \`events.watch\` push |
| 17 | **google-docs** | T2 | Docs | nango/pipedream | Docs v1 (read), Drive change events for ingest |
| 18 | **google-sheets** | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |
| 19 | **google-slides** | T3 | Slides | nango/pipedream | Slides v1 |
| **Code & DevOps** ||||||
| 20 | *github* | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |
| 21 | *gitlab* | T1 | — | nango | REST v4 + webhooks |
| 22 | **bitbucket** | T2 | — | nango | Cloud REST 2.0 + webhooks |
| 23 | **vercel** | T2 | Vercel | nango | REST + deployment webhooks |
| 24 | **netlify** | T3 | — | nango | REST + outgoing webhooks |
| **Issue / Project** ||||||
| 25 | *linear* | T1 | Linear | nango/pipedream | GraphQL + webhooks |
| 26 | **jira** | T1 | — | nango/pipedream | REST v3 + webhooks |
| 27 | **asana** | T1 | — | nango/pipedream | REST + webhooks |
| 28 | **trello** | T2 | Trello | nango | REST + webhook callbacks |
| 29 | **clickup** | T2 | — | nango | API v2 + webhooks |
| 30 | **shortcut** | T3 | — | nango | REST v3 |
| **Docs / Notes** ||||||
| 31 | *notion* | T1 | Notion | nango (notion-ingest exists) | API + recently added webhooks |
| 32 | **confluence** | T2 | — | nango/pipedream | REST + webhooks (Atlassian Connect) |
| 33 | **coda** | T3 | — | nango | API v1 + webhooks |
| **Chat** ||||||
| 34 | *slack* | T1 | Slack | nango/pipedream | Web API + Events API |
| 35 | *teams* | T2 | — | nango/pipedream | Graph chats + change notifications |
| 36 | **discord** | T1 | Discord | nango | REST v10 + interaction webhooks |
| 37 | **telegram** | T2 | Telegram | nango | Bot API + webhook setWebhook |
| **CRM** ||||||
| 38 | **hubspot** | T1 | — | nango/pipedream | CRM v3 + webhooks v3 |
| 39 | **salesforce** | T2 | — | nango/pipedream | REST + Streaming/Platform Events |
| 40 | **pipedrive** | T3 | — | nango | API v2 + webhooks v1 |
| **Support** ||||||
| 41 | **intercom** | T1 | — | nango/pipedream | REST + webhook topics |
| 42 | **zendesk** | T2 | — | nango/pipedream | REST + webhooks/triggers |
| 43 | **freshdesk** | T3 | — | nango | REST + webhook automations |
| **Observability / incident** ||||||
| 44 | **sentry** | T1 | — | nango | REST + webhook integrations |
| 45 | **datadog** | T2 | — | nango | API v2 + webhooks integration |
| 46 | **posthog** | T2 | PostHog | nango | API + action webhooks |
| 47 | **pagerduty** | T1 | — | nango | REST + webhook subscriptions v3 |
| 48 | **langfuse** | T3 | Langfuse | direct PAT | OpenAPI |
| **DB / payments / email / research** ||||||
| 49 | **postgres** | T3 | Postgres | direct DSN | LISTEN/NOTIFY for ingest, query.json writeback |
| 50 | **mongodb** | T3 | MongoDB | direct DSN | change streams, query.json writeback |
| 51 | **stripe** | T1 | — | nango | REST + signed webhooks |
| 52 | **smtp-imap** | T2 | Email | direct creds | RFC 5321/3501 |
| 53 | **semantic-scholar** | T3 | Semantic Scholar | optional API key | Graph API v1 |
| 54 | **arxiv** | T3 | — | none | OAI-PMH / Atom feed |

**54 entries; 32 in Mirage.** Of those, **17 Tier-1 (incl. existing)**, **18 Tier-2**, **19 Tier-3**.

Mirage rows we deliberately *don't* match:
- **OPFS** — browser-only mount, covered conceptually by \`local-disk\` in our agent-side mount layer. Not a SaaS adapter.
- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.
- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.

If the marketing team wants 60+ headline number for splash, the "stretch row" candidates are: \`oci\`, \`webflow\`, \`airtable\`, \`mailchimp\`, \`shopify\`, \`quickbooks\` — all already have Nango templates and OpenAPI specs available.

## 5. Tier-1 adapter spec sheets

Compact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.

### 5.1 \`jira\`

- **Base URL**: \`https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3\`
- **Auth**: OAuth 2.0 (3LO), \`cloudid\` resolved via \`/oauth/token/accessible-resources\`
- **Pagination**: \`startAt\` / \`maxResults\` (offset, default 50, max 100); newer endpoints use \`nextPageToken\` (next-token)
- **Webhooks**: registered via Connect app or REST \`/rest/api/3/webhook\`; signature header \`X-Atlassian-Webhook-Identifier\`
- **Path mapping**:
  - \`/jira/projects/{projectKey}/issues/{issueKey}/metadata.json\`
  - \`/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json\`
- **Webhook events**: \`jira:issue_created|updated|deleted\`, \`comment_created|updated|deleted\`
- **Writeback globs**:
  - \`/jira/projects/*/issues/*/comments/*.json\` → \`POST /issue/{issueKey}/comment\`
  - \`/jira/projects/*/issues/*/transition.json\` → \`POST /issue/{issueKey}/transitions\`
  - \`/jira/projects/*/issues/*/metadata.json\` (PUT) → \`PUT /issue/{issueKey}\`
- **Nango template ref**: \`integrations/jira\`

### 5.2 \`asana\`

- **Base URL**: \`https://app.asana.com/api/1.0\`
- **Auth**: OAuth 2.0 or PAT
- **Pagination**: \`offset\` token in \`next_page.offset\`, \`limit\` 1–100
- **Webhooks**: \`POST /webhooks\` with \`target\` URL; handshake via \`X-Hook-Secret\` echo; subsequent deliveries signed with \`X-Hook-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json\`
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json\`
- **Webhook events**: \`task.{added|changed|deleted}\`, \`story.added\`
- **Writeback globs**:
  - \`/asana/.../tasks/*/stories/*.json\` → \`POST /tasks/{tid}/stories\`
  - \`/asana/.../tasks/*/metadata.json\` (PUT) → \`PUT /tasks/{tid}\`
- **Nango template ref**: \`integrations/asana\`

### 5.3 \`discord\`

- **Base URL**: \`https://discord.com/api/v10\`
- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads
- **Pagination**: \`before\` / \`after\` snowflake cursors
- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)
- **Signature verify**: Ed25519 over \`X-Signature-Ed25519\` + \`X-Signature-Timestamp\` (interactions). Channel webhooks aren't signed; rely on URL secrecy + IP allowlist.
- **Path mapping**:
  - \`/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json\`
  - \`/discord/guilds/{gid}/members/{uid}.json\`
- **Writeback globs**:
  - \`/discord/guilds/*/channels/*/messages/post.json\` → \`POST /channels/{cid}/messages\`
  - \`/discord/guilds/*/channels/*/messages/*.json\` (PUT) → \`PATCH /channels/{cid}/messages/{mid}\`

### 5.4 \`hubspot\`

- **Base URL**: \`https://api.hubapi.com\`
- **Auth**: OAuth 2.0 or private app token
- **Pagination**: \`paging.next.after\` cursor (\`limit\` ≤ 100)
- **Webhooks**: configured per-app in HubSpot dev portal; signed with \`X-HubSpot-Signature-v3\` (HMAC-SHA256 over method + URI + body + timestamp)
- **Path mapping**:
  - \`/hubspot/objects/contacts/{id}.json\`
  - \`/hubspot/objects/deals/{id}.json\`
  - \`/hubspot/objects/companies/{id}.json\`
- **Webhook events**: \`contact.creation|propertyChange|deletion\`, \`deal.*\`, \`company.*\`
- **Writeback globs**:
  - \`/hubspot/objects/contacts/*.json\` (PUT) → \`PATCH /crm/v3/objects/contacts/{id}\`
  - \`/hubspot/objects/contacts/create.json\` → \`POST /crm/v3/objects/contacts\`
- **Nango template ref**: \`integrations/hubspot\`

### 5.5 \`intercom\`

- **Base URL**: \`https://api.intercom.io\`
- **Auth**: OAuth or access token
- **Pagination**: \`pages.next.starting_after\` cursor (Conversations API)
- **Webhooks**: per-app subscriptions, signed with \`X-Hub-Signature\` (HMAC-SHA1 over body using app client secret)
- **Path mapping**:
  - \`/intercom/conversations/{id}/metadata.json\`
  - \`/intercom/conversations/{id}/parts/{partId}.json\`
  - \`/intercom/contacts/{id}.json\`
- **Webhook events**: \`conversation.user.created|replied\`, \`conversation.admin.replied|noted\`, \`contact.*\`
- **Writeback globs**:
  - \`/intercom/conversations/*/reply.json\` → \`POST /conversations/{id}/reply\`
  - \`/intercom/contacts/*.json\` (PUT) → \`PUT /contacts/{id}\`

### 5.6 \`pagerduty\`

- **Base URL**: \`https://api.pagerduty.com\`
- **Auth**: OAuth or REST API token (\`Authorization: Token token=...\`)
- **Pagination**: \`offset\` / \`limit\` (max 100); newer endpoints use \`cursor\`
- **Webhooks**: v3 subscriptions API (\`POST /webhook_subscriptions\`), signed with \`X-PagerDuty-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/pagerduty/services/{sid}/incidents/{iid}/metadata.json\`
  - \`/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json\`
- **Webhook events**: \`incident.triggered|acknowledged|resolved|annotated\`
- **Writeback globs**:
  - \`/pagerduty/.../incidents/*/notes.json\` → \`POST /incidents/{iid}/notes\`
  - \`/pagerduty/.../incidents/*/metadata.json\` (PUT) → \`PUT /incidents/{iid}\`

### 5.7 \`sentry\`

- **Base URL**: \`https://sentry.io/api/0\`
- **Auth**: OAuth or auth token (org-scoped)
- **Pagination**: \`Link\` header cursor (link-header strategy)
- **Webhooks**: per-integration; signed with \`Sentry-Hook-Signature\` (HMAC-SHA256 of body using integration client secret)
- **Path mapping**:
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json\`
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json\`
- **Webhook events**: \`issue.created|resolved|assigned\`, \`error.created\`
- **Writeback globs**:
  - \`/sentry/.../issues/*/metadata.json\` (PUT) → \`PUT /issues/{issueId}\`
  - \`/sentry/.../issues/*/comments.json\` → \`POST /issues/{issueId}/comments\`

### 5.8 \`stripe\`

- **Base URL**: \`https://api.stripe.com/v1\`
- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)
- **Pagination**: \`starting_after\` cursor (objects sortable by creation)
- **Webhooks**: signed with \`Stripe-Signature\` (timestamp + v1 HMAC-SHA256, anti-replay window)
- **Path mapping**:
  - \`/stripe/customers/{cid}.json\`
  - \`/stripe/customers/{cid}/subscriptions/{sid}.json\`
  - \`/stripe/charges/{chargeId}.json\`
- **Webhook events**: \`customer.*\`, \`invoice.*\`, \`charge.*\`, \`payment_intent.*\`
- **Writeback globs**:
  - \`/stripe/customers/*.json\` (PUT) → \`POST /customers/{cid}\` (form-encoded)
  - \`/stripe/customers/*/refund.json\` → \`POST /refunds\`

### 5.9 \`gmail\`

- **Base URL**: \`https://gmail.googleapis.com/gmail/v1\`
- **Auth**: OAuth 2.0 (scopes: \`gmail.readonly\` + \`gmail.send\` + \`gmail.modify\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`users.watch\` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream's Gmail trigger as ingest source)
- **Path mapping**:
  - \`/gmail/messages/{messageId}/metadata.json\`
  - \`/gmail/messages/{messageId}/raw.eml\`
  - \`/gmail/labels/{labelId}/messages/\` (virtual list)
- **Writeback globs**:
  - \`/gmail/messages/send.json\` → \`POST /users/me/messages/send\`
  - \`/gmail/messages/*/labels.json\` (PUT) → \`POST /users/me/messages/{id}/modify\`

### 5.10 \`google-calendar\`

- **Base URL**: \`https://www.googleapis.com/calendar/v3\`
- **Auth**: OAuth 2.0 (scope \`calendar.events\`)
- **Pagination**: \`pageToken\` (next-token); incremental sync via \`syncToken\`
- **Ingest**: \`events.watch\` push channels → webhook (channels expire ≤30d, need refresher)
- **Path mapping**:
  - \`/gcal/calendars/{calId}/events/{eventId}.json\`
- **Webhook events**: \`events.changed\` (Google sends a sync ping; adapter pulls delta)
- **Writeback globs**:
  - \`/gcal/calendars/*/events/*.json\` (PUT) → \`PUT /calendars/{calId}/events/{eventId}\`
  - \`/gcal/calendars/*/events/create.json\` → \`POST /calendars/{calId}/events\`

### 5.11 \`google-drive\`

- **Base URL**: \`https://www.googleapis.com/drive/v3\`
- **Auth**: OAuth 2.0 (scopes: \`drive\` or \`drive.file\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`changes.watch\` push channels (account-wide change feed)
- **Path mapping**:
  - \`/gdrive/files/{fileId}/metadata.json\`
  - \`/gdrive/files/{fileId}/content\` (binary, exported per mimeType)
- **Writeback globs**:
  - \`/gdrive/files/*/metadata.json\` (PUT) → \`PATCH /files/{fileId}\` (rename, move via \`addParents\`/\`removeParents\`)
  - \`/gdrive/files/upload.json\` → resumable upload \`POST /upload/drive/v3/files\`

### 5.12 \`slack\` *(existing — list for completeness; verify parity)*

- **Base URL**: \`https://slack.com/api\`
- **Auth**: OAuth 2.0 (bot + user scopes)
- **Pagination**: \`response_metadata.next_cursor\`
- **Ingest**: Events API webhook, signed with \`X-Slack-Signature\` (v0 HMAC-SHA256 + timestamp)
- **Already shipping** — confirm webhook signature and writeback globs match this spec.

### 5.13 \`linear\` *(existing)*

- GraphQL only. Confirm webhook subscriptions are configured during connection setup.

### 5.14 \`notion\` *(existing)*

- Notion shipped webhooks in 2025; mapping should add webhook entries for \`page.updated\`, \`database.updated\`, \`comment.created\`. Existing \`notion-ingest-handler\` in \`provider-nango\` should keep working as polling fallback.

### 5.15 \`s3\`

- **Base URL**: \`https://{bucket}.s3.{region}.amazonaws.com\`
- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials
- **Pagination**: \`ContinuationToken\` (cursor)
- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)
- **Path mapping**:
  - \`/s3/{bucket}/{key}\` (binary content)
  - \`/s3/{bucket}/{key}/metadata.json\` (object headers)
- **Writeback globs**:
  - \`/s3/{bucket}/*\` (PUT) → \`PUT /{bucket}/{key}\` (multipart for >5MB)

### 5.16 \`github\` *(existing)*

- Reference for everything. Don't change.

### 5.17 \`local-disk\` *(existing — primitive)*

- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by \`relayfile-mount\`.

## 6. Tier-2 spec sheets (compact)

For T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.

| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |
|---|---|---|---|---|
| \`salesforce\` | \`https://{instance}.my.salesforce.com/services/data/v60.0\` | next-record-url (link-style) | Streaming API / Platform Events sidecar | \`/sf/objects/Account/*.json\`, \`/sf/objects/Contact/*.json\` |
| \`zendesk\` | \`https://{sub}.zendesk.com/api/v2\` | cursor (\`after_cursor\`) | Webhooks resource (\`/webhooks\`) signed with \`X-Zendesk-Webhook-Signature\` | \`/zendesk/tickets/{id}/comments.json\` |
| \`confluence\` | \`https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2\` | \`cursor\` | Connect-app webhooks | \`/confluence/spaces/{key}/pages/{id}/body.json\` |
| \`bitbucket\` | \`https://api.bitbucket.org/2.0\` | \`next\` URL | Repository webhooks | \`/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json\` |
| \`vercel\` | \`https://api.vercel.com\` | \`next\` cursor | Deployment / log-drain webhooks | \`/vercel/projects/{id}/env/*.json\` |
| \`outlook-mail\` | \`https://graph.microsoft.com/v1.0/me\` | \`@odata.nextLink\` | Graph subscriptions | \`/outlook/messages/send.json\` |
| \`onedrive\` | \`https://graph.microsoft.com/v1.0/me/drive\` | \`@odata.nextLink\` | Graph subscriptions | \`/onedrive/items/{id}\` content + metadata |
| \`dropbox\` | \`https://api.dropboxapi.com/2\` | \`cursor\` | account webhook + \`files/list_folder/longpoll\` | \`/dropbox/files/{path}\` |
| \`box\` | \`https://api.box.com/2.0\` | \`marker\` | webhooks v2 (signed) | \`/box/files/{id}\`, \`/box/folders/{id}/items\` |
| \`posthog\` | \`https://app.posthog.com/api\` | \`next\` URL | action webhooks | \`/posthog/projects/{id}/insights/{iid}.json\` |
| \`datadog\` | \`https://api.datadoghq.com/api/v2\` | \`next_cursor\` | webhooks integration | \`/datadog/monitors/{id}.json\`, \`/datadog/incidents/{id}.json\` |
| \`gcs\` | \`https://storage.googleapis.com/storage/v1\` | \`pageToken\` | Pub/Sub object change notifications | \`/gcs/{bucket}/{object}\` |
| \`azure-blob\` | \`https://{account}.blob.core.windows.net\` | \`marker\` | Event Grid → relay | \`/azureblob/{container}/{blob}\` |
| \`r2\` | S3-compatible | continuation-token | bucket → queue → relay | \`/r2/{bucket}/{key}\` |
| \`supabase\` | \`https://{ref}.supabase.co\` | range header | already supported | reuse existing |
| \`clickup\` | \`https://api.clickup.com/api/v2\` | \`page\` | webhooks | \`/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json\` |
| \`trello\` | \`https://api.trello.com/1\` | none (list-based) | webhook callbacks | \`/trello/boards/{id}/cards/{cardId}.json\` |
| \`telegram\` | \`https://api.telegram.org/bot{token}\` | \`offset\` | \`setWebhook\` | \`/telegram/chats/{chatId}/messages/send.json\` |
| \`teams\` | Graph chats | \`@odata.nextLink\` | change notifications | already shipping; confirm |
| \`smtp-imap\` | \`imap://...\` / \`smtp://...\` | IMAP UID | IMAP IDLE sidecar | \`/email/inbox/{uid}.eml\`, \`/email/send.json\` |
| \`ssh\` | host:port | n/a | none | \`/ssh/{host}/...\` |

## 7. Tier-3 spec sheets (catalog-only)

Each T3 adapter ships:

- A mapping YAML pointing at the public OpenAPI spec (or hand-written \`samples\` if no OpenAPI exists).
- A read-only resource set generated by the schema adapter.
- A single placeholder writeback (\`/{adapter}/_unsupported.json\` returns 501) to keep the contract consistent.
- One smoke test fixture per object type.

Adapters: \`freshdesk\`, \`pipedrive\`, \`shortcut\`, \`coda\`, \`langfuse\`, \`sharepoint\`, \`google-slides\`, \`netlify\`, \`postgres\`, \`mongodb\`, \`semantic-scholar\`, \`arxiv\`.

For \`postgres\` and \`mongodb\`, the read surface is a synthetic VFS:

- \`/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json\` — generated by introspection
- \`/postgres/{db}/queries/{name}.sql\` (write) → executes prepared statement, results land at \`/postgres/{db}/queries/{name}.results.json\`
- \`mongodb\` analogous with collections + \`.find.json\` / \`.results.json\`

These are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage's Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.

## 8. Build plan (7 days)

| Day | Deliverable |
|---|---|
| **Mon** | Land scaffolding tooling: a \`pnpm gen:adapter <name>\` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a \`templates/<name>.hints.yaml\` for each row. |
| **Tue** | T1 batch A: \`jira\`, \`asana\`, \`hubspot\`, \`stripe\` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |
| **Wed** | T1 batch B: \`intercom\`, \`pagerduty\`, \`sentry\`, \`discord\` (4). |
| **Thu** | T1 batch C: \`gmail\`, \`google-calendar\`, \`google-drive\`, \`s3\` (4). Push-channel/EventBridge ingest stubs land here. |
| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |
| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |
| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a \`mirage-vs-relayfile.md\` row, and a smoke test in CI. Cut \`@relayfile/adapters@<launch>\` versions. |

Parallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever's free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.

## 9. Quality bar

Per-adapter checklist before a tag is cut:

- [ ] \`mapping.yaml\` validated by \`@relayfile/adapter-core\` parser (zero warnings).
- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.
- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).
- [ ] Pagination strategy declared and exercised by at least one fixture.
- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.
- [ ] One-line README + a row in \`docs/CATALOG.md\`.
- [ ] Provider compatibility matrix (which providers are tested for this adapter).

CI gate: a \`pnpm catalog:audit\` script asserts that the published catalog count ≥ Mirage's tracked count (manually maintained in \`docs/MIRAGE_PARITY.md\` and grepped from their docs weekly).

## 10. Open questions

1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.
2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?
3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.
4. **Database adapters** (\`postgres\`, \`mongodb\`, \`mysql\`): is \`query.json\` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?
5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?

## 11. References

- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)
- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from \`integrations/<name>/syncs/*.ts\`
- [\`docs/MAPPING_YAML_SPEC.md\`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into
- [\`docs/PATH_SLUGIFICATION_SPEC.md\`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow
- Provider package READMEs in \`relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}\`

Implementation contract:
- If this is an implementation spec, agents must make source changes in the target repository rather than stopping at planning artifacts.
- Final success requires code/source changes, tests, non-empty diff evidence, and PR/result reporting unless the spec explicitly says planning-only.

Deliverables:
- RAM/Disk/OPFS
- Nango/Pipedream/Composio
- /crm/v3/objects/contacts
- /users/me/messages/send
- /users/me/messages
- /upload/drive/v3/files

Non-goals (must be reproduced as a "## Non-goals" section in lead-plan.md):
- Implementing every operation each API exposes — Tier-1 covers high-frequency object types only.
- Replacing Pipedream / Nango on the auth side — remain a thin schema layer over them.
- Mounting databases as queryable shells — Postgres/Mongo are read-only with a single query.json writeback at Tier-3.
- Re-creating already-shipped adapters (slack, linear, notion, github, gitlab, local-disk, teams, supabase) — parity-verified only.
- Runtime skill embodiment — skills are generation-time only; runtime agents must not claim they load or apply skills at execution time.

Routing contract:
- Local: run through Agent Relay using the generated workflow artifact and persist artifacts under .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status.
- Cloud: no separate cloud execution path is implied unless the normalized spec explicitly requests cloud; cloud callers receive the same generated artifact contract.
- MCP: generated runtime agents must not use Relaycast management or messaging tools; MCP callers receive artifacts without a separate runtime management path.

Verification commands:
- file_exists gate for declared targets
- deterministic sanity gate using POSIX grep, git grep, or an equivalent assertion
- catalog-audit-gate that runs node scripts/catalog-audit.mjs --json --write and asserts ok===true plus tier floors
- active-reference gate marker (no deleted manifest paths declared by this spec)
- npm run catalog:audit
- npm run test:catalog
- git diff gate using git status --porcelain on declared target dirs (docs/, scripts/, test/, workflows/) and re-asserting required anchors via grep -F
- PR URL or explicit result summary

Write .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/lead-plan.md ending with GENERATION_LEAD_PLAN_READY.`,
      verification: { type: 'output_contains', value: 'GENERATION_LEAD_PLAN_READY' },
    })

    .step("lead-plan-gate", {
      type: 'deterministic',
      dependsOn: ["lead-plan"],
      command: "node <<'NODE'\nconst fs = require('node:fs');\nconst leadPlanPath = \".workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/lead-plan.md\";\nconst body = fs.readFileSync(leadPlanPath, 'utf8');\nif (!body.includes('GENERATION_LEAD_PLAN_READY')) throw new Error('lead plan missing required marker: GENERATION_LEAD_PLAN_READY');\nif (!/non-goals?/i.test(body)) throw new Error('lead plan missing required marker: Non-goals');\nconst hasRoutingContract = /Routing contract/i.test(body) || /Local execution must run through Agent Relay/i.test(body) || /Run local execution through the generated Agent Relay workflow artifact/i.test(body) || /routes local execution through the generated Agent Relay artifact/i.test(body) || /Use the generated Agent Relay workflow artifact/i.test(body);\nif (!hasRoutingContract) throw new Error('lead plan missing required marker: Routing contract');\nconst hasImplementationContract = /Implementation contract/i.test(body) || /This is an implementation spec/i.test(body);\nif (!hasImplementationContract) throw new Error('lead plan missing required marker: Implementation contract');\nconsole.log('LEAD_PLAN_GATE_OK');\nNODE",
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-artifact', {
      agent: "impl-primary-codex",
      dependsOn: ['lead-plan-gate'],

      timeoutMs: 1200000,
      task: `Implement the requested code-writing workflow slice.

IMPLEMENTATION_WORKFLOW_CONTRACT:
- For implementation specs, edit source files and produce code changes, not just plan.md, mapping.json, or analysis artifacts.
- Keep a non-empty implementation diff outside transient artifact directories.
- Add or update tests that prove the changed behavior.

Scope:
# Launch Catalog Spec — Beat Mirage by Launch

Status: **draft v0** • Owner: relayfile-adapters • Target: launch +7d

## 1. Goal

Ship a catalog that is **visibly larger than [Mirage's 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn't have.

Hard targets:

- **≥ 50 catalog entries** at launch (vs Mirage's 32). Headline number on the site.
- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.
- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.
- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.
- Every Mirage-listed SaaS we don't already cover gets at least a Tier-3 entry, so no \`mirage-vs-relayfile\` matrix has a row where Mirage wins on coverage.

Non-goals for launch:

- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.
- Replacing Pipedream/Nango on the auth side — we're a thin schema layer over them.
- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single \`query.json\` writeback for now.

## 2. Strategy: leverage what Mirage doesn't have

Three multipliers we already have in-tree:

1. **Schema-driven generation** — \`@relayfile/adapter-core\` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**
2. **Provider matrix** — every adapter inherits OAuth from \`@relayfile/provider-{nango,pipedream,composio,clerk}\`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.
3. **Webhook + writeback primitives** — already in \`webhook-server\` + adapter \`writeback.ts\`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.

## 3. Tier definitions

| Tier | Read | Write | Ingest | Sig verify | Tests | Use case |
|---|---|---|---|---|---|---|
| **T1** | ✓ | ✓ | webhook | required | path-mapper + writeback + signature fixtures | Daily-driver action surface |
| **T2** | ✓ | ✓ | polling (cursor) | n/a | path-mapper + writeback fixtures | Webhook-less or write-rare APIs |
| **T3** | ✓ | optional | polling | n/a | OpenAPI parse + smoke fixture | Long-tail + reference data |

Promotion path: T3 → T2 once a write surface is justified by demand; T2 → T1 once webhooks land or polling becomes the bottleneck.

## 4. Catalog (52 entries)

Bold = ships at launch. *Italic* = exists today.

| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |
|---|---|---|---|---|---|
| **Local & primitives** ||||||
| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing \`relayfile-mount\` |
| 2 | **in-memory** | T1 | RAM | none | existing |
| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |
| **Object storage** ||||||
| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |
| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |
| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |
| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |
| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |
| **File storage SaaS** ||||||
| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + \`changes.watch\` push |
| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |
| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |
| **Microsoft 365** ||||||
| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph \`/me/messages\` + Graph subscriptions |
| 13 | **onedrive** | T2 | — | nango/pipedream | Graph \`/drives\` + subscriptions |
| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |
| **Google Workspace** ||||||
| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub \`users.watch\` |
| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + \`events.watch\` push |
| 17 | **google-docs** | T2 | Docs | nango/pipedream | Docs v1 (read), Drive change events for ingest |
| 18 | **google-sheets** | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |
| 19 | **google-slides** | T3 | Slides | nango/pipedream | Slides v1 |
| **Code & DevOps** ||||||
| 20 | *github* | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |
| 21 | *gitlab* | T1 | — | nango | REST v4 + webhooks |
| 22 | **bitbucket** | T2 | — | nango | Cloud REST 2.0 + webhooks |
| 23 | **vercel** | T2 | Vercel | nango | REST + deployment webhooks |
| 24 | **netlify** | T3 | — | nango | REST + outgoing webhooks |
| **Issue / Project** ||||||
| 25 | *linear* | T1 | Linear | nango/pipedream | GraphQL + webhooks |
| 26 | **jira** | T1 | — | nango/pipedream | REST v3 + webhooks |
| 27 | **asana** | T1 | — | nango/pipedream | REST + webhooks |
| 28 | **trello** | T2 | Trello | nango | REST + webhook callbacks |
| 29 | **clickup** | T2 | — | nango | API v2 + webhooks |
| 30 | **shortcut** | T3 | — | nango | REST v3 |
| **Docs / Notes** ||||||
| 31 | *notion* | T1 | Notion | nango (notion-ingest exists) | API + recently added webhooks |
| 32 | **confluence** | T2 | — | nango/pipedream | REST + webhooks (Atlassian Connect) |
| 33 | **coda** | T3 | — | nango | API v1 + webhooks |
| **Chat** ||||||
| 34 | *slack* | T1 | Slack | nango/pipedream | Web API + Events API |
| 35 | *teams* | T2 | — | nango/pipedream | Graph chats + change notifications |
| 36 | **discord** | T1 | Discord | nango | REST v10 + interaction webhooks |
| 37 | **telegram** | T2 | Telegram | nango | Bot API + webhook setWebhook |
| **CRM** ||||||
| 38 | **hubspot** | T1 | — | nango/pipedream | CRM v3 + webhooks v3 |
| 39 | **salesforce** | T2 | — | nango/pipedream | REST + Streaming/Platform Events |
| 40 | **pipedrive** | T3 | — | nango | API v2 + webhooks v1 |
| **Support** ||||||
| 41 | **intercom** | T1 | — | nango/pipedream | REST + webhook topics |
| 42 | **zendesk** | T2 | — | nango/pipedream | REST + webhooks/triggers |
| 43 | **freshdesk** | T3 | — | nango | REST + webhook automations |
| **Observability / incident** ||||||
| 44 | **sentry** | T1 | — | nango | REST + webhook integrations |
| 45 | **datadog** | T2 | — | nango | API v2 + webhooks integration |
| 46 | **posthog** | T2 | PostHog | nango | API + action webhooks |
| 47 | **pagerduty** | T1 | — | nango | REST + webhook subscriptions v3 |
| 48 | **langfuse** | T3 | Langfuse | direct PAT | OpenAPI |
| **DB / payments / email / research** ||||||
| 49 | **postgres** | T3 | Postgres | direct DSN | LISTEN/NOTIFY for ingest, query.json writeback |
| 50 | **mongodb** | T3 | MongoDB | direct DSN | change streams, query.json writeback |
| 51 | **stripe** | T1 | — | nango | REST + signed webhooks |
| 52 | **smtp-imap** | T2 | Email | direct creds | RFC 5321/3501 |
| 53 | **semantic-scholar** | T3 | Semantic Scholar | optional API key | Graph API v1 |
| 54 | **arxiv** | T3 | — | none | OAI-PMH / Atom feed |

**54 entries; 32 in Mirage.** Of those, **17 Tier-1 (incl. existing)**, **18 Tier-2**, **19 Tier-3**.

Mirage rows we deliberately *don't* match:
- **OPFS** — browser-only mount, covered conceptually by \`local-disk\` in our agent-side mount layer. Not a SaaS adapter.
- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.
- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.

If the marketing team wants 60+ headline number for splash, the "stretch row" candidates are: \`oci\`, \`webflow\`, \`airtable\`, \`mailchimp\`, \`shopify\`, \`quickbooks\` — all already have Nango templates and OpenAPI specs available.

## 5. Tier-1 adapter spec sheets

Compact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.

### 5.1 \`jira\`

- **Base URL**: \`https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3\`
- **Auth**: OAuth 2.0 (3LO), \`cloudid\` resolved via \`/oauth/token/accessible-resources\`
- **Pagination**: \`startAt\` / \`maxResults\` (offset, default 50, max 100); newer endpoints use \`nextPageToken\` (next-token)
- **Webhooks**: registered via Connect app or REST \`/rest/api/3/webhook\`; signature header \`X-Atlassian-Webhook-Identifier\`
- **Path mapping**:
  - \`/jira/projects/{projectKey}/issues/{issueKey}/metadata.json\`
  - \`/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json\`
- **Webhook events**: \`jira:issue_created|updated|deleted\`, \`comment_created|updated|deleted\`
- **Writeback globs**:
  - \`/jira/projects/*/issues/*/comments/*.json\` → \`POST /issue/{issueKey}/comment\`
  - \`/jira/projects/*/issues/*/transition.json\` → \`POST /issue/{issueKey}/transitions\`
  - \`/jira/projects/*/issues/*/metadata.json\` (PUT) → \`PUT /issue/{issueKey}\`
- **Nango template ref**: \`integrations/jira\`

### 5.2 \`asana\`

- **Base URL**: \`https://app.asana.com/api/1.0\`
- **Auth**: OAuth 2.0 or PAT
- **Pagination**: \`offset\` token in \`next_page.offset\`, \`limit\` 1–100
- **Webhooks**: \`POST /webhooks\` with \`target\` URL; handshake via \`X-Hook-Secret\` echo; subsequent deliveries signed with \`X-Hook-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json\`
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json\`
- **Webhook events**: \`task.{added|changed|deleted}\`, \`story.added\`
- **Writeback globs**:
  - \`/asana/.../tasks/*/stories/*.json\` → \`POST /tasks/{tid}/stories\`
  - \`/asana/.../tasks/*/metadata.json\` (PUT) → \`PUT /tasks/{tid}\`
- **Nango template ref**: \`integrations/asana\`

### 5.3 \`discord\`

- **Base URL**: \`https://discord.com/api/v10\`
- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads
- **Pagination**: \`before\` / \`after\` snowflake cursors
- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)
- **Signature verify**: Ed25519 over \`X-Signature-Ed25519\` + \`X-Signature-Timestamp\` (interactions). Channel webhooks aren't signed; rely on URL secrecy + IP allowlist.
- **Path mapping**:
  - \`/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json\`
  - \`/discord/guilds/{gid}/members/{uid}.json\`
- **Writeback globs**:
  - \`/discord/guilds/*/channels/*/messages/post.json\` → \`POST /channels/{cid}/messages\`
  - \`/discord/guilds/*/channels/*/messages/*.json\` (PUT) → \`PATCH /channels/{cid}/messages/{mid}\`

### 5.4 \`hubspot\`

- **Base URL**: \`https://api.hubapi.com\`
- **Auth**: OAuth 2.0 or private app token
- **Pagination**: \`paging.next.after\` cursor (\`limit\` ≤ 100)
- **Webhooks**: configured per-app in HubSpot dev portal; signed with \`X-HubSpot-Signature-v3\` (HMAC-SHA256 over method + URI + body + timestamp)
- **Path mapping**:
  - \`/hubspot/objects/contacts/{id}.json\`
  - \`/hubspot/objects/deals/{id}.json\`
  - \`/hubspot/objects/companies/{id}.json\`
- **Webhook events**: \`contact.creation|propertyChange|deletion\`, \`deal.*\`, \`company.*\`
- **Writeback globs**:
  - \`/hubspot/objects/contacts/*.json\` (PUT) → \`PATCH /crm/v3/objects/contacts/{id}\`
  - \`/hubspot/objects/contacts/create.json\` → \`POST /crm/v3/objects/contacts\`
- **Nango template ref**: \`integrations/hubspot\`

### 5.5 \`intercom\`

- **Base URL**: \`https://api.intercom.io\`
- **Auth**: OAuth or access token
- **Pagination**: \`pages.next.starting_after\` cursor (Conversations API)
- **Webhooks**: per-app subscriptions, signed with \`X-Hub-Signature\` (HMAC-SHA1 over body using app client secret)
- **Path mapping**:
  - \`/intercom/conversations/{id}/metadata.json\`
  - \`/intercom/conversations/{id}/parts/{partId}.json\`
  - \`/intercom/contacts/{id}.json\`
- **Webhook events**: \`conversation.user.created|replied\`, \`conversation.admin.replied|noted\`, \`contact.*\`
- **Writeback globs**:
  - \`/intercom/conversations/*/reply.json\` → \`POST /conversations/{id}/reply\`
  - \`/intercom/contacts/*.json\` (PUT) → \`PUT /contacts/{id}\`

### 5.6 \`pagerduty\`

- **Base URL**: \`https://api.pagerduty.com\`
- **Auth**: OAuth or REST API token (\`Authorization: Token token=...\`)
- **Pagination**: \`offset\` / \`limit\` (max 100); newer endpoints use \`cursor\`
- **Webhooks**: v3 subscriptions API (\`POST /webhook_subscriptions\`), signed with \`X-PagerDuty-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/pagerduty/services/{sid}/incidents/{iid}/metadata.json\`
  - \`/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json\`
- **Webhook events**: \`incident.triggered|acknowledged|resolved|annotated\`
- **Writeback globs**:
  - \`/pagerduty/.../incidents/*/notes.json\` → \`POST /incidents/{iid}/notes\`
  - \`/pagerduty/.../incidents/*/metadata.json\` (PUT) → \`PUT /incidents/{iid}\`

### 5.7 \`sentry\`

- **Base URL**: \`https://sentry.io/api/0\`
- **Auth**: OAuth or auth token (org-scoped)
- **Pagination**: \`Link\` header cursor (link-header strategy)
- **Webhooks**: per-integration; signed with \`Sentry-Hook-Signature\` (HMAC-SHA256 of body using integration client secret)
- **Path mapping**:
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json\`
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json\`
- **Webhook events**: \`issue.created|resolved|assigned\`, \`error.created\`
- **Writeback globs**:
  - \`/sentry/.../issues/*/metadata.json\` (PUT) → \`PUT /issues/{issueId}\`
  - \`/sentry/.../issues/*/comments.json\` → \`POST /issues/{issueId}/comments\`

### 5.8 \`stripe\`

- **Base URL**: \`https://api.stripe.com/v1\`
- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)
- **Pagination**: \`starting_after\` cursor (objects sortable by creation)
- **Webhooks**: signed with \`Stripe-Signature\` (timestamp + v1 HMAC-SHA256, anti-replay window)
- **Path mapping**:
  - \`/stripe/customers/{cid}.json\`
  - \`/stripe/customers/{cid}/subscriptions/{sid}.json\`
  - \`/stripe/charges/{chargeId}.json\`
- **Webhook events**: \`customer.*\`, \`invoice.*\`, \`charge.*\`, \`payment_intent.*\`
- **Writeback globs**:
  - \`/stripe/customers/*.json\` (PUT) → \`POST /customers/{cid}\` (form-encoded)
  - \`/stripe/customers/*/refund.json\` → \`POST /refunds\`

### 5.9 \`gmail\`

- **Base URL**: \`https://gmail.googleapis.com/gmail/v1\`
- **Auth**: OAuth 2.0 (scopes: \`gmail.readonly\` + \`gmail.send\` + \`gmail.modify\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`users.watch\` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream's Gmail trigger as ingest source)
- **Path mapping**:
  - \`/gmail/messages/{messageId}/metadata.json\`
  - \`/gmail/messages/{messageId}/raw.eml\`
  - \`/gmail/labels/{labelId}/messages/\` (virtual list)
- **Writeback globs**:
  - \`/gmail/messages/send.json\` → \`POST /users/me/messages/send\`
  - \`/gmail/messages/*/labels.json\` (PUT) → \`POST /users/me/messages/{id}/modify\`

### 5.10 \`google-calendar\`

- **Base URL**: \`https://www.googleapis.com/calendar/v3\`
- **Auth**: OAuth 2.0 (scope \`calendar.events\`)
- **Pagination**: \`pageToken\` (next-token); incremental sync via \`syncToken\`
- **Ingest**: \`events.watch\` push channels → webhook (channels expire ≤30d, need refresher)
- **Path mapping**:
  - \`/gcal/calendars/{calId}/events/{eventId}.json\`
- **Webhook events**: \`events.changed\` (Google sends a sync ping; adapter pulls delta)
- **Writeback globs**:
  - \`/gcal/calendars/*/events/*.json\` (PUT) → \`PUT /calendars/{calId}/events/{eventId}\`
  - \`/gcal/calendars/*/events/create.json\` → \`POST /calendars/{calId}/events\`

### 5.11 \`google-drive\`

- **Base URL**: \`https://www.googleapis.com/drive/v3\`
- **Auth**: OAuth 2.0 (scopes: \`drive\` or \`drive.file\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`changes.watch\` push channels (account-wide change feed)
- **Path mapping**:
  - \`/gdrive/files/{fileId}/metadata.json\`
  - \`/gdrive/files/{fileId}/content\` (binary, exported per mimeType)
- **Writeback globs**:
  - \`/gdrive/files/*/metadata.json\` (PUT) → \`PATCH /files/{fileId}\` (rename, move via \`addParents\`/\`removeParents\`)
  - \`/gdrive/files/upload.json\` → resumable upload \`POST /upload/drive/v3/files\`

### 5.12 \`slack\` *(existing — list for completeness; verify parity)*

- **Base URL**: \`https://slack.com/api\`
- **Auth**: OAuth 2.0 (bot + user scopes)
- **Pagination**: \`response_metadata.next_cursor\`
- **Ingest**: Events API webhook, signed with \`X-Slack-Signature\` (v0 HMAC-SHA256 + timestamp)
- **Already shipping** — confirm webhook signature and writeback globs match this spec.

### 5.13 \`linear\` *(existing)*

- GraphQL only. Confirm webhook subscriptions are configured during connection setup.

### 5.14 \`notion\` *(existing)*

- Notion shipped webhooks in 2025; mapping should add webhook entries for \`page.updated\`, \`database.updated\`, \`comment.created\`. Existing \`notion-ingest-handler\` in \`provider-nango\` should keep working as polling fallback.

### 5.15 \`s3\`

- **Base URL**: \`https://{bucket}.s3.{region}.amazonaws.com\`
- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials
- **Pagination**: \`ContinuationToken\` (cursor)
- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)
- **Path mapping**:
  - \`/s3/{bucket}/{key}\` (binary content)
  - \`/s3/{bucket}/{key}/metadata.json\` (object headers)
- **Writeback globs**:
  - \`/s3/{bucket}/*\` (PUT) → \`PUT /{bucket}/{key}\` (multipart for >5MB)

### 5.16 \`github\` *(existing)*

- Reference for everything. Don't change.

### 5.17 \`local-disk\` *(existing — primitive)*

- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by \`relayfile-mount\`.

## 6. Tier-2 spec sheets (compact)

For T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.

| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |
|---|---|---|---|---|
| \`salesforce\` | \`https://{instance}.my.salesforce.com/services/data/v60.0\` | next-record-url (link-style) | Streaming API / Platform Events sidecar | \`/sf/objects/Account/*.json\`, \`/sf/objects/Contact/*.json\` |
| \`zendesk\` | \`https://{sub}.zendesk.com/api/v2\` | cursor (\`after_cursor\`) | Webhooks resource (\`/webhooks\`) signed with \`X-Zendesk-Webhook-Signature\` | \`/zendesk/tickets/{id}/comments.json\` |
| \`confluence\` | \`https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2\` | \`cursor\` | Connect-app webhooks | \`/confluence/spaces/{key}/pages/{id}/body.json\` |
| \`bitbucket\` | \`https://api.bitbucket.org/2.0\` | \`next\` URL | Repository webhooks | \`/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json\` |
| \`vercel\` | \`https://api.vercel.com\` | \`next\` cursor | Deployment / log-drain webhooks | \`/vercel/projects/{id}/env/*.json\` |
| \`outlook-mail\` | \`https://graph.microsoft.com/v1.0/me\` | \`@odata.nextLink\` | Graph subscriptions | \`/outlook/messages/send.json\` |
| \`onedrive\` | \`https://graph.microsoft.com/v1.0/me/drive\` | \`@odata.nextLink\` | Graph subscriptions | \`/onedrive/items/{id}\` content + metadata |
| \`dropbox\` | \`https://api.dropboxapi.com/2\` | \`cursor\` | account webhook + \`files/list_folder/longpoll\` | \`/dropbox/files/{path}\` |
| \`box\` | \`https://api.box.com/2.0\` | \`marker\` | webhooks v2 (signed) | \`/box/files/{id}\`, \`/box/folders/{id}/items\` |
| \`posthog\` | \`https://app.posthog.com/api\` | \`next\` URL | action webhooks | \`/posthog/projects/{id}/insights/{iid}.json\` |
| \`datadog\` | \`https://api.datadoghq.com/api/v2\` | \`next_cursor\` | webhooks integration | \`/datadog/monitors/{id}.json\`, \`/datadog/incidents/{id}.json\` |
| \`gcs\` | \`https://storage.googleapis.com/storage/v1\` | \`pageToken\` | Pub/Sub object change notifications | \`/gcs/{bucket}/{object}\` |
| \`azure-blob\` | \`https://{account}.blob.core.windows.net\` | \`marker\` | Event Grid → relay | \`/azureblob/{container}/{blob}\` |
| \`r2\` | S3-compatible | continuation-token | bucket → queue → relay | \`/r2/{bucket}/{key}\` |
| \`supabase\` | \`https://{ref}.supabase.co\` | range header | already supported | reuse existing |
| \`clickup\` | \`https://api.clickup.com/api/v2\` | \`page\` | webhooks | \`/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json\` |
| \`trello\` | \`https://api.trello.com/1\` | none (list-based) | webhook callbacks | \`/trello/boards/{id}/cards/{cardId}.json\` |
| \`telegram\` | \`https://api.telegram.org/bot{token}\` | \`offset\` | \`setWebhook\` | \`/telegram/chats/{chatId}/messages/send.json\` |
| \`teams\` | Graph chats | \`@odata.nextLink\` | change notifications | already shipping; confirm |
| \`smtp-imap\` | \`imap://...\` / \`smtp://...\` | IMAP UID | IMAP IDLE sidecar | \`/email/inbox/{uid}.eml\`, \`/email/send.json\` |
| \`ssh\` | host:port | n/a | none | \`/ssh/{host}/...\` |

## 7. Tier-3 spec sheets (catalog-only)

Each T3 adapter ships:

- A mapping YAML pointing at the public OpenAPI spec (or hand-written \`samples\` if no OpenAPI exists).
- A read-only resource set generated by the schema adapter.
- A single placeholder writeback (\`/{adapter}/_unsupported.json\` returns 501) to keep the contract consistent.
- One smoke test fixture per object type.

Adapters: \`freshdesk\`, \`pipedrive\`, \`shortcut\`, \`coda\`, \`langfuse\`, \`sharepoint\`, \`google-slides\`, \`netlify\`, \`postgres\`, \`mongodb\`, \`semantic-scholar\`, \`arxiv\`.

For \`postgres\` and \`mongodb\`, the read surface is a synthetic VFS:

- \`/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json\` — generated by introspection
- \`/postgres/{db}/queries/{name}.sql\` (write) → executes prepared statement, results land at \`/postgres/{db}/queries/{name}.results.json\`
- \`mongodb\` analogous with collections + \`.find.json\` / \`.results.json\`

These are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage's Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.

## 8. Build plan (7 days)

| Day | Deliverable |
|---|---|
| **Mon** | Land scaffolding tooling: a \`pnpm gen:adapter <name>\` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a \`templates/<name>.hints.yaml\` for each row. |
| **Tue** | T1 batch A: \`jira\`, \`asana\`, \`hubspot\`, \`stripe\` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |
| **Wed** | T1 batch B: \`intercom\`, \`pagerduty\`, \`sentry\`, \`discord\` (4). |
| **Thu** | T1 batch C: \`gmail\`, \`google-calendar\`, \`google-drive\`, \`s3\` (4). Push-channel/EventBridge ingest stubs land here. |
| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |
| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |
| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a \`mirage-vs-relayfile.md\` row, and a smoke test in CI. Cut \`@relayfile/adapters@<launch>\` versions. |

Parallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever's free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.

## 9. Quality bar

Per-adapter checklist before a tag is cut:

- [ ] \`mapping.yaml\` validated by \`@relayfile/adapter-core\` parser (zero warnings).
- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.
- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).
- [ ] Pagination strategy declared and exercised by at least one fixture.
- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.
- [ ] One-line README + a row in \`docs/CATALOG.md\`.
- [ ] Provider compatibility matrix (which providers are tested for this adapter).

CI gate: a \`pnpm catalog:audit\` script asserts that the published catalog count ≥ Mirage's tracked count (manually maintained in \`docs/MIRAGE_PARITY.md\` and grepped from their docs weekly).

## 10. Open questions

1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.
2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?
3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.
4. **Database adapters** (\`postgres\`, \`mongodb\`, \`mysql\`): is \`query.json\` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?
5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?

## 11. References

- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)
- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from \`integrations/<name>/syncs/*.ts\`
- [\`docs/MAPPING_YAML_SPEC.md\`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into
- [\`docs/PATH_SLUGIFICATION_SPEC.md\`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow
- Provider package READMEs in \`relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}\`

Own only declared targets unless review feedback explicitly narrows a required fix:
- RAM/Disk/OPFS
- Nango/Pipedream/Composio
- /crm/v3/objects/contacts
- /users/me/messages/send
- /users/me/messages
- /upload/drive/v3/files

Acceptance gates:
- None declared

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Before editing, read .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/matched-skills.md when it exists and use it only as generation-time context for this task.

Keep execution routing explicit for local, cloud, and MCP callers. Materialize outputs to disk, then stop for deterministic gates.

Generated workflow quality:
- Include a real deterministic sanity gate over produced files, not just prose saying one exists.
- Prefer POSIX grep, git grep, or a small inline assertion command that exits non-zero when expected content/state is missing.
- If using rg, guard it with command -v rg and provide a grep or git grep fallback.
- For cleanup or deletion work, persist a changed-files inventory with statuses, active-reference evidence for deleted paths, and command summaries for final signoff.
- For cleanup or deletion work, start from .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/cleanup-candidate-prescan.txt and cite that exact path in .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/cleanup-report.md so the evidence trail names its prescan input.
- Keep each agent step bounded to one coherent slice. Split broad implementation or test-writing work into sequential/fan-out steps with deterministic gates between them instead of relying on a single long agent timeout.`,
    })

    .step("post-implementation-file-gate", {
      type: 'deterministic',
      dependsOn: ["implement-artifact"],
      command: "set -e; for anchor in 'RAM/Disk/OPFS' 'Nango/Pipedream/Composio' '/crm/v3/objects/contacts' '/users/me/messages/send' '/users/me/messages' '/upload/drive/v3/files'; do if ! grep -R -q -F \"$anchor\" docs/ scripts/ test/; then echo \"missing anchor: $anchor\"; exit 1; fi; done; for f in docs/CATALOG.md docs/MIRAGE_PARITY.md scripts/launch-catalog.mjs scripts/catalog-audit.mjs test/catalog-audit.test.mjs; do [ -s \"$f\" ] || { echo \"missing or empty: $f\"; exit 1; }; done; echo POST_IMPL_FILE_GATE_OK",
      captureOutput: true,
      failOnError: true,
    })

    .step("initial-soft-validation", {
      type: 'deterministic',
      dependsOn: ["post-implementation-file-gate"],
      command: "npm run catalog:audit && npm run test:catalog",
      captureOutput: true,
      failOnError: false,
    })

    .step("review-claude", {
      agent: "reviewer-claude",
      dependsOn: ["initial-soft-validation"],

      timeoutMs: 600000,
      task: `Review the generated work.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
# Launch Catalog Spec — Beat Mirage by Launch

Status: **draft v0** • Owner: relayfile-adapters • Target: launch +7d

## 1. Goal

Ship a catalog that is **visibly larger than [Mirage's 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn't have.

Hard targets:

- **≥ 50 catalog entries** at launch (vs Mirage's 32). Headline number on the site.
- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.
- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.
- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.
- Every Mirage-listed SaaS we don't already cover gets at least a Tier-3 entry, so no \`mirage-vs-relayfile\` matrix has a row where Mirage wins on coverage.

Non-goals for launch:

- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.
- Replacing Pipedream/Nango on the auth side — we're a thin schema layer over them.
- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single \`query.json\` writeback for now.

## 2. Strategy: leverage what Mirage doesn't have

Three multipliers we already have in-tree:

1. **Schema-driven generation** — \`@relayfile/adapter-core\` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**
2. **Provider matrix** — every adapter inherits OAuth from \`@relayfile/provider-{nango,pipedream,composio,clerk}\`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.
3. **Webhook + writeback primitives** — already in \`webhook-server\` + adapter \`writeback.ts\`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.

## 3. Tier definitions

| Tier | Read | Write | Ingest | Sig verify | Tests | Use case |
|---|---|---|---|---|---|---|
| **T1** | ✓ | ✓ | webhook | required | path-mapper + writeback + signature fixtures | Daily-driver action surface |
| **T2** | ✓ | ✓ | polling (cursor) | n/a | path-mapper + writeback fixtures | Webhook-less or write-rare APIs |
| **T3** | ✓ | optional | polling | n/a | OpenAPI parse + smoke fixture | Long-tail + reference data |

Promotion path: T3 → T2 once a write surface is justified by demand; T2 → T1 once webhooks land or polling becomes the bottleneck.

## 4. Catalog (52 entries)

Bold = ships at launch. *Italic* = exists today.

| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |
|---|---|---|---|---|---|
| **Local & primitives** ||||||
| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing \`relayfile-mount\` |
| 2 | **in-memory** | T1 | RAM | none | existing |
| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |
| **Object storage** ||||||
| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |
| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |
| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |
| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |
| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |
| **File storage SaaS** ||||||
| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + \`changes.watch\` push |
| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |
| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |
| **Microsoft 365** ||||||
| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph \`/me/messages\` + Graph subscriptions |
| 13 | **onedrive** | T2 | — | nango/pipedream | Graph \`/drives\` + subscriptions |
| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |
| **Google Workspace** ||||||
| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub \`users.watch\` |
| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + \`events.watch\` push |
| 17 | **google-docs** | T2 | Docs | nango/pipedream | Docs v1 (read), Drive change events for ingest |
| 18 | **google-sheets** | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |
| 19 | **google-slides** | T3 | Slides | nango/pipedream | Slides v1 |
| **Code & DevOps** ||||||
| 20 | *github* | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |
| 21 | *gitlab* | T1 | — | nango | REST v4 + webhooks |
| 22 | **bitbucket** | T2 | — | nango | Cloud REST 2.0 + webhooks |
| 23 | **vercel** | T2 | Vercel | nango | REST + deployment webhooks |
| 24 | **netlify** | T3 | — | nango | REST + outgoing webhooks |
| **Issue / Project** ||||||
| 25 | *linear* | T1 | Linear | nango/pipedream | GraphQL + webhooks |
| 26 | **jira** | T1 | — | nango/pipedream | REST v3 + webhooks |
| 27 | **asana** | T1 | — | nango/pipedream | REST + webhooks |
| 28 | **trello** | T2 | Trello | nango | REST + webhook callbacks |
| 29 | **clickup** | T2 | — | nango | API v2 + webhooks |
| 30 | **shortcut** | T3 | — | nango | REST v3 |
| **Docs / Notes** ||||||
| 31 | *notion* | T1 | Notion | nango (notion-ingest exists) | API + recently added webhooks |
| 32 | **confluence** | T2 | — | nango/pipedream | REST + webhooks (Atlassian Connect) |
| 33 | **coda** | T3 | — | nango | API v1 + webhooks |
| **Chat** ||||||
| 34 | *slack* | T1 | Slack | nango/pipedream | Web API + Events API |
| 35 | *teams* | T2 | — | nango/pipedream | Graph chats + change notifications |
| 36 | **discord** | T1 | Discord | nango | REST v10 + interaction webhooks |
| 37 | **telegram** | T2 | Telegram | nango | Bot API + webhook setWebhook |
| **CRM** ||||||
| 38 | **hubspot** | T1 | — | nango/pipedream | CRM v3 + webhooks v3 |
| 39 | **salesforce** | T2 | — | nango/pipedream | REST + Streaming/Platform Events |
| 40 | **pipedrive** | T3 | — | nango | API v2 + webhooks v1 |
| **Support** ||||||
| 41 | **intercom** | T1 | — | nango/pipedream | REST + webhook topics |
| 42 | **zendesk** | T2 | — | nango/pipedream | REST + webhooks/triggers |
| 43 | **freshdesk** | T3 | — | nango | REST + webhook automations |
| **Observability / incident** ||||||
| 44 | **sentry** | T1 | — | nango | REST + webhook integrations |
| 45 | **datadog** | T2 | — | nango | API v2 + webhooks integration |
| 46 | **posthog** | T2 | PostHog | nango | API + action webhooks |
| 47 | **pagerduty** | T1 | — | nango | REST + webhook subscriptions v3 |
| 48 | **langfuse** | T3 | Langfuse | direct PAT | OpenAPI |
| **DB / payments / email / research** ||||||
| 49 | **postgres** | T3 | Postgres | direct DSN | LISTEN/NOTIFY for ingest, query.json writeback |
| 50 | **mongodb** | T3 | MongoDB | direct DSN | change streams, query.json writeback |
| 51 | **stripe** | T1 | — | nango | REST + signed webhooks |
| 52 | **smtp-imap** | T2 | Email | direct creds | RFC 5321/3501 |
| 53 | **semantic-scholar** | T3 | Semantic Scholar | optional API key | Graph API v1 |
| 54 | **arxiv** | T3 | — | none | OAI-PMH / Atom feed |

**54 entries; 32 in Mirage.** Of those, **17 Tier-1 (incl. existing)**, **18 Tier-2**, **19 Tier-3**.

Mirage rows we deliberately *don't* match:
- **OPFS** — browser-only mount, covered conceptually by \`local-disk\` in our agent-side mount layer. Not a SaaS adapter.
- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.
- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.

If the marketing team wants 60+ headline number for splash, the "stretch row" candidates are: \`oci\`, \`webflow\`, \`airtable\`, \`mailchimp\`, \`shopify\`, \`quickbooks\` — all already have Nango templates and OpenAPI specs available.

## 5. Tier-1 adapter spec sheets

Compact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.

### 5.1 \`jira\`

- **Base URL**: \`https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3\`
- **Auth**: OAuth 2.0 (3LO), \`cloudid\` resolved via \`/oauth/token/accessible-resources\`
- **Pagination**: \`startAt\` / \`maxResults\` (offset, default 50, max 100); newer endpoints use \`nextPageToken\` (next-token)
- **Webhooks**: registered via Connect app or REST \`/rest/api/3/webhook\`; signature header \`X-Atlassian-Webhook-Identifier\`
- **Path mapping**:
  - \`/jira/projects/{projectKey}/issues/{issueKey}/metadata.json\`
  - \`/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json\`
- **Webhook events**: \`jira:issue_created|updated|deleted\`, \`comment_created|updated|deleted\`
- **Writeback globs**:
  - \`/jira/projects/*/issues/*/comments/*.json\` → \`POST /issue/{issueKey}/comment\`
  - \`/jira/projects/*/issues/*/transition.json\` → \`POST /issue/{issueKey}/transitions\`
  - \`/jira/projects/*/issues/*/metadata.json\` (PUT) → \`PUT /issue/{issueKey}\`
- **Nango template ref**: \`integrations/jira\`

### 5.2 \`asana\`

- **Base URL**: \`https://app.asana.com/api/1.0\`
- **Auth**: OAuth 2.0 or PAT
- **Pagination**: \`offset\` token in \`next_page.offset\`, \`limit\` 1–100
- **Webhooks**: \`POST /webhooks\` with \`target\` URL; handshake via \`X-Hook-Secret\` echo; subsequent deliveries signed with \`X-Hook-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json\`
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json\`
- **Webhook events**: \`task.{added|changed|deleted}\`, \`story.added\`
- **Writeback globs**:
  - \`/asana/.../tasks/*/stories/*.json\` → \`POST /tasks/{tid}/stories\`
  - \`/asana/.../tasks/*/metadata.json\` (PUT) → \`PUT /tasks/{tid}\`
- **Nango template ref**: \`integrations/asana\`

### 5.3 \`discord\`

- **Base URL**: \`https://discord.com/api/v10\`
- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads
- **Pagination**: \`before\` / \`after\` snowflake cursors
- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)
- **Signature verify**: Ed25519 over \`X-Signature-Ed25519\` + \`X-Signature-Timestamp\` (interactions). Channel webhooks aren't signed; rely on URL secrecy + IP allowlist.
- **Path mapping**:
  - \`/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json\`
  - \`/discord/guilds/{gid}/members/{uid}.json\`
- **Writeback globs**:
  - \`/discord/guilds/*/channels/*/messages/post.json\` → \`POST /channels/{cid}/messages\`
  - \`/discord/guilds/*/channels/*/messages/*.json\` (PUT) → \`PATCH /channels/{cid}/messages/{mid}\`

### 5.4 \`hubspot\`

- **Base URL**: \`https://api.hubapi.com\`
- **Auth**: OAuth 2.0 or private app token
- **Pagination**: \`paging.next.after\` cursor (\`limit\` ≤ 100)
- **Webhooks**: configured per-app in HubSpot dev portal; signed with \`X-HubSpot-Signature-v3\` (HMAC-SHA256 over method + URI + body + timestamp)
- **Path mapping**:
  - \`/hubspot/objects/contacts/{id}.json\`
  - \`/hubspot/objects/deals/{id}.json\`
  - \`/hubspot/objects/companies/{id}.json\`
- **Webhook events**: \`contact.creation|propertyChange|deletion\`, \`deal.*\`, \`company.*\`
- **Writeback globs**:
  - \`/hubspot/objects/contacts/*.json\` (PUT) → \`PATCH /crm/v3/objects/contacts/{id}\`
  - \`/hubspot/objects/contacts/create.json\` → \`POST /crm/v3/objects/contacts\`
- **Nango template ref**: \`integrations/hubspot\`

### 5.5 \`intercom\`

- **Base URL**: \`https://api.intercom.io\`
- **Auth**: OAuth or access token
- **Pagination**: \`pages.next.starting_after\` cursor (Conversations API)
- **Webhooks**: per-app subscriptions, signed with \`X-Hub-Signature\` (HMAC-SHA1 over body using app client secret)
- **Path mapping**:
  - \`/intercom/conversations/{id}/metadata.json\`
  - \`/intercom/conversations/{id}/parts/{partId}.json\`
  - \`/intercom/contacts/{id}.json\`
- **Webhook events**: \`conversation.user.created|replied\`, \`conversation.admin.replied|noted\`, \`contact.*\`
- **Writeback globs**:
  - \`/intercom/conversations/*/reply.json\` → \`POST /conversations/{id}/reply\`
  - \`/intercom/contacts/*.json\` (PUT) → \`PUT /contacts/{id}\`

### 5.6 \`pagerduty\`

- **Base URL**: \`https://api.pagerduty.com\`
- **Auth**: OAuth or REST API token (\`Authorization: Token token=...\`)
- **Pagination**: \`offset\` / \`limit\` (max 100); newer endpoints use \`cursor\`
- **Webhooks**: v3 subscriptions API (\`POST /webhook_subscriptions\`), signed with \`X-PagerDuty-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/pagerduty/services/{sid}/incidents/{iid}/metadata.json\`
  - \`/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json\`
- **Webhook events**: \`incident.triggered|acknowledged|resolved|annotated\`
- **Writeback globs**:
  - \`/pagerduty/.../incidents/*/notes.json\` → \`POST /incidents/{iid}/notes\`
  - \`/pagerduty/.../incidents/*/metadata.json\` (PUT) → \`PUT /incidents/{iid}\`

### 5.7 \`sentry\`

- **Base URL**: \`https://sentry.io/api/0\`
- **Auth**: OAuth or auth token (org-scoped)
- **Pagination**: \`Link\` header cursor (link-header strategy)
- **Webhooks**: per-integration; signed with \`Sentry-Hook-Signature\` (HMAC-SHA256 of body using integration client secret)
- **Path mapping**:
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json\`
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json\`
- **Webhook events**: \`issue.created|resolved|assigned\`, \`error.created\`
- **Writeback globs**:
  - \`/sentry/.../issues/*/metadata.json\` (PUT) → \`PUT /issues/{issueId}\`
  - \`/sentry/.../issues/*/comments.json\` → \`POST /issues/{issueId}/comments\`

### 5.8 \`stripe\`

- **Base URL**: \`https://api.stripe.com/v1\`
- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)
- **Pagination**: \`starting_after\` cursor (objects sortable by creation)
- **Webhooks**: signed with \`Stripe-Signature\` (timestamp + v1 HMAC-SHA256, anti-replay window)
- **Path mapping**:
  - \`/stripe/customers/{cid}.json\`
  - \`/stripe/customers/{cid}/subscriptions/{sid}.json\`
  - \`/stripe/charges/{chargeId}.json\`
- **Webhook events**: \`customer.*\`, \`invoice.*\`, \`charge.*\`, \`payment_intent.*\`
- **Writeback globs**:
  - \`/stripe/customers/*.json\` (PUT) → \`POST /customers/{cid}\` (form-encoded)
  - \`/stripe/customers/*/refund.json\` → \`POST /refunds\`

### 5.9 \`gmail\`

- **Base URL**: \`https://gmail.googleapis.com/gmail/v1\`
- **Auth**: OAuth 2.0 (scopes: \`gmail.readonly\` + \`gmail.send\` + \`gmail.modify\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`users.watch\` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream's Gmail trigger as ingest source)
- **Path mapping**:
  - \`/gmail/messages/{messageId}/metadata.json\`
  - \`/gmail/messages/{messageId}/raw.eml\`
  - \`/gmail/labels/{labelId}/messages/\` (virtual list)
- **Writeback globs**:
  - \`/gmail/messages/send.json\` → \`POST /users/me/messages/send\`
  - \`/gmail/messages/*/labels.json\` (PUT) → \`POST /users/me/messages/{id}/modify\`

### 5.10 \`google-calendar\`

- **Base URL**: \`https://www.googleapis.com/calendar/v3\`
- **Auth**: OAuth 2.0 (scope \`calendar.events\`)
- **Pagination**: \`pageToken\` (next-token); incremental sync via \`syncToken\`
- **Ingest**: \`events.watch\` push channels → webhook (channels expire ≤30d, need refresher)
- **Path mapping**:
  - \`/gcal/calendars/{calId}/events/{eventId}.json\`
- **Webhook events**: \`events.changed\` (Google sends a sync ping; adapter pulls delta)
- **Writeback globs**:
  - \`/gcal/calendars/*/events/*.json\` (PUT) → \`PUT /calendars/{calId}/events/{eventId}\`
  - \`/gcal/calendars/*/events/create.json\` → \`POST /calendars/{calId}/events\`

### 5.11 \`google-drive\`

- **Base URL**: \`https://www.googleapis.com/drive/v3\`
- **Auth**: OAuth 2.0 (scopes: \`drive\` or \`drive.file\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`changes.watch\` push channels (account-wide change feed)
- **Path mapping**:
  - \`/gdrive/files/{fileId}/metadata.json\`
  - \`/gdrive/files/{fileId}/content\` (binary, exported per mimeType)
- **Writeback globs**:
  - \`/gdrive/files/*/metadata.json\` (PUT) → \`PATCH /files/{fileId}\` (rename, move via \`addParents\`/\`removeParents\`)
  - \`/gdrive/files/upload.json\` → resumable upload \`POST /upload/drive/v3/files\`

### 5.12 \`slack\` *(existing — list for completeness; verify parity)*

- **Base URL**: \`https://slack.com/api\`
- **Auth**: OAuth 2.0 (bot + user scopes)
- **Pagination**: \`response_metadata.next_cursor\`
- **Ingest**: Events API webhook, signed with \`X-Slack-Signature\` (v0 HMAC-SHA256 + timestamp)
- **Already shipping** — confirm webhook signature and writeback globs match this spec.

### 5.13 \`linear\` *(existing)*

- GraphQL only. Confirm webhook subscriptions are configured during connection setup.

### 5.14 \`notion\` *(existing)*

- Notion shipped webhooks in 2025; mapping should add webhook entries for \`page.updated\`, \`database.updated\`, \`comment.created\`. Existing \`notion-ingest-handler\` in \`provider-nango\` should keep working as polling fallback.

### 5.15 \`s3\`

- **Base URL**: \`https://{bucket}.s3.{region}.amazonaws.com\`
- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials
- **Pagination**: \`ContinuationToken\` (cursor)
- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)
- **Path mapping**:
  - \`/s3/{bucket}/{key}\` (binary content)
  - \`/s3/{bucket}/{key}/metadata.json\` (object headers)
- **Writeback globs**:
  - \`/s3/{bucket}/*\` (PUT) → \`PUT /{bucket}/{key}\` (multipart for >5MB)

### 5.16 \`github\` *(existing)*

- Reference for everything. Don't change.

### 5.17 \`local-disk\` *(existing — primitive)*

- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by \`relayfile-mount\`.

## 6. Tier-2 spec sheets (compact)

For T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.

| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |
|---|---|---|---|---|
| \`salesforce\` | \`https://{instance}.my.salesforce.com/services/data/v60.0\` | next-record-url (link-style) | Streaming API / Platform Events sidecar | \`/sf/objects/Account/*.json\`, \`/sf/objects/Contact/*.json\` |
| \`zendesk\` | \`https://{sub}.zendesk.com/api/v2\` | cursor (\`after_cursor\`) | Webhooks resource (\`/webhooks\`) signed with \`X-Zendesk-Webhook-Signature\` | \`/zendesk/tickets/{id}/comments.json\` |
| \`confluence\` | \`https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2\` | \`cursor\` | Connect-app webhooks | \`/confluence/spaces/{key}/pages/{id}/body.json\` |
| \`bitbucket\` | \`https://api.bitbucket.org/2.0\` | \`next\` URL | Repository webhooks | \`/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json\` |
| \`vercel\` | \`https://api.vercel.com\` | \`next\` cursor | Deployment / log-drain webhooks | \`/vercel/projects/{id}/env/*.json\` |
| \`outlook-mail\` | \`https://graph.microsoft.com/v1.0/me\` | \`@odata.nextLink\` | Graph subscriptions | \`/outlook/messages/send.json\` |
| \`onedrive\` | \`https://graph.microsoft.com/v1.0/me/drive\` | \`@odata.nextLink\` | Graph subscriptions | \`/onedrive/items/{id}\` content + metadata |
| \`dropbox\` | \`https://api.dropboxapi.com/2\` | \`cursor\` | account webhook + \`files/list_folder/longpoll\` | \`/dropbox/files/{path}\` |
| \`box\` | \`https://api.box.com/2.0\` | \`marker\` | webhooks v2 (signed) | \`/box/files/{id}\`, \`/box/folders/{id}/items\` |
| \`posthog\` | \`https://app.posthog.com/api\` | \`next\` URL | action webhooks | \`/posthog/projects/{id}/insights/{iid}.json\` |
| \`datadog\` | \`https://api.datadoghq.com/api/v2\` | \`next_cursor\` | webhooks integration | \`/datadog/monitors/{id}.json\`, \`/datadog/incidents/{id}.json\` |
| \`gcs\` | \`https://storage.googleapis.com/storage/v1\` | \`pageToken\` | Pub/Sub object change notifications | \`/gcs/{bucket}/{object}\` |
| \`azure-blob\` | \`https://{account}.blob.core.windows.net\` | \`marker\` | Event Grid → relay | \`/azureblob/{container}/{blob}\` |
| \`r2\` | S3-compatible | continuation-token | bucket → queue → relay | \`/r2/{bucket}/{key}\` |
| \`supabase\` | \`https://{ref}.supabase.co\` | range header | already supported | reuse existing |
| \`clickup\` | \`https://api.clickup.com/api/v2\` | \`page\` | webhooks | \`/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json\` |
| \`trello\` | \`https://api.trello.com/1\` | none (list-based) | webhook callbacks | \`/trello/boards/{id}/cards/{cardId}.json\` |
| \`telegram\` | \`https://api.telegram.org/bot{token}\` | \`offset\` | \`setWebhook\` | \`/telegram/chats/{chatId}/messages/send.json\` |
| \`teams\` | Graph chats | \`@odata.nextLink\` | change notifications | already shipping; confirm |
| \`smtp-imap\` | \`imap://...\` / \`smtp://...\` | IMAP UID | IMAP IDLE sidecar | \`/email/inbox/{uid}.eml\`, \`/email/send.json\` |
| \`ssh\` | host:port | n/a | none | \`/ssh/{host}/...\` |

## 7. Tier-3 spec sheets (catalog-only)

Each T3 adapter ships:

- A mapping YAML pointing at the public OpenAPI spec (or hand-written \`samples\` if no OpenAPI exists).
- A read-only resource set generated by the schema adapter.
- A single placeholder writeback (\`/{adapter}/_unsupported.json\` returns 501) to keep the contract consistent.
- One smoke test fixture per object type.

Adapters: \`freshdesk\`, \`pipedrive\`, \`shortcut\`, \`coda\`, \`langfuse\`, \`sharepoint\`, \`google-slides\`, \`netlify\`, \`postgres\`, \`mongodb\`, \`semantic-scholar\`, \`arxiv\`.

For \`postgres\` and \`mongodb\`, the read surface is a synthetic VFS:

- \`/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json\` — generated by introspection
- \`/postgres/{db}/queries/{name}.sql\` (write) → executes prepared statement, results land at \`/postgres/{db}/queries/{name}.results.json\`
- \`mongodb\` analogous with collections + \`.find.json\` / \`.results.json\`

These are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage's Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.

## 8. Build plan (7 days)

| Day | Deliverable |
|---|---|
| **Mon** | Land scaffolding tooling: a \`pnpm gen:adapter <name>\` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a \`templates/<name>.hints.yaml\` for each row. |
| **Tue** | T1 batch A: \`jira\`, \`asana\`, \`hubspot\`, \`stripe\` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |
| **Wed** | T1 batch B: \`intercom\`, \`pagerduty\`, \`sentry\`, \`discord\` (4). |
| **Thu** | T1 batch C: \`gmail\`, \`google-calendar\`, \`google-drive\`, \`s3\` (4). Push-channel/EventBridge ingest stubs land here. |
| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |
| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |
| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a \`mirage-vs-relayfile.md\` row, and a smoke test in CI. Cut \`@relayfile/adapters@<launch>\` versions. |

Parallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever's free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.

## 9. Quality bar

Per-adapter checklist before a tag is cut:

- [ ] \`mapping.yaml\` validated by \`@relayfile/adapter-core\` parser (zero warnings).
- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.
- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).
- [ ] Pagination strategy declared and exercised by at least one fixture.
- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.
- [ ] One-line README + a row in \`docs/CATALOG.md\`.
- [ ] Provider compatibility matrix (which providers are tested for this adapter).

CI gate: a \`pnpm catalog:audit\` script asserts that the published catalog count ≥ Mirage's tracked count (manually maintained in \`docs/MIRAGE_PARITY.md\` and grepped from their docs weekly).

## 10. Open questions

1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.
2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?
3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.
4. **Database adapters** (\`postgres\`, \`mongodb\`, \`mysql\`): is \`query.json\` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?
5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?

## 11. References

- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)
- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from \`integrations/<name>/syncs/*.ts\`
- [\`docs/MAPPING_YAML_SPEC.md\`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into
- [\`docs/PATH_SLUGIFICATION_SPEC.md\`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow
- Provider package READMEs in \`relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}\`

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-claude.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-claude.md" },
    })

    .step("review-codex", {
      agent: "reviewer-codex",
      dependsOn: ["initial-soft-validation"],

      timeoutMs: 600000,
      task: `Review the generated work.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
# Launch Catalog Spec — Beat Mirage by Launch

Status: **draft v0** • Owner: relayfile-adapters • Target: launch +7d

## 1. Goal

Ship a catalog that is **visibly larger than [Mirage's 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn't have.

Hard targets:

- **≥ 50 catalog entries** at launch (vs Mirage's 32). Headline number on the site.
- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.
- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.
- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.
- Every Mirage-listed SaaS we don't already cover gets at least a Tier-3 entry, so no \`mirage-vs-relayfile\` matrix has a row where Mirage wins on coverage.

Non-goals for launch:

- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.
- Replacing Pipedream/Nango on the auth side — we're a thin schema layer over them.
- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single \`query.json\` writeback for now.

## 2. Strategy: leverage what Mirage doesn't have

Three multipliers we already have in-tree:

1. **Schema-driven generation** — \`@relayfile/adapter-core\` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**
2. **Provider matrix** — every adapter inherits OAuth from \`@relayfile/provider-{nango,pipedream,composio,clerk}\`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.
3. **Webhook + writeback primitives** — already in \`webhook-server\` + adapter \`writeback.ts\`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.

## 3. Tier definitions

| Tier | Read | Write | Ingest | Sig verify | Tests | Use case |
|---|---|---|---|---|---|---|
| **T1** | ✓ | ✓ | webhook | required | path-mapper + writeback + signature fixtures | Daily-driver action surface |
| **T2** | ✓ | ✓ | polling (cursor) | n/a | path-mapper + writeback fixtures | Webhook-less or write-rare APIs |
| **T3** | ✓ | optional | polling | n/a | OpenAPI parse + smoke fixture | Long-tail + reference data |

Promotion path: T3 → T2 once a write surface is justified by demand; T2 → T1 once webhooks land or polling becomes the bottleneck.

## 4. Catalog (52 entries)

Bold = ships at launch. *Italic* = exists today.

| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |
|---|---|---|---|---|---|
| **Local & primitives** ||||||
| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing \`relayfile-mount\` |
| 2 | **in-memory** | T1 | RAM | none | existing |
| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |
| **Object storage** ||||||
| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |
| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |
| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |
| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |
| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |
| **File storage SaaS** ||||||
| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + \`changes.watch\` push |
| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |
| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |
| **Microsoft 365** ||||||
| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph \`/me/messages\` + Graph subscriptions |
| 13 | **onedrive** | T2 | — | nango/pipedream | Graph \`/drives\` + subscriptions |
| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |
| **Google Workspace** ||||||
| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub \`users.watch\` |
| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + \`events.watch\` push |
| 17 | **google-docs** | T2 | Docs | nango/pipedream | Docs v1 (read), Drive change events for ingest |
| 18 | **google-sheets** | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |
| 19 | **google-slides** | T3 | Slides | nango/pipedream | Slides v1 |
| **Code & DevOps** ||||||
| 20 | *github* | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |
| 21 | *gitlab* | T1 | — | nango | REST v4 + webhooks |
| 22 | **bitbucket** | T2 | — | nango | Cloud REST 2.0 + webhooks |
| 23 | **vercel** | T2 | Vercel | nango | REST + deployment webhooks |
| 24 | **netlify** | T3 | — | nango | REST + outgoing webhooks |
| **Issue / Project** ||||||
| 25 | *linear* | T1 | Linear | nango/pipedream | GraphQL + webhooks |
| 26 | **jira** | T1 | — | nango/pipedream | REST v3 + webhooks |
| 27 | **asana** | T1 | — | nango/pipedream | REST + webhooks |
| 28 | **trello** | T2 | Trello | nango | REST + webhook callbacks |
| 29 | **clickup** | T2 | — | nango | API v2 + webhooks |
| 30 | **shortcut** | T3 | — | nango | REST v3 |
| **Docs / Notes** ||||||
| 31 | *notion* | T1 | Notion | nango (notion-ingest exists) | API + recently added webhooks |
| 32 | **confluence** | T2 | — | nango/pipedream | REST + webhooks (Atlassian Connect) |
| 33 | **coda** | T3 | — | nango | API v1 + webhooks |
| **Chat** ||||||
| 34 | *slack* | T1 | Slack | nango/pipedream | Web API + Events API |
| 35 | *teams* | T2 | — | nango/pipedream | Graph chats + change notifications |
| 36 | **discord** | T1 | Discord | nango | REST v10 + interaction webhooks |
| 37 | **telegram** | T2 | Telegram | nango | Bot API + webhook setWebhook |
| **CRM** ||||||
| 38 | **hubspot** | T1 | — | nango/pipedream | CRM v3 + webhooks v3 |
| 39 | **salesforce** | T2 | — | nango/pipedream | REST + Streaming/Platform Events |
| 40 | **pipedrive** | T3 | — | nango | API v2 + webhooks v1 |
| **Support** ||||||
| 41 | **intercom** | T1 | — | nango/pipedream | REST + webhook topics |
| 42 | **zendesk** | T2 | — | nango/pipedream | REST + webhooks/triggers |
| 43 | **freshdesk** | T3 | — | nango | REST + webhook automations |
| **Observability / incident** ||||||
| 44 | **sentry** | T1 | — | nango | REST + webhook integrations |
| 45 | **datadog** | T2 | — | nango | API v2 + webhooks integration |
| 46 | **posthog** | T2 | PostHog | nango | API + action webhooks |
| 47 | **pagerduty** | T1 | — | nango | REST + webhook subscriptions v3 |
| 48 | **langfuse** | T3 | Langfuse | direct PAT | OpenAPI |
| **DB / payments / email / research** ||||||
| 49 | **postgres** | T3 | Postgres | direct DSN | LISTEN/NOTIFY for ingest, query.json writeback |
| 50 | **mongodb** | T3 | MongoDB | direct DSN | change streams, query.json writeback |
| 51 | **stripe** | T1 | — | nango | REST + signed webhooks |
| 52 | **smtp-imap** | T2 | Email | direct creds | RFC 5321/3501 |
| 53 | **semantic-scholar** | T3 | Semantic Scholar | optional API key | Graph API v1 |
| 54 | **arxiv** | T3 | — | none | OAI-PMH / Atom feed |

**54 entries; 32 in Mirage.** Of those, **17 Tier-1 (incl. existing)**, **18 Tier-2**, **19 Tier-3**.

Mirage rows we deliberately *don't* match:
- **OPFS** — browser-only mount, covered conceptually by \`local-disk\` in our agent-side mount layer. Not a SaaS adapter.
- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.
- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.

If the marketing team wants 60+ headline number for splash, the "stretch row" candidates are: \`oci\`, \`webflow\`, \`airtable\`, \`mailchimp\`, \`shopify\`, \`quickbooks\` — all already have Nango templates and OpenAPI specs available.

## 5. Tier-1 adapter spec sheets

Compact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.

### 5.1 \`jira\`

- **Base URL**: \`https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3\`
- **Auth**: OAuth 2.0 (3LO), \`cloudid\` resolved via \`/oauth/token/accessible-resources\`
- **Pagination**: \`startAt\` / \`maxResults\` (offset, default 50, max 100); newer endpoints use \`nextPageToken\` (next-token)
- **Webhooks**: registered via Connect app or REST \`/rest/api/3/webhook\`; signature header \`X-Atlassian-Webhook-Identifier\`
- **Path mapping**:
  - \`/jira/projects/{projectKey}/issues/{issueKey}/metadata.json\`
  - \`/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json\`
- **Webhook events**: \`jira:issue_created|updated|deleted\`, \`comment_created|updated|deleted\`
- **Writeback globs**:
  - \`/jira/projects/*/issues/*/comments/*.json\` → \`POST /issue/{issueKey}/comment\`
  - \`/jira/projects/*/issues/*/transition.json\` → \`POST /issue/{issueKey}/transitions\`
  - \`/jira/projects/*/issues/*/metadata.json\` (PUT) → \`PUT /issue/{issueKey}\`
- **Nango template ref**: \`integrations/jira\`

### 5.2 \`asana\`

- **Base URL**: \`https://app.asana.com/api/1.0\`
- **Auth**: OAuth 2.0 or PAT
- **Pagination**: \`offset\` token in \`next_page.offset\`, \`limit\` 1–100
- **Webhooks**: \`POST /webhooks\` with \`target\` URL; handshake via \`X-Hook-Secret\` echo; subsequent deliveries signed with \`X-Hook-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json\`
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json\`
- **Webhook events**: \`task.{added|changed|deleted}\`, \`story.added\`
- **Writeback globs**:
  - \`/asana/.../tasks/*/stories/*.json\` → \`POST /tasks/{tid}/stories\`
  - \`/asana/.../tasks/*/metadata.json\` (PUT) → \`PUT /tasks/{tid}\`
- **Nango template ref**: \`integrations/asana\`

### 5.3 \`discord\`

- **Base URL**: \`https://discord.com/api/v10\`
- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads
- **Pagination**: \`before\` / \`after\` snowflake cursors
- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)
- **Signature verify**: Ed25519 over \`X-Signature-Ed25519\` + \`X-Signature-Timestamp\` (interactions). Channel webhooks aren't signed; rely on URL secrecy + IP allowlist.
- **Path mapping**:
  - \`/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json\`
  - \`/discord/guilds/{gid}/members/{uid}.json\`
- **Writeback globs**:
  - \`/discord/guilds/*/channels/*/messages/post.json\` → \`POST /channels/{cid}/messages\`
  - \`/discord/guilds/*/channels/*/messages/*.json\` (PUT) → \`PATCH /channels/{cid}/messages/{mid}\`

### 5.4 \`hubspot\`

- **Base URL**: \`https://api.hubapi.com\`
- **Auth**: OAuth 2.0 or private app token
- **Pagination**: \`paging.next.after\` cursor (\`limit\` ≤ 100)
- **Webhooks**: configured per-app in HubSpot dev portal; signed with \`X-HubSpot-Signature-v3\` (HMAC-SHA256 over method + URI + body + timestamp)
- **Path mapping**:
  - \`/hubspot/objects/contacts/{id}.json\`
  - \`/hubspot/objects/deals/{id}.json\`
  - \`/hubspot/objects/companies/{id}.json\`
- **Webhook events**: \`contact.creation|propertyChange|deletion\`, \`deal.*\`, \`company.*\`
- **Writeback globs**:
  - \`/hubspot/objects/contacts/*.json\` (PUT) → \`PATCH /crm/v3/objects/contacts/{id}\`
  - \`/hubspot/objects/contacts/create.json\` → \`POST /crm/v3/objects/contacts\`
- **Nango template ref**: \`integrations/hubspot\`

### 5.5 \`intercom\`

- **Base URL**: \`https://api.intercom.io\`
- **Auth**: OAuth or access token
- **Pagination**: \`pages.next.starting_after\` cursor (Conversations API)
- **Webhooks**: per-app subscriptions, signed with \`X-Hub-Signature\` (HMAC-SHA1 over body using app client secret)
- **Path mapping**:
  - \`/intercom/conversations/{id}/metadata.json\`
  - \`/intercom/conversations/{id}/parts/{partId}.json\`
  - \`/intercom/contacts/{id}.json\`
- **Webhook events**: \`conversation.user.created|replied\`, \`conversation.admin.replied|noted\`, \`contact.*\`
- **Writeback globs**:
  - \`/intercom/conversations/*/reply.json\` → \`POST /conversations/{id}/reply\`
  - \`/intercom/contacts/*.json\` (PUT) → \`PUT /contacts/{id}\`

### 5.6 \`pagerduty\`

- **Base URL**: \`https://api.pagerduty.com\`
- **Auth**: OAuth or REST API token (\`Authorization: Token token=...\`)
- **Pagination**: \`offset\` / \`limit\` (max 100); newer endpoints use \`cursor\`
- **Webhooks**: v3 subscriptions API (\`POST /webhook_subscriptions\`), signed with \`X-PagerDuty-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/pagerduty/services/{sid}/incidents/{iid}/metadata.json\`
  - \`/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json\`
- **Webhook events**: \`incident.triggered|acknowledged|resolved|annotated\`
- **Writeback globs**:
  - \`/pagerduty/.../incidents/*/notes.json\` → \`POST /incidents/{iid}/notes\`
  - \`/pagerduty/.../incidents/*/metadata.json\` (PUT) → \`PUT /incidents/{iid}\`

### 5.7 \`sentry\`

- **Base URL**: \`https://sentry.io/api/0\`
- **Auth**: OAuth or auth token (org-scoped)
- **Pagination**: \`Link\` header cursor (link-header strategy)
- **Webhooks**: per-integration; signed with \`Sentry-Hook-Signature\` (HMAC-SHA256 of body using integration client secret)
- **Path mapping**:
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json\`
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json\`
- **Webhook events**: \`issue.created|resolved|assigned\`, \`error.created\`
- **Writeback globs**:
  - \`/sentry/.../issues/*/metadata.json\` (PUT) → \`PUT /issues/{issueId}\`
  - \`/sentry/.../issues/*/comments.json\` → \`POST /issues/{issueId}/comments\`

### 5.8 \`stripe\`

- **Base URL**: \`https://api.stripe.com/v1\`
- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)
- **Pagination**: \`starting_after\` cursor (objects sortable by creation)
- **Webhooks**: signed with \`Stripe-Signature\` (timestamp + v1 HMAC-SHA256, anti-replay window)
- **Path mapping**:
  - \`/stripe/customers/{cid}.json\`
  - \`/stripe/customers/{cid}/subscriptions/{sid}.json\`
  - \`/stripe/charges/{chargeId}.json\`
- **Webhook events**: \`customer.*\`, \`invoice.*\`, \`charge.*\`, \`payment_intent.*\`
- **Writeback globs**:
  - \`/stripe/customers/*.json\` (PUT) → \`POST /customers/{cid}\` (form-encoded)
  - \`/stripe/customers/*/refund.json\` → \`POST /refunds\`

### 5.9 \`gmail\`

- **Base URL**: \`https://gmail.googleapis.com/gmail/v1\`
- **Auth**: OAuth 2.0 (scopes: \`gmail.readonly\` + \`gmail.send\` + \`gmail.modify\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`users.watch\` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream's Gmail trigger as ingest source)
- **Path mapping**:
  - \`/gmail/messages/{messageId}/metadata.json\`
  - \`/gmail/messages/{messageId}/raw.eml\`
  - \`/gmail/labels/{labelId}/messages/\` (virtual list)
- **Writeback globs**:
  - \`/gmail/messages/send.json\` → \`POST /users/me/messages/send\`
  - \`/gmail/messages/*/labels.json\` (PUT) → \`POST /users/me/messages/{id}/modify\`

### 5.10 \`google-calendar\`

- **Base URL**: \`https://www.googleapis.com/calendar/v3\`
- **Auth**: OAuth 2.0 (scope \`calendar.events\`)
- **Pagination**: \`pageToken\` (next-token); incremental sync via \`syncToken\`
- **Ingest**: \`events.watch\` push channels → webhook (channels expire ≤30d, need refresher)
- **Path mapping**:
  - \`/gcal/calendars/{calId}/events/{eventId}.json\`
- **Webhook events**: \`events.changed\` (Google sends a sync ping; adapter pulls delta)
- **Writeback globs**:
  - \`/gcal/calendars/*/events/*.json\` (PUT) → \`PUT /calendars/{calId}/events/{eventId}\`
  - \`/gcal/calendars/*/events/create.json\` → \`POST /calendars/{calId}/events\`

### 5.11 \`google-drive\`

- **Base URL**: \`https://www.googleapis.com/drive/v3\`
- **Auth**: OAuth 2.0 (scopes: \`drive\` or \`drive.file\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`changes.watch\` push channels (account-wide change feed)
- **Path mapping**:
  - \`/gdrive/files/{fileId}/metadata.json\`
  - \`/gdrive/files/{fileId}/content\` (binary, exported per mimeType)
- **Writeback globs**:
  - \`/gdrive/files/*/metadata.json\` (PUT) → \`PATCH /files/{fileId}\` (rename, move via \`addParents\`/\`removeParents\`)
  - \`/gdrive/files/upload.json\` → resumable upload \`POST /upload/drive/v3/files\`

### 5.12 \`slack\` *(existing — list for completeness; verify parity)*

- **Base URL**: \`https://slack.com/api\`
- **Auth**: OAuth 2.0 (bot + user scopes)
- **Pagination**: \`response_metadata.next_cursor\`
- **Ingest**: Events API webhook, signed with \`X-Slack-Signature\` (v0 HMAC-SHA256 + timestamp)
- **Already shipping** — confirm webhook signature and writeback globs match this spec.

### 5.13 \`linear\` *(existing)*

- GraphQL only. Confirm webhook subscriptions are configured during connection setup.

### 5.14 \`notion\` *(existing)*

- Notion shipped webhooks in 2025; mapping should add webhook entries for \`page.updated\`, \`database.updated\`, \`comment.created\`. Existing \`notion-ingest-handler\` in \`provider-nango\` should keep working as polling fallback.

### 5.15 \`s3\`

- **Base URL**: \`https://{bucket}.s3.{region}.amazonaws.com\`
- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials
- **Pagination**: \`ContinuationToken\` (cursor)
- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)
- **Path mapping**:
  - \`/s3/{bucket}/{key}\` (binary content)
  - \`/s3/{bucket}/{key}/metadata.json\` (object headers)
- **Writeback globs**:
  - \`/s3/{bucket}/*\` (PUT) → \`PUT /{bucket}/{key}\` (multipart for >5MB)

### 5.16 \`github\` *(existing)*

- Reference for everything. Don't change.

### 5.17 \`local-disk\` *(existing — primitive)*

- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by \`relayfile-mount\`.

## 6. Tier-2 spec sheets (compact)

For T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.

| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |
|---|---|---|---|---|
| \`salesforce\` | \`https://{instance}.my.salesforce.com/services/data/v60.0\` | next-record-url (link-style) | Streaming API / Platform Events sidecar | \`/sf/objects/Account/*.json\`, \`/sf/objects/Contact/*.json\` |
| \`zendesk\` | \`https://{sub}.zendesk.com/api/v2\` | cursor (\`after_cursor\`) | Webhooks resource (\`/webhooks\`) signed with \`X-Zendesk-Webhook-Signature\` | \`/zendesk/tickets/{id}/comments.json\` |
| \`confluence\` | \`https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2\` | \`cursor\` | Connect-app webhooks | \`/confluence/spaces/{key}/pages/{id}/body.json\` |
| \`bitbucket\` | \`https://api.bitbucket.org/2.0\` | \`next\` URL | Repository webhooks | \`/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json\` |
| \`vercel\` | \`https://api.vercel.com\` | \`next\` cursor | Deployment / log-drain webhooks | \`/vercel/projects/{id}/env/*.json\` |
| \`outlook-mail\` | \`https://graph.microsoft.com/v1.0/me\` | \`@odata.nextLink\` | Graph subscriptions | \`/outlook/messages/send.json\` |
| \`onedrive\` | \`https://graph.microsoft.com/v1.0/me/drive\` | \`@odata.nextLink\` | Graph subscriptions | \`/onedrive/items/{id}\` content + metadata |
| \`dropbox\` | \`https://api.dropboxapi.com/2\` | \`cursor\` | account webhook + \`files/list_folder/longpoll\` | \`/dropbox/files/{path}\` |
| \`box\` | \`https://api.box.com/2.0\` | \`marker\` | webhooks v2 (signed) | \`/box/files/{id}\`, \`/box/folders/{id}/items\` |
| \`posthog\` | \`https://app.posthog.com/api\` | \`next\` URL | action webhooks | \`/posthog/projects/{id}/insights/{iid}.json\` |
| \`datadog\` | \`https://api.datadoghq.com/api/v2\` | \`next_cursor\` | webhooks integration | \`/datadog/monitors/{id}.json\`, \`/datadog/incidents/{id}.json\` |
| \`gcs\` | \`https://storage.googleapis.com/storage/v1\` | \`pageToken\` | Pub/Sub object change notifications | \`/gcs/{bucket}/{object}\` |
| \`azure-blob\` | \`https://{account}.blob.core.windows.net\` | \`marker\` | Event Grid → relay | \`/azureblob/{container}/{blob}\` |
| \`r2\` | S3-compatible | continuation-token | bucket → queue → relay | \`/r2/{bucket}/{key}\` |
| \`supabase\` | \`https://{ref}.supabase.co\` | range header | already supported | reuse existing |
| \`clickup\` | \`https://api.clickup.com/api/v2\` | \`page\` | webhooks | \`/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json\` |
| \`trello\` | \`https://api.trello.com/1\` | none (list-based) | webhook callbacks | \`/trello/boards/{id}/cards/{cardId}.json\` |
| \`telegram\` | \`https://api.telegram.org/bot{token}\` | \`offset\` | \`setWebhook\` | \`/telegram/chats/{chatId}/messages/send.json\` |
| \`teams\` | Graph chats | \`@odata.nextLink\` | change notifications | already shipping; confirm |
| \`smtp-imap\` | \`imap://...\` / \`smtp://...\` | IMAP UID | IMAP IDLE sidecar | \`/email/inbox/{uid}.eml\`, \`/email/send.json\` |
| \`ssh\` | host:port | n/a | none | \`/ssh/{host}/...\` |

## 7. Tier-3 spec sheets (catalog-only)

Each T3 adapter ships:

- A mapping YAML pointing at the public OpenAPI spec (or hand-written \`samples\` if no OpenAPI exists).
- A read-only resource set generated by the schema adapter.
- A single placeholder writeback (\`/{adapter}/_unsupported.json\` returns 501) to keep the contract consistent.
- One smoke test fixture per object type.

Adapters: \`freshdesk\`, \`pipedrive\`, \`shortcut\`, \`coda\`, \`langfuse\`, \`sharepoint\`, \`google-slides\`, \`netlify\`, \`postgres\`, \`mongodb\`, \`semantic-scholar\`, \`arxiv\`.

For \`postgres\` and \`mongodb\`, the read surface is a synthetic VFS:

- \`/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json\` — generated by introspection
- \`/postgres/{db}/queries/{name}.sql\` (write) → executes prepared statement, results land at \`/postgres/{db}/queries/{name}.results.json\`
- \`mongodb\` analogous with collections + \`.find.json\` / \`.results.json\`

These are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage's Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.

## 8. Build plan (7 days)

| Day | Deliverable |
|---|---|
| **Mon** | Land scaffolding tooling: a \`pnpm gen:adapter <name>\` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a \`templates/<name>.hints.yaml\` for each row. |
| **Tue** | T1 batch A: \`jira\`, \`asana\`, \`hubspot\`, \`stripe\` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |
| **Wed** | T1 batch B: \`intercom\`, \`pagerduty\`, \`sentry\`, \`discord\` (4). |
| **Thu** | T1 batch C: \`gmail\`, \`google-calendar\`, \`google-drive\`, \`s3\` (4). Push-channel/EventBridge ingest stubs land here. |
| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |
| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |
| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a \`mirage-vs-relayfile.md\` row, and a smoke test in CI. Cut \`@relayfile/adapters@<launch>\` versions. |

Parallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever's free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.

## 9. Quality bar

Per-adapter checklist before a tag is cut:

- [ ] \`mapping.yaml\` validated by \`@relayfile/adapter-core\` parser (zero warnings).
- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.
- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).
- [ ] Pagination strategy declared and exercised by at least one fixture.
- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.
- [ ] One-line README + a row in \`docs/CATALOG.md\`.
- [ ] Provider compatibility matrix (which providers are tested for this adapter).

CI gate: a \`pnpm catalog:audit\` script asserts that the published catalog count ≥ Mirage's tracked count (manually maintained in \`docs/MIRAGE_PARITY.md\` and grepped from their docs weekly).

## 10. Open questions

1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.
2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?
3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.
4. **Database adapters** (\`postgres\`, \`mongodb\`, \`mysql\`): is \`query.json\` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?
5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?

## 11. References

- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)
- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from \`integrations/<name>/syncs/*.ts\`
- [\`docs/MAPPING_YAML_SPEC.md\`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into
- [\`docs/PATH_SLUGIFICATION_SPEC.md\`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow
- Provider package READMEs in \`relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}\`

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-codex.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-codex.md" },
    })

    .step("read-review-feedback", {
      type: 'deterministic',
      dependsOn: ["review-claude", "review-codex"],
      command: "test -f '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-claude.md' && test -f '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-codex.md' && grep -F 'REVIEW_COMPLETE' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-claude.md' && grep -F 'REVIEW_COMPLETE' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-codex.md' && cat '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-claude.md' '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-codex.md' | tee '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-feedback.md'",
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback', 'initial-soft-validation'],

      timeoutMs: 1200000,
      task: `Run the 80-to-100 fix loop.

Inputs:
- .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/review-feedback.md

Review feedback:
{{steps.read-review-feedback.output}}

Initial validation output:
{{steps.initial-soft-validation.output}}

Fix only concrete review or validation findings. Preserve the declared target boundary:
- RAM/Disk/OPFS
- Nango/Pipedream/Composio
- /crm/v3/objects/contacts
- /users/me/messages/send
- /users/me/messages
- /upload/drive/v3/files

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Before exiting, write .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/fix-loop-report.md summarizing the exact fixes you applied or explicitly saying that no repo changes were required, then end that file with FIX_LOOP_COMPLETE.
Re-run typecheck and tests before handing off to post-fix validation.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/fix-loop-report.md" },
    })

    .step("fix-loop-report-gate", {
      type: 'deterministic',
      dependsOn: ["fix-loop"],
      command: "test -f '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/fix-loop-report.md' && tail -n 1 '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/fix-loop-report.md' | tr -d '[:space:]' | grep -Eq '^FIX_LOOP_COMPLETE$'",
      captureOutput: true,
      failOnError: true,
    })

    .step("post-fix-verification-gate", {
      type: 'deterministic',
      dependsOn: ["fix-loop-report-gate"],
      command: "set -e; for anchor in 'RAM/Disk/OPFS' 'Nango/Pipedream/Composio' '/crm/v3/objects/contacts' '/users/me/messages/send' '/users/me/messages' '/upload/drive/v3/files'; do if ! grep -R -q -F \"$anchor\" docs/ scripts/ test/; then echo \"missing anchor: $anchor\"; exit 1; fi; done; for f in docs/CATALOG.md docs/MIRAGE_PARITY.md scripts/launch-catalog.mjs scripts/catalog-audit.mjs test/catalog-audit.test.mjs; do [ -s \"$f\" ] || { echo \"missing or empty: $f\"; exit 1; }; done; echo POST_FIX_VERIFICATION_GATE_OK",
      captureOutput: true,
      failOnError: true,
    })

    .step("catalog-audit-gate", {
      type: 'deterministic',
      dependsOn: ["post-fix-verification-gate"],
      command: "set -e; mkdir -p '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status'; node scripts/catalog-audit.mjs --json --write '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/catalog-audit-result.json' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/catalog-audit.stdout.json'; node -e \"const a=require('./.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/catalog-audit-result.json'); if(!a.ok){console.error('audit not ok:'+JSON.stringify(a.errors));process.exit(1)} if(a.summary.total<50){console.error('total<50: '+a.summary.total);process.exit(1)} if(a.summary.byTier.T1<16){console.error('T1<16: '+a.summary.byTier.T1);process.exit(1)} if(a.summary.byTier.T2<12){console.error('T2<12: '+a.summary.byTier.T2);process.exit(1)} if(a.summary.total<=a.summary.mirageTrackedCount){console.error('does not beat Mirage');process.exit(1)} const req=['RAM/Disk/OPFS','Nango/Pipedream/Composio','/crm/v3/objects/contacts','/users/me/messages/send','/users/me/messages','/upload/drive/v3/files']; for(const r of req){if(!a.requiredAnchors.includes(r)){console.error('missing anchor in audit: '+r);process.exit(1)}} console.log('CATALOG_AUDIT_GATE_OK total='+a.summary.total+' t1='+a.summary.byTier.T1+' t2='+a.summary.byTier.T2);\"",
      captureOutput: true,
      failOnError: true,
    })

    .step("active-reference-gate", {
      type: 'deterministic',
      dependsOn: ["catalog-audit-gate"],
      command: "printf '%s\\n' 'active-reference-gate: marker-only — no deleted manifest paths declared by lead-plan to verify.' > '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/active-reference-check.txt'; echo ACTIVE_REFERENCE_GATE_MARKER_OK",
      captureOutput: true,
      failOnError: true,
    })

    .step("post-fix-validation", {
      type: 'deterministic',
      dependsOn: ["active-reference-gate"],
      command: "npm run catalog:audit && npm run test:catalog",
      captureOutput: true,
      failOnError: false,
    })

    .step("final-review-claude", {
      agent: "reviewer-claude",
      dependsOn: ["post-fix-validation"],

      timeoutMs: 600000,
      task: `Re-review the fixed state only.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
# Launch Catalog Spec — Beat Mirage by Launch

Status: **draft v0** • Owner: relayfile-adapters • Target: launch +7d

## 1. Goal

Ship a catalog that is **visibly larger than [Mirage's 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn't have.

Hard targets:

- **≥ 50 catalog entries** at launch (vs Mirage's 32). Headline number on the site.
- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.
- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.
- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.
- Every Mirage-listed SaaS we don't already cover gets at least a Tier-3 entry, so no \`mirage-vs-relayfile\` matrix has a row where Mirage wins on coverage.

Non-goals for launch:

- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.
- Replacing Pipedream/Nango on the auth side — we're a thin schema layer over them.
- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single \`query.json\` writeback for now.

## 2. Strategy: leverage what Mirage doesn't have

Three multipliers we already have in-tree:

1. **Schema-driven generation** — \`@relayfile/adapter-core\` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**
2. **Provider matrix** — every adapter inherits OAuth from \`@relayfile/provider-{nango,pipedream,composio,clerk}\`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.
3. **Webhook + writeback primitives** — already in \`webhook-server\` + adapter \`writeback.ts\`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.

## 3. Tier definitions

| Tier | Read | Write | Ingest | Sig verify | Tests | Use case |
|---|---|---|---|---|---|---|
| **T1** | ✓ | ✓ | webhook | required | path-mapper + writeback + signature fixtures | Daily-driver action surface |
| **T2** | ✓ | ✓ | polling (cursor) | n/a | path-mapper + writeback fixtures | Webhook-less or write-rare APIs |
| **T3** | ✓ | optional | polling | n/a | OpenAPI parse + smoke fixture | Long-tail + reference data |

Promotion path: T3 → T2 once a write surface is justified by demand; T2 → T1 once webhooks land or polling becomes the bottleneck.

## 4. Catalog (52 entries)

Bold = ships at launch. *Italic* = exists today.

| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |
|---|---|---|---|---|---|
| **Local & primitives** ||||||
| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing \`relayfile-mount\` |
| 2 | **in-memory** | T1 | RAM | none | existing |
| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |
| **Object storage** ||||||
| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |
| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |
| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |
| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |
| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |
| **File storage SaaS** ||||||
| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + \`changes.watch\` push |
| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |
| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |
| **Microsoft 365** ||||||
| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph \`/me/messages\` + Graph subscriptions |
| 13 | **onedrive** | T2 | — | nango/pipedream | Graph \`/drives\` + subscriptions |
| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |
| **Google Workspace** ||||||
| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub \`users.watch\` |
| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + \`events.watch\` push |
| 17 | **google-docs** | T2 | Docs | nango/pipedream | Docs v1 (read), Drive change events for ingest |
| 18 | **google-sheets** | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |
| 19 | **google-slides** | T3 | Slides | nango/pipedream | Slides v1 |
| **Code & DevOps** ||||||
| 20 | *github* | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |
| 21 | *gitlab* | T1 | — | nango | REST v4 + webhooks |
| 22 | **bitbucket** | T2 | — | nango | Cloud REST 2.0 + webhooks |
| 23 | **vercel** | T2 | Vercel | nango | REST + deployment webhooks |
| 24 | **netlify** | T3 | — | nango | REST + outgoing webhooks |
| **Issue / Project** ||||||
| 25 | *linear* | T1 | Linear | nango/pipedream | GraphQL + webhooks |
| 26 | **jira** | T1 | — | nango/pipedream | REST v3 + webhooks |
| 27 | **asana** | T1 | — | nango/pipedream | REST + webhooks |
| 28 | **trello** | T2 | Trello | nango | REST + webhook callbacks |
| 29 | **clickup** | T2 | — | nango | API v2 + webhooks |
| 30 | **shortcut** | T3 | — | nango | REST v3 |
| **Docs / Notes** ||||||
| 31 | *notion* | T1 | Notion | nango (notion-ingest exists) | API + recently added webhooks |
| 32 | **confluence** | T2 | — | nango/pipedream | REST + webhooks (Atlassian Connect) |
| 33 | **coda** | T3 | — | nango | API v1 + webhooks |
| **Chat** ||||||
| 34 | *slack* | T1 | Slack | nango/pipedream | Web API + Events API |
| 35 | *teams* | T2 | — | nango/pipedream | Graph chats + change notifications |
| 36 | **discord** | T1 | Discord | nango | REST v10 + interaction webhooks |
| 37 | **telegram** | T2 | Telegram | nango | Bot API + webhook setWebhook |
| **CRM** ||||||
| 38 | **hubspot** | T1 | — | nango/pipedream | CRM v3 + webhooks v3 |
| 39 | **salesforce** | T2 | — | nango/pipedream | REST + Streaming/Platform Events |
| 40 | **pipedrive** | T3 | — | nango | API v2 + webhooks v1 |
| **Support** ||||||
| 41 | **intercom** | T1 | — | nango/pipedream | REST + webhook topics |
| 42 | **zendesk** | T2 | — | nango/pipedream | REST + webhooks/triggers |
| 43 | **freshdesk** | T3 | — | nango | REST + webhook automations |
| **Observability / incident** ||||||
| 44 | **sentry** | T1 | — | nango | REST + webhook integrations |
| 45 | **datadog** | T2 | — | nango | API v2 + webhooks integration |
| 46 | **posthog** | T2 | PostHog | nango | API + action webhooks |
| 47 | **pagerduty** | T1 | — | nango | REST + webhook subscriptions v3 |
| 48 | **langfuse** | T3 | Langfuse | direct PAT | OpenAPI |
| **DB / payments / email / research** ||||||
| 49 | **postgres** | T3 | Postgres | direct DSN | LISTEN/NOTIFY for ingest, query.json writeback |
| 50 | **mongodb** | T3 | MongoDB | direct DSN | change streams, query.json writeback |
| 51 | **stripe** | T1 | — | nango | REST + signed webhooks |
| 52 | **smtp-imap** | T2 | Email | direct creds | RFC 5321/3501 |
| 53 | **semantic-scholar** | T3 | Semantic Scholar | optional API key | Graph API v1 |
| 54 | **arxiv** | T3 | — | none | OAI-PMH / Atom feed |

**54 entries; 32 in Mirage.** Of those, **17 Tier-1 (incl. existing)**, **18 Tier-2**, **19 Tier-3**.

Mirage rows we deliberately *don't* match:
- **OPFS** — browser-only mount, covered conceptually by \`local-disk\` in our agent-side mount layer. Not a SaaS adapter.
- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.
- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.

If the marketing team wants 60+ headline number for splash, the "stretch row" candidates are: \`oci\`, \`webflow\`, \`airtable\`, \`mailchimp\`, \`shopify\`, \`quickbooks\` — all already have Nango templates and OpenAPI specs available.

## 5. Tier-1 adapter spec sheets

Compact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.

### 5.1 \`jira\`

- **Base URL**: \`https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3\`
- **Auth**: OAuth 2.0 (3LO), \`cloudid\` resolved via \`/oauth/token/accessible-resources\`
- **Pagination**: \`startAt\` / \`maxResults\` (offset, default 50, max 100); newer endpoints use \`nextPageToken\` (next-token)
- **Webhooks**: registered via Connect app or REST \`/rest/api/3/webhook\`; signature header \`X-Atlassian-Webhook-Identifier\`
- **Path mapping**:
  - \`/jira/projects/{projectKey}/issues/{issueKey}/metadata.json\`
  - \`/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json\`
- **Webhook events**: \`jira:issue_created|updated|deleted\`, \`comment_created|updated|deleted\`
- **Writeback globs**:
  - \`/jira/projects/*/issues/*/comments/*.json\` → \`POST /issue/{issueKey}/comment\`
  - \`/jira/projects/*/issues/*/transition.json\` → \`POST /issue/{issueKey}/transitions\`
  - \`/jira/projects/*/issues/*/metadata.json\` (PUT) → \`PUT /issue/{issueKey}\`
- **Nango template ref**: \`integrations/jira\`

### 5.2 \`asana\`

- **Base URL**: \`https://app.asana.com/api/1.0\`
- **Auth**: OAuth 2.0 or PAT
- **Pagination**: \`offset\` token in \`next_page.offset\`, \`limit\` 1–100
- **Webhooks**: \`POST /webhooks\` with \`target\` URL; handshake via \`X-Hook-Secret\` echo; subsequent deliveries signed with \`X-Hook-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json\`
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json\`
- **Webhook events**: \`task.{added|changed|deleted}\`, \`story.added\`
- **Writeback globs**:
  - \`/asana/.../tasks/*/stories/*.json\` → \`POST /tasks/{tid}/stories\`
  - \`/asana/.../tasks/*/metadata.json\` (PUT) → \`PUT /tasks/{tid}\`
- **Nango template ref**: \`integrations/asana\`

### 5.3 \`discord\`

- **Base URL**: \`https://discord.com/api/v10\`
- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads
- **Pagination**: \`before\` / \`after\` snowflake cursors
- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)
- **Signature verify**: Ed25519 over \`X-Signature-Ed25519\` + \`X-Signature-Timestamp\` (interactions). Channel webhooks aren't signed; rely on URL secrecy + IP allowlist.
- **Path mapping**:
  - \`/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json\`
  - \`/discord/guilds/{gid}/members/{uid}.json\`
- **Writeback globs**:
  - \`/discord/guilds/*/channels/*/messages/post.json\` → \`POST /channels/{cid}/messages\`
  - \`/discord/guilds/*/channels/*/messages/*.json\` (PUT) → \`PATCH /channels/{cid}/messages/{mid}\`

### 5.4 \`hubspot\`

- **Base URL**: \`https://api.hubapi.com\`
- **Auth**: OAuth 2.0 or private app token
- **Pagination**: \`paging.next.after\` cursor (\`limit\` ≤ 100)
- **Webhooks**: configured per-app in HubSpot dev portal; signed with \`X-HubSpot-Signature-v3\` (HMAC-SHA256 over method + URI + body + timestamp)
- **Path mapping**:
  - \`/hubspot/objects/contacts/{id}.json\`
  - \`/hubspot/objects/deals/{id}.json\`
  - \`/hubspot/objects/companies/{id}.json\`
- **Webhook events**: \`contact.creation|propertyChange|deletion\`, \`deal.*\`, \`company.*\`
- **Writeback globs**:
  - \`/hubspot/objects/contacts/*.json\` (PUT) → \`PATCH /crm/v3/objects/contacts/{id}\`
  - \`/hubspot/objects/contacts/create.json\` → \`POST /crm/v3/objects/contacts\`
- **Nango template ref**: \`integrations/hubspot\`

### 5.5 \`intercom\`

- **Base URL**: \`https://api.intercom.io\`
- **Auth**: OAuth or access token
- **Pagination**: \`pages.next.starting_after\` cursor (Conversations API)
- **Webhooks**: per-app subscriptions, signed with \`X-Hub-Signature\` (HMAC-SHA1 over body using app client secret)
- **Path mapping**:
  - \`/intercom/conversations/{id}/metadata.json\`
  - \`/intercom/conversations/{id}/parts/{partId}.json\`
  - \`/intercom/contacts/{id}.json\`
- **Webhook events**: \`conversation.user.created|replied\`, \`conversation.admin.replied|noted\`, \`contact.*\`
- **Writeback globs**:
  - \`/intercom/conversations/*/reply.json\` → \`POST /conversations/{id}/reply\`
  - \`/intercom/contacts/*.json\` (PUT) → \`PUT /contacts/{id}\`

### 5.6 \`pagerduty\`

- **Base URL**: \`https://api.pagerduty.com\`
- **Auth**: OAuth or REST API token (\`Authorization: Token token=...\`)
- **Pagination**: \`offset\` / \`limit\` (max 100); newer endpoints use \`cursor\`
- **Webhooks**: v3 subscriptions API (\`POST /webhook_subscriptions\`), signed with \`X-PagerDuty-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/pagerduty/services/{sid}/incidents/{iid}/metadata.json\`
  - \`/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json\`
- **Webhook events**: \`incident.triggered|acknowledged|resolved|annotated\`
- **Writeback globs**:
  - \`/pagerduty/.../incidents/*/notes.json\` → \`POST /incidents/{iid}/notes\`
  - \`/pagerduty/.../incidents/*/metadata.json\` (PUT) → \`PUT /incidents/{iid}\`

### 5.7 \`sentry\`

- **Base URL**: \`https://sentry.io/api/0\`
- **Auth**: OAuth or auth token (org-scoped)
- **Pagination**: \`Link\` header cursor (link-header strategy)
- **Webhooks**: per-integration; signed with \`Sentry-Hook-Signature\` (HMAC-SHA256 of body using integration client secret)
- **Path mapping**:
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json\`
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json\`
- **Webhook events**: \`issue.created|resolved|assigned\`, \`error.created\`
- **Writeback globs**:
  - \`/sentry/.../issues/*/metadata.json\` (PUT) → \`PUT /issues/{issueId}\`
  - \`/sentry/.../issues/*/comments.json\` → \`POST /issues/{issueId}/comments\`

### 5.8 \`stripe\`

- **Base URL**: \`https://api.stripe.com/v1\`
- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)
- **Pagination**: \`starting_after\` cursor (objects sortable by creation)
- **Webhooks**: signed with \`Stripe-Signature\` (timestamp + v1 HMAC-SHA256, anti-replay window)
- **Path mapping**:
  - \`/stripe/customers/{cid}.json\`
  - \`/stripe/customers/{cid}/subscriptions/{sid}.json\`
  - \`/stripe/charges/{chargeId}.json\`
- **Webhook events**: \`customer.*\`, \`invoice.*\`, \`charge.*\`, \`payment_intent.*\`
- **Writeback globs**:
  - \`/stripe/customers/*.json\` (PUT) → \`POST /customers/{cid}\` (form-encoded)
  - \`/stripe/customers/*/refund.json\` → \`POST /refunds\`

### 5.9 \`gmail\`

- **Base URL**: \`https://gmail.googleapis.com/gmail/v1\`
- **Auth**: OAuth 2.0 (scopes: \`gmail.readonly\` + \`gmail.send\` + \`gmail.modify\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`users.watch\` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream's Gmail trigger as ingest source)
- **Path mapping**:
  - \`/gmail/messages/{messageId}/metadata.json\`
  - \`/gmail/messages/{messageId}/raw.eml\`
  - \`/gmail/labels/{labelId}/messages/\` (virtual list)
- **Writeback globs**:
  - \`/gmail/messages/send.json\` → \`POST /users/me/messages/send\`
  - \`/gmail/messages/*/labels.json\` (PUT) → \`POST /users/me/messages/{id}/modify\`

### 5.10 \`google-calendar\`

- **Base URL**: \`https://www.googleapis.com/calendar/v3\`
- **Auth**: OAuth 2.0 (scope \`calendar.events\`)
- **Pagination**: \`pageToken\` (next-token); incremental sync via \`syncToken\`
- **Ingest**: \`events.watch\` push channels → webhook (channels expire ≤30d, need refresher)
- **Path mapping**:
  - \`/gcal/calendars/{calId}/events/{eventId}.json\`
- **Webhook events**: \`events.changed\` (Google sends a sync ping; adapter pulls delta)
- **Writeback globs**:
  - \`/gcal/calendars/*/events/*.json\` (PUT) → \`PUT /calendars/{calId}/events/{eventId}\`
  - \`/gcal/calendars/*/events/create.json\` → \`POST /calendars/{calId}/events\`

### 5.11 \`google-drive\`

- **Base URL**: \`https://www.googleapis.com/drive/v3\`
- **Auth**: OAuth 2.0 (scopes: \`drive\` or \`drive.file\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`changes.watch\` push channels (account-wide change feed)
- **Path mapping**:
  - \`/gdrive/files/{fileId}/metadata.json\`
  - \`/gdrive/files/{fileId}/content\` (binary, exported per mimeType)
- **Writeback globs**:
  - \`/gdrive/files/*/metadata.json\` (PUT) → \`PATCH /files/{fileId}\` (rename, move via \`addParents\`/\`removeParents\`)
  - \`/gdrive/files/upload.json\` → resumable upload \`POST /upload/drive/v3/files\`

### 5.12 \`slack\` *(existing — list for completeness; verify parity)*

- **Base URL**: \`https://slack.com/api\`
- **Auth**: OAuth 2.0 (bot + user scopes)
- **Pagination**: \`response_metadata.next_cursor\`
- **Ingest**: Events API webhook, signed with \`X-Slack-Signature\` (v0 HMAC-SHA256 + timestamp)
- **Already shipping** — confirm webhook signature and writeback globs match this spec.

### 5.13 \`linear\` *(existing)*

- GraphQL only. Confirm webhook subscriptions are configured during connection setup.

### 5.14 \`notion\` *(existing)*

- Notion shipped webhooks in 2025; mapping should add webhook entries for \`page.updated\`, \`database.updated\`, \`comment.created\`. Existing \`notion-ingest-handler\` in \`provider-nango\` should keep working as polling fallback.

### 5.15 \`s3\`

- **Base URL**: \`https://{bucket}.s3.{region}.amazonaws.com\`
- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials
- **Pagination**: \`ContinuationToken\` (cursor)
- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)
- **Path mapping**:
  - \`/s3/{bucket}/{key}\` (binary content)
  - \`/s3/{bucket}/{key}/metadata.json\` (object headers)
- **Writeback globs**:
  - \`/s3/{bucket}/*\` (PUT) → \`PUT /{bucket}/{key}\` (multipart for >5MB)

### 5.16 \`github\` *(existing)*

- Reference for everything. Don't change.

### 5.17 \`local-disk\` *(existing — primitive)*

- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by \`relayfile-mount\`.

## 6. Tier-2 spec sheets (compact)

For T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.

| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |
|---|---|---|---|---|
| \`salesforce\` | \`https://{instance}.my.salesforce.com/services/data/v60.0\` | next-record-url (link-style) | Streaming API / Platform Events sidecar | \`/sf/objects/Account/*.json\`, \`/sf/objects/Contact/*.json\` |
| \`zendesk\` | \`https://{sub}.zendesk.com/api/v2\` | cursor (\`after_cursor\`) | Webhooks resource (\`/webhooks\`) signed with \`X-Zendesk-Webhook-Signature\` | \`/zendesk/tickets/{id}/comments.json\` |
| \`confluence\` | \`https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2\` | \`cursor\` | Connect-app webhooks | \`/confluence/spaces/{key}/pages/{id}/body.json\` |
| \`bitbucket\` | \`https://api.bitbucket.org/2.0\` | \`next\` URL | Repository webhooks | \`/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json\` |
| \`vercel\` | \`https://api.vercel.com\` | \`next\` cursor | Deployment / log-drain webhooks | \`/vercel/projects/{id}/env/*.json\` |
| \`outlook-mail\` | \`https://graph.microsoft.com/v1.0/me\` | \`@odata.nextLink\` | Graph subscriptions | \`/outlook/messages/send.json\` |
| \`onedrive\` | \`https://graph.microsoft.com/v1.0/me/drive\` | \`@odata.nextLink\` | Graph subscriptions | \`/onedrive/items/{id}\` content + metadata |
| \`dropbox\` | \`https://api.dropboxapi.com/2\` | \`cursor\` | account webhook + \`files/list_folder/longpoll\` | \`/dropbox/files/{path}\` |
| \`box\` | \`https://api.box.com/2.0\` | \`marker\` | webhooks v2 (signed) | \`/box/files/{id}\`, \`/box/folders/{id}/items\` |
| \`posthog\` | \`https://app.posthog.com/api\` | \`next\` URL | action webhooks | \`/posthog/projects/{id}/insights/{iid}.json\` |
| \`datadog\` | \`https://api.datadoghq.com/api/v2\` | \`next_cursor\` | webhooks integration | \`/datadog/monitors/{id}.json\`, \`/datadog/incidents/{id}.json\` |
| \`gcs\` | \`https://storage.googleapis.com/storage/v1\` | \`pageToken\` | Pub/Sub object change notifications | \`/gcs/{bucket}/{object}\` |
| \`azure-blob\` | \`https://{account}.blob.core.windows.net\` | \`marker\` | Event Grid → relay | \`/azureblob/{container}/{blob}\` |
| \`r2\` | S3-compatible | continuation-token | bucket → queue → relay | \`/r2/{bucket}/{key}\` |
| \`supabase\` | \`https://{ref}.supabase.co\` | range header | already supported | reuse existing |
| \`clickup\` | \`https://api.clickup.com/api/v2\` | \`page\` | webhooks | \`/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json\` |
| \`trello\` | \`https://api.trello.com/1\` | none (list-based) | webhook callbacks | \`/trello/boards/{id}/cards/{cardId}.json\` |
| \`telegram\` | \`https://api.telegram.org/bot{token}\` | \`offset\` | \`setWebhook\` | \`/telegram/chats/{chatId}/messages/send.json\` |
| \`teams\` | Graph chats | \`@odata.nextLink\` | change notifications | already shipping; confirm |
| \`smtp-imap\` | \`imap://...\` / \`smtp://...\` | IMAP UID | IMAP IDLE sidecar | \`/email/inbox/{uid}.eml\`, \`/email/send.json\` |
| \`ssh\` | host:port | n/a | none | \`/ssh/{host}/...\` |

## 7. Tier-3 spec sheets (catalog-only)

Each T3 adapter ships:

- A mapping YAML pointing at the public OpenAPI spec (or hand-written \`samples\` if no OpenAPI exists).
- A read-only resource set generated by the schema adapter.
- A single placeholder writeback (\`/{adapter}/_unsupported.json\` returns 501) to keep the contract consistent.
- One smoke test fixture per object type.

Adapters: \`freshdesk\`, \`pipedrive\`, \`shortcut\`, \`coda\`, \`langfuse\`, \`sharepoint\`, \`google-slides\`, \`netlify\`, \`postgres\`, \`mongodb\`, \`semantic-scholar\`, \`arxiv\`.

For \`postgres\` and \`mongodb\`, the read surface is a synthetic VFS:

- \`/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json\` — generated by introspection
- \`/postgres/{db}/queries/{name}.sql\` (write) → executes prepared statement, results land at \`/postgres/{db}/queries/{name}.results.json\`
- \`mongodb\` analogous with collections + \`.find.json\` / \`.results.json\`

These are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage's Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.

## 8. Build plan (7 days)

| Day | Deliverable |
|---|---|
| **Mon** | Land scaffolding tooling: a \`pnpm gen:adapter <name>\` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a \`templates/<name>.hints.yaml\` for each row. |
| **Tue** | T1 batch A: \`jira\`, \`asana\`, \`hubspot\`, \`stripe\` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |
| **Wed** | T1 batch B: \`intercom\`, \`pagerduty\`, \`sentry\`, \`discord\` (4). |
| **Thu** | T1 batch C: \`gmail\`, \`google-calendar\`, \`google-drive\`, \`s3\` (4). Push-channel/EventBridge ingest stubs land here. |
| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |
| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |
| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a \`mirage-vs-relayfile.md\` row, and a smoke test in CI. Cut \`@relayfile/adapters@<launch>\` versions. |

Parallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever's free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.

## 9. Quality bar

Per-adapter checklist before a tag is cut:

- [ ] \`mapping.yaml\` validated by \`@relayfile/adapter-core\` parser (zero warnings).
- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.
- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).
- [ ] Pagination strategy declared and exercised by at least one fixture.
- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.
- [ ] One-line README + a row in \`docs/CATALOG.md\`.
- [ ] Provider compatibility matrix (which providers are tested for this adapter).

CI gate: a \`pnpm catalog:audit\` script asserts that the published catalog count ≥ Mirage's tracked count (manually maintained in \`docs/MIRAGE_PARITY.md\` and grepped from their docs weekly).

## 10. Open questions

1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.
2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?
3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.
4. **Database adapters** (\`postgres\`, \`mongodb\`, \`mysql\`): is \`query.json\` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?
5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?

## 11. References

- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)
- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from \`integrations/<name>/syncs/*.ts\`
- [\`docs/MAPPING_YAML_SPEC.md\`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into
- [\`docs/PATH_SLUGIFICATION_SPEC.md\`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow
- Provider package READMEs in \`relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}\`

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/final-review-claude.md" },
    })

    .step("final-review-codex", {
      agent: "reviewer-codex",
      dependsOn: ["post-fix-validation"],

      timeoutMs: 600000,
      task: `Re-review the fixed state only.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
# Launch Catalog Spec — Beat Mirage by Launch

Status: **draft v0** • Owner: relayfile-adapters • Target: launch +7d

## 1. Goal

Ship a catalog that is **visibly larger than [Mirage's 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn't have.

Hard targets:

- **≥ 50 catalog entries** at launch (vs Mirage's 32). Headline number on the site.
- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.
- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.
- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.
- Every Mirage-listed SaaS we don't already cover gets at least a Tier-3 entry, so no \`mirage-vs-relayfile\` matrix has a row where Mirage wins on coverage.

Non-goals for launch:

- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.
- Replacing Pipedream/Nango on the auth side — we're a thin schema layer over them.
- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single \`query.json\` writeback for now.

## 2. Strategy: leverage what Mirage doesn't have

Three multipliers we already have in-tree:

1. **Schema-driven generation** — \`@relayfile/adapter-core\` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**
2. **Provider matrix** — every adapter inherits OAuth from \`@relayfile/provider-{nango,pipedream,composio,clerk}\`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.
3. **Webhook + writeback primitives** — already in \`webhook-server\` + adapter \`writeback.ts\`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.

## 3. Tier definitions

| Tier | Read | Write | Ingest | Sig verify | Tests | Use case |
|---|---|---|---|---|---|---|
| **T1** | ✓ | ✓ | webhook | required | path-mapper + writeback + signature fixtures | Daily-driver action surface |
| **T2** | ✓ | ✓ | polling (cursor) | n/a | path-mapper + writeback fixtures | Webhook-less or write-rare APIs |
| **T3** | ✓ | optional | polling | n/a | OpenAPI parse + smoke fixture | Long-tail + reference data |

Promotion path: T3 → T2 once a write surface is justified by demand; T2 → T1 once webhooks land or polling becomes the bottleneck.

## 4. Catalog (52 entries)

Bold = ships at launch. *Italic* = exists today.

| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |
|---|---|---|---|---|---|
| **Local & primitives** ||||||
| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing \`relayfile-mount\` |
| 2 | **in-memory** | T1 | RAM | none | existing |
| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |
| **Object storage** ||||||
| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |
| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |
| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |
| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |
| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |
| **File storage SaaS** ||||||
| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + \`changes.watch\` push |
| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |
| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |
| **Microsoft 365** ||||||
| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph \`/me/messages\` + Graph subscriptions |
| 13 | **onedrive** | T2 | — | nango/pipedream | Graph \`/drives\` + subscriptions |
| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |
| **Google Workspace** ||||||
| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub \`users.watch\` |
| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + \`events.watch\` push |
| 17 | **google-docs** | T2 | Docs | nango/pipedream | Docs v1 (read), Drive change events for ingest |
| 18 | **google-sheets** | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |
| 19 | **google-slides** | T3 | Slides | nango/pipedream | Slides v1 |
| **Code & DevOps** ||||||
| 20 | *github* | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |
| 21 | *gitlab* | T1 | — | nango | REST v4 + webhooks |
| 22 | **bitbucket** | T2 | — | nango | Cloud REST 2.0 + webhooks |
| 23 | **vercel** | T2 | Vercel | nango | REST + deployment webhooks |
| 24 | **netlify** | T3 | — | nango | REST + outgoing webhooks |
| **Issue / Project** ||||||
| 25 | *linear* | T1 | Linear | nango/pipedream | GraphQL + webhooks |
| 26 | **jira** | T1 | — | nango/pipedream | REST v3 + webhooks |
| 27 | **asana** | T1 | — | nango/pipedream | REST + webhooks |
| 28 | **trello** | T2 | Trello | nango | REST + webhook callbacks |
| 29 | **clickup** | T2 | — | nango | API v2 + webhooks |
| 30 | **shortcut** | T3 | — | nango | REST v3 |
| **Docs / Notes** ||||||
| 31 | *notion* | T1 | Notion | nango (notion-ingest exists) | API + recently added webhooks |
| 32 | **confluence** | T2 | — | nango/pipedream | REST + webhooks (Atlassian Connect) |
| 33 | **coda** | T3 | — | nango | API v1 + webhooks |
| **Chat** ||||||
| 34 | *slack* | T1 | Slack | nango/pipedream | Web API + Events API |
| 35 | *teams* | T2 | — | nango/pipedream | Graph chats + change notifications |
| 36 | **discord** | T1 | Discord | nango | REST v10 + interaction webhooks |
| 37 | **telegram** | T2 | Telegram | nango | Bot API + webhook setWebhook |
| **CRM** ||||||
| 38 | **hubspot** | T1 | — | nango/pipedream | CRM v3 + webhooks v3 |
| 39 | **salesforce** | T2 | — | nango/pipedream | REST + Streaming/Platform Events |
| 40 | **pipedrive** | T3 | — | nango | API v2 + webhooks v1 |
| **Support** ||||||
| 41 | **intercom** | T1 | — | nango/pipedream | REST + webhook topics |
| 42 | **zendesk** | T2 | — | nango/pipedream | REST + webhooks/triggers |
| 43 | **freshdesk** | T3 | — | nango | REST + webhook automations |
| **Observability / incident** ||||||
| 44 | **sentry** | T1 | — | nango | REST + webhook integrations |
| 45 | **datadog** | T2 | — | nango | API v2 + webhooks integration |
| 46 | **posthog** | T2 | PostHog | nango | API + action webhooks |
| 47 | **pagerduty** | T1 | — | nango | REST + webhook subscriptions v3 |
| 48 | **langfuse** | T3 | Langfuse | direct PAT | OpenAPI |
| **DB / payments / email / research** ||||||
| 49 | **postgres** | T3 | Postgres | direct DSN | LISTEN/NOTIFY for ingest, query.json writeback |
| 50 | **mongodb** | T3 | MongoDB | direct DSN | change streams, query.json writeback |
| 51 | **stripe** | T1 | — | nango | REST + signed webhooks |
| 52 | **smtp-imap** | T2 | Email | direct creds | RFC 5321/3501 |
| 53 | **semantic-scholar** | T3 | Semantic Scholar | optional API key | Graph API v1 |
| 54 | **arxiv** | T3 | — | none | OAI-PMH / Atom feed |

**54 entries; 32 in Mirage.** Of those, **17 Tier-1 (incl. existing)**, **18 Tier-2**, **19 Tier-3**.

Mirage rows we deliberately *don't* match:
- **OPFS** — browser-only mount, covered conceptually by \`local-disk\` in our agent-side mount layer. Not a SaaS adapter.
- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.
- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.

If the marketing team wants 60+ headline number for splash, the "stretch row" candidates are: \`oci\`, \`webflow\`, \`airtable\`, \`mailchimp\`, \`shopify\`, \`quickbooks\` — all already have Nango templates and OpenAPI specs available.

## 5. Tier-1 adapter spec sheets

Compact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.

### 5.1 \`jira\`

- **Base URL**: \`https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3\`
- **Auth**: OAuth 2.0 (3LO), \`cloudid\` resolved via \`/oauth/token/accessible-resources\`
- **Pagination**: \`startAt\` / \`maxResults\` (offset, default 50, max 100); newer endpoints use \`nextPageToken\` (next-token)
- **Webhooks**: registered via Connect app or REST \`/rest/api/3/webhook\`; signature header \`X-Atlassian-Webhook-Identifier\`
- **Path mapping**:
  - \`/jira/projects/{projectKey}/issues/{issueKey}/metadata.json\`
  - \`/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json\`
- **Webhook events**: \`jira:issue_created|updated|deleted\`, \`comment_created|updated|deleted\`
- **Writeback globs**:
  - \`/jira/projects/*/issues/*/comments/*.json\` → \`POST /issue/{issueKey}/comment\`
  - \`/jira/projects/*/issues/*/transition.json\` → \`POST /issue/{issueKey}/transitions\`
  - \`/jira/projects/*/issues/*/metadata.json\` (PUT) → \`PUT /issue/{issueKey}\`
- **Nango template ref**: \`integrations/jira\`

### 5.2 \`asana\`

- **Base URL**: \`https://app.asana.com/api/1.0\`
- **Auth**: OAuth 2.0 or PAT
- **Pagination**: \`offset\` token in \`next_page.offset\`, \`limit\` 1–100
- **Webhooks**: \`POST /webhooks\` with \`target\` URL; handshake via \`X-Hook-Secret\` echo; subsequent deliveries signed with \`X-Hook-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json\`
  - \`/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json\`
- **Webhook events**: \`task.{added|changed|deleted}\`, \`story.added\`
- **Writeback globs**:
  - \`/asana/.../tasks/*/stories/*.json\` → \`POST /tasks/{tid}/stories\`
  - \`/asana/.../tasks/*/metadata.json\` (PUT) → \`PUT /tasks/{tid}\`
- **Nango template ref**: \`integrations/asana\`

### 5.3 \`discord\`

- **Base URL**: \`https://discord.com/api/v10\`
- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads
- **Pagination**: \`before\` / \`after\` snowflake cursors
- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)
- **Signature verify**: Ed25519 over \`X-Signature-Ed25519\` + \`X-Signature-Timestamp\` (interactions). Channel webhooks aren't signed; rely on URL secrecy + IP allowlist.
- **Path mapping**:
  - \`/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json\`
  - \`/discord/guilds/{gid}/members/{uid}.json\`
- **Writeback globs**:
  - \`/discord/guilds/*/channels/*/messages/post.json\` → \`POST /channels/{cid}/messages\`
  - \`/discord/guilds/*/channels/*/messages/*.json\` (PUT) → \`PATCH /channels/{cid}/messages/{mid}\`

### 5.4 \`hubspot\`

- **Base URL**: \`https://api.hubapi.com\`
- **Auth**: OAuth 2.0 or private app token
- **Pagination**: \`paging.next.after\` cursor (\`limit\` ≤ 100)
- **Webhooks**: configured per-app in HubSpot dev portal; signed with \`X-HubSpot-Signature-v3\` (HMAC-SHA256 over method + URI + body + timestamp)
- **Path mapping**:
  - \`/hubspot/objects/contacts/{id}.json\`
  - \`/hubspot/objects/deals/{id}.json\`
  - \`/hubspot/objects/companies/{id}.json\`
- **Webhook events**: \`contact.creation|propertyChange|deletion\`, \`deal.*\`, \`company.*\`
- **Writeback globs**:
  - \`/hubspot/objects/contacts/*.json\` (PUT) → \`PATCH /crm/v3/objects/contacts/{id}\`
  - \`/hubspot/objects/contacts/create.json\` → \`POST /crm/v3/objects/contacts\`
- **Nango template ref**: \`integrations/hubspot\`

### 5.5 \`intercom\`

- **Base URL**: \`https://api.intercom.io\`
- **Auth**: OAuth or access token
- **Pagination**: \`pages.next.starting_after\` cursor (Conversations API)
- **Webhooks**: per-app subscriptions, signed with \`X-Hub-Signature\` (HMAC-SHA1 over body using app client secret)
- **Path mapping**:
  - \`/intercom/conversations/{id}/metadata.json\`
  - \`/intercom/conversations/{id}/parts/{partId}.json\`
  - \`/intercom/contacts/{id}.json\`
- **Webhook events**: \`conversation.user.created|replied\`, \`conversation.admin.replied|noted\`, \`contact.*\`
- **Writeback globs**:
  - \`/intercom/conversations/*/reply.json\` → \`POST /conversations/{id}/reply\`
  - \`/intercom/contacts/*.json\` (PUT) → \`PUT /contacts/{id}\`

### 5.6 \`pagerduty\`

- **Base URL**: \`https://api.pagerduty.com\`
- **Auth**: OAuth or REST API token (\`Authorization: Token token=...\`)
- **Pagination**: \`offset\` / \`limit\` (max 100); newer endpoints use \`cursor\`
- **Webhooks**: v3 subscriptions API (\`POST /webhook_subscriptions\`), signed with \`X-PagerDuty-Signature\` (HMAC-SHA256)
- **Path mapping**:
  - \`/pagerduty/services/{sid}/incidents/{iid}/metadata.json\`
  - \`/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json\`
- **Webhook events**: \`incident.triggered|acknowledged|resolved|annotated\`
- **Writeback globs**:
  - \`/pagerduty/.../incidents/*/notes.json\` → \`POST /incidents/{iid}/notes\`
  - \`/pagerduty/.../incidents/*/metadata.json\` (PUT) → \`PUT /incidents/{iid}\`

### 5.7 \`sentry\`

- **Base URL**: \`https://sentry.io/api/0\`
- **Auth**: OAuth or auth token (org-scoped)
- **Pagination**: \`Link\` header cursor (link-header strategy)
- **Webhooks**: per-integration; signed with \`Sentry-Hook-Signature\` (HMAC-SHA256 of body using integration client secret)
- **Path mapping**:
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json\`
  - \`/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json\`
- **Webhook events**: \`issue.created|resolved|assigned\`, \`error.created\`
- **Writeback globs**:
  - \`/sentry/.../issues/*/metadata.json\` (PUT) → \`PUT /issues/{issueId}\`
  - \`/sentry/.../issues/*/comments.json\` → \`POST /issues/{issueId}/comments\`

### 5.8 \`stripe\`

- **Base URL**: \`https://api.stripe.com/v1\`
- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)
- **Pagination**: \`starting_after\` cursor (objects sortable by creation)
- **Webhooks**: signed with \`Stripe-Signature\` (timestamp + v1 HMAC-SHA256, anti-replay window)
- **Path mapping**:
  - \`/stripe/customers/{cid}.json\`
  - \`/stripe/customers/{cid}/subscriptions/{sid}.json\`
  - \`/stripe/charges/{chargeId}.json\`
- **Webhook events**: \`customer.*\`, \`invoice.*\`, \`charge.*\`, \`payment_intent.*\`
- **Writeback globs**:
  - \`/stripe/customers/*.json\` (PUT) → \`POST /customers/{cid}\` (form-encoded)
  - \`/stripe/customers/*/refund.json\` → \`POST /refunds\`

### 5.9 \`gmail\`

- **Base URL**: \`https://gmail.googleapis.com/gmail/v1\`
- **Auth**: OAuth 2.0 (scopes: \`gmail.readonly\` + \`gmail.send\` + \`gmail.modify\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`users.watch\` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream's Gmail trigger as ingest source)
- **Path mapping**:
  - \`/gmail/messages/{messageId}/metadata.json\`
  - \`/gmail/messages/{messageId}/raw.eml\`
  - \`/gmail/labels/{labelId}/messages/\` (virtual list)
- **Writeback globs**:
  - \`/gmail/messages/send.json\` → \`POST /users/me/messages/send\`
  - \`/gmail/messages/*/labels.json\` (PUT) → \`POST /users/me/messages/{id}/modify\`

### 5.10 \`google-calendar\`

- **Base URL**: \`https://www.googleapis.com/calendar/v3\`
- **Auth**: OAuth 2.0 (scope \`calendar.events\`)
- **Pagination**: \`pageToken\` (next-token); incremental sync via \`syncToken\`
- **Ingest**: \`events.watch\` push channels → webhook (channels expire ≤30d, need refresher)
- **Path mapping**:
  - \`/gcal/calendars/{calId}/events/{eventId}.json\`
- **Webhook events**: \`events.changed\` (Google sends a sync ping; adapter pulls delta)
- **Writeback globs**:
  - \`/gcal/calendars/*/events/*.json\` (PUT) → \`PUT /calendars/{calId}/events/{eventId}\`
  - \`/gcal/calendars/*/events/create.json\` → \`POST /calendars/{calId}/events\`

### 5.11 \`google-drive\`

- **Base URL**: \`https://www.googleapis.com/drive/v3\`
- **Auth**: OAuth 2.0 (scopes: \`drive\` or \`drive.file\`)
- **Pagination**: \`pageToken\` (next-token)
- **Ingest**: \`changes.watch\` push channels (account-wide change feed)
- **Path mapping**:
  - \`/gdrive/files/{fileId}/metadata.json\`
  - \`/gdrive/files/{fileId}/content\` (binary, exported per mimeType)
- **Writeback globs**:
  - \`/gdrive/files/*/metadata.json\` (PUT) → \`PATCH /files/{fileId}\` (rename, move via \`addParents\`/\`removeParents\`)
  - \`/gdrive/files/upload.json\` → resumable upload \`POST /upload/drive/v3/files\`

### 5.12 \`slack\` *(existing — list for completeness; verify parity)*

- **Base URL**: \`https://slack.com/api\`
- **Auth**: OAuth 2.0 (bot + user scopes)
- **Pagination**: \`response_metadata.next_cursor\`
- **Ingest**: Events API webhook, signed with \`X-Slack-Signature\` (v0 HMAC-SHA256 + timestamp)
- **Already shipping** — confirm webhook signature and writeback globs match this spec.

### 5.13 \`linear\` *(existing)*

- GraphQL only. Confirm webhook subscriptions are configured during connection setup.

### 5.14 \`notion\` *(existing)*

- Notion shipped webhooks in 2025; mapping should add webhook entries for \`page.updated\`, \`database.updated\`, \`comment.created\`. Existing \`notion-ingest-handler\` in \`provider-nango\` should keep working as polling fallback.

### 5.15 \`s3\`

- **Base URL**: \`https://{bucket}.s3.{region}.amazonaws.com\`
- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials
- **Pagination**: \`ContinuationToken\` (cursor)
- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)
- **Path mapping**:
  - \`/s3/{bucket}/{key}\` (binary content)
  - \`/s3/{bucket}/{key}/metadata.json\` (object headers)
- **Writeback globs**:
  - \`/s3/{bucket}/*\` (PUT) → \`PUT /{bucket}/{key}\` (multipart for >5MB)

### 5.16 \`github\` *(existing)*

- Reference for everything. Don't change.

### 5.17 \`local-disk\` *(existing — primitive)*

- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by \`relayfile-mount\`.

## 6. Tier-2 spec sheets (compact)

For T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.

| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |
|---|---|---|---|---|
| \`salesforce\` | \`https://{instance}.my.salesforce.com/services/data/v60.0\` | next-record-url (link-style) | Streaming API / Platform Events sidecar | \`/sf/objects/Account/*.json\`, \`/sf/objects/Contact/*.json\` |
| \`zendesk\` | \`https://{sub}.zendesk.com/api/v2\` | cursor (\`after_cursor\`) | Webhooks resource (\`/webhooks\`) signed with \`X-Zendesk-Webhook-Signature\` | \`/zendesk/tickets/{id}/comments.json\` |
| \`confluence\` | \`https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2\` | \`cursor\` | Connect-app webhooks | \`/confluence/spaces/{key}/pages/{id}/body.json\` |
| \`bitbucket\` | \`https://api.bitbucket.org/2.0\` | \`next\` URL | Repository webhooks | \`/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json\` |
| \`vercel\` | \`https://api.vercel.com\` | \`next\` cursor | Deployment / log-drain webhooks | \`/vercel/projects/{id}/env/*.json\` |
| \`outlook-mail\` | \`https://graph.microsoft.com/v1.0/me\` | \`@odata.nextLink\` | Graph subscriptions | \`/outlook/messages/send.json\` |
| \`onedrive\` | \`https://graph.microsoft.com/v1.0/me/drive\` | \`@odata.nextLink\` | Graph subscriptions | \`/onedrive/items/{id}\` content + metadata |
| \`dropbox\` | \`https://api.dropboxapi.com/2\` | \`cursor\` | account webhook + \`files/list_folder/longpoll\` | \`/dropbox/files/{path}\` |
| \`box\` | \`https://api.box.com/2.0\` | \`marker\` | webhooks v2 (signed) | \`/box/files/{id}\`, \`/box/folders/{id}/items\` |
| \`posthog\` | \`https://app.posthog.com/api\` | \`next\` URL | action webhooks | \`/posthog/projects/{id}/insights/{iid}.json\` |
| \`datadog\` | \`https://api.datadoghq.com/api/v2\` | \`next_cursor\` | webhooks integration | \`/datadog/monitors/{id}.json\`, \`/datadog/incidents/{id}.json\` |
| \`gcs\` | \`https://storage.googleapis.com/storage/v1\` | \`pageToken\` | Pub/Sub object change notifications | \`/gcs/{bucket}/{object}\` |
| \`azure-blob\` | \`https://{account}.blob.core.windows.net\` | \`marker\` | Event Grid → relay | \`/azureblob/{container}/{blob}\` |
| \`r2\` | S3-compatible | continuation-token | bucket → queue → relay | \`/r2/{bucket}/{key}\` |
| \`supabase\` | \`https://{ref}.supabase.co\` | range header | already supported | reuse existing |
| \`clickup\` | \`https://api.clickup.com/api/v2\` | \`page\` | webhooks | \`/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json\` |
| \`trello\` | \`https://api.trello.com/1\` | none (list-based) | webhook callbacks | \`/trello/boards/{id}/cards/{cardId}.json\` |
| \`telegram\` | \`https://api.telegram.org/bot{token}\` | \`offset\` | \`setWebhook\` | \`/telegram/chats/{chatId}/messages/send.json\` |
| \`teams\` | Graph chats | \`@odata.nextLink\` | change notifications | already shipping; confirm |
| \`smtp-imap\` | \`imap://...\` / \`smtp://...\` | IMAP UID | IMAP IDLE sidecar | \`/email/inbox/{uid}.eml\`, \`/email/send.json\` |
| \`ssh\` | host:port | n/a | none | \`/ssh/{host}/...\` |

## 7. Tier-3 spec sheets (catalog-only)

Each T3 adapter ships:

- A mapping YAML pointing at the public OpenAPI spec (or hand-written \`samples\` if no OpenAPI exists).
- A read-only resource set generated by the schema adapter.
- A single placeholder writeback (\`/{adapter}/_unsupported.json\` returns 501) to keep the contract consistent.
- One smoke test fixture per object type.

Adapters: \`freshdesk\`, \`pipedrive\`, \`shortcut\`, \`coda\`, \`langfuse\`, \`sharepoint\`, \`google-slides\`, \`netlify\`, \`postgres\`, \`mongodb\`, \`semantic-scholar\`, \`arxiv\`.

For \`postgres\` and \`mongodb\`, the read surface is a synthetic VFS:

- \`/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json\` — generated by introspection
- \`/postgres/{db}/queries/{name}.sql\` (write) → executes prepared statement, results land at \`/postgres/{db}/queries/{name}.results.json\`
- \`mongodb\` analogous with collections + \`.find.json\` / \`.results.json\`

These are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage's Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.

## 8. Build plan (7 days)

| Day | Deliverable |
|---|---|
| **Mon** | Land scaffolding tooling: a \`pnpm gen:adapter <name>\` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a \`templates/<name>.hints.yaml\` for each row. |
| **Tue** | T1 batch A: \`jira\`, \`asana\`, \`hubspot\`, \`stripe\` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |
| **Wed** | T1 batch B: \`intercom\`, \`pagerduty\`, \`sentry\`, \`discord\` (4). |
| **Thu** | T1 batch C: \`gmail\`, \`google-calendar\`, \`google-drive\`, \`s3\` (4). Push-channel/EventBridge ingest stubs land here. |
| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |
| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |
| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a \`mirage-vs-relayfile.md\` row, and a smoke test in CI. Cut \`@relayfile/adapters@<launch>\` versions. |

Parallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever's free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.

## 9. Quality bar

Per-adapter checklist before a tag is cut:

- [ ] \`mapping.yaml\` validated by \`@relayfile/adapter-core\` parser (zero warnings).
- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.
- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).
- [ ] Pagination strategy declared and exercised by at least one fixture.
- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.
- [ ] One-line README + a row in \`docs/CATALOG.md\`.
- [ ] Provider compatibility matrix (which providers are tested for this adapter).

CI gate: a \`pnpm catalog:audit\` script asserts that the published catalog count ≥ Mirage's tracked count (manually maintained in \`docs/MIRAGE_PARITY.md\` and grepped from their docs weekly).

## 10. Open questions

1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.
2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?
3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.
4. **Database adapters** (\`postgres\`, \`mongodb\`, \`mysql\`): is \`query.json\` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?
5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?

## 11. References

- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)
- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from \`integrations/<name>/syncs/*.ts\`
- [\`docs/MAPPING_YAML_SPEC.md\`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into
- [\`docs/PATH_SLUGIFICATION_SPEC.md\`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow
- Provider package READMEs in \`relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}\`

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/final-review-codex.md" },
    })

    .step("final-review-pass-gate", {
      type: 'deterministic',
      dependsOn: ["final-review-claude", "final-review-codex"],
      command: "tail -n 1 '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/final-review-claude.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CLAUDE_PASS$' && tail -n 1 '.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/final-review-codex.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CODEX_PASS$'",
      captureOutput: true,
      failOnError: true,
    })

    .step("final-hard-validation", {
      type: 'deterministic',
      dependsOn: ["final-review-pass-gate"],
      command: "npm run catalog:audit && npm run test:catalog",
      captureOutput: true,
      failOnError: true,
    })

    .step("git-diff-gate", {
      type: 'deterministic',
      dependsOn: ["final-hard-validation"],
      command: "set -e; ART_DIR='.workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status'; mkdir -p \"$ART_DIR\"; { git status --porcelain -- 'docs/' 'scripts/' 'test/' 'workflows/'; git ls-files --others --exclude-standard -- 'docs/' 'scripts/' 'test/' 'workflows/'; } > \"$ART_DIR/git-diff.txt\"; if [ ! -s \"$ART_DIR/git-diff.txt\" ]; then echo 'git-diff-gate: no changed/new files under declared target dirs (docs, scripts, test, workflows)'; exit 1; fi; for anchor in 'RAM/Disk/OPFS' 'Nango/Pipedream/Composio' '/crm/v3/objects/contacts' '/users/me/messages/send' '/users/me/messages' '/upload/drive/v3/files'; do if ! grep -R -q -F \"$anchor\" docs/ scripts/ test/; then echo \"git-diff-gate: anchor missing from tracked source: $anchor\"; exit 1; fi; done; echo GIT_DIFF_GATE_OK",
      captureOutput: true,
      failOnError: true,
    })

    .step("regression-gate", {
      type: 'deterministic',
      dependsOn: ["git-diff-gate"],
      command: "npm run test:catalog",
      captureOutput: true,
      failOnError: true,
    })

    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],

      timeoutMs: 600000,
      task: `Write .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/signoff.md.

Include:
- files changed
- source changes and implementation diff evidence
- status-prefixed changed-file inventory and command summaries
- dry-run command to execute before runtime launch
- deterministic validation commands
- review verdicts
- PR URL or a clear result location/status when PR creation is intentionally out of scope
- skill application boundary from .workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/skill-application-boundary.json
- remaining risks or environmental blockers
- every current output-manifest path, and no stale cleanup targets unless those targets are in the current manifest

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

End with GENERATED_WORKFLOW_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/launch-catalog-spec-beat-mirage-by-launch-status/signoff.md" },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
