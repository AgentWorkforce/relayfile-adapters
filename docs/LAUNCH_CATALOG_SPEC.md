# Launch Catalog Spec — Beat Mirage by Launch

Status: **draft v0** • Owner: relayfile-adapters • Target: launch +7d

## 1. Goal

Ship a catalog that is **visibly larger than [Mirage's 32 resources](https://docs.mirage.strukto.ai/home/resource-matrix)** at launch, **without sacrificing the writeback + webhook story** that Mirage doesn't have.

Hard targets:

- **≥ 50 catalog entries** at launch (vs Mirage's 32). Headline number on the site.
- **≥ 16 Tier-1 adapters** with full read + write + webhook + signature verification.
- **≥ 12 additional Tier-2 adapters** with read + write + polling ingest.
- **Remaining entries Tier-3**: read-only, OpenAPI-driven, polling.
- Every Mirage-listed SaaS we don't already cover gets at least a Tier-3 entry, so no `mirage-vs-relayfile` matrix has a row where Mirage wins on coverage.

Non-goals for launch:

- Implementing every operation each API exposes — Tier-1 covers the high-frequency object types only.
- Replacing Pipedream/Nango on the auth side — we're a thin schema layer over them.
- Mounting databases as queryable shells (Mirage has Postgres/Mongo as read-only). We catalog them T3 with a single `query.json` writeback for now.

## 2. Strategy: leverage what Mirage doesn't have

Three multipliers we already have in-tree:

1. **Schema-driven generation** — `@relayfile/adapter-core` ingests OpenAPI / Postman / sample payloads and emits adapter scaffolding from a [mapping YAML](./MAPPING_YAML_SPEC.md). Each new adapter ≈ one YAML + one OpenAPI URL + one webhook verifier + path-mapper fixtures. **This is how 50 ships in a week.**
2. **Provider matrix** — every adapter inherits OAuth from `@relayfile/provider-{nango,pipedream,composio,clerk}`. We never write OAuth N times. Cross-reference: [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 first-party templates we can pull mapping hints from.
3. **Webhook + writeback primitives** — already in `webhook-server` + adapter `writeback.ts`. Most Mirage resources are read-only; ours are bidirectional by default, so coverage parity ≈ feature win.

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
| 1 | *local-disk* | T1 | RAM/Disk/OPFS | none | existing `relayfile-mount` |
| 2 | **in-memory** | T1 | RAM | none | existing |
| 3 | **ssh** | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |
| **Object storage** ||||||
| 4 | **s3** | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge / SQS notifications |
| 5 | **r2** | T2 | R2 | direct (S3-compat) | Cloudflare R2 docs |
| 6 | **gcs** | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |
| 7 | **azure-blob** | T2 | — *(beats Mirage)* | nango oauth | Blob REST + Event Grid |
| 8 | **supabase** | T2 | Supabase | supabase provider (existing) | Storage REST |
| **File storage SaaS** ||||||
| 9 | **google-drive** | T1 | Drive | nango/pipedream | Drive v3 + `changes.watch` push |
| 10 | **dropbox** | T2 | Dropbox | nango/pipedream | API v2 + webhooks |
| 11 | **box** | T2 | Box | nango/pipedream | API + webhooks v2 |
| **Microsoft 365** ||||||
| 12 | **outlook-mail** | T2 | — | nango/pipedream | Graph `/me/messages` + Graph subscriptions |
| 13 | **onedrive** | T2 | — | nango/pipedream | Graph `/drives` + subscriptions |
| 14 | **sharepoint** | T3 | — | nango/pipedream | Graph sites + lists |
| **Google Workspace** ||||||
| 15 | **gmail** | T1 | Gmail | nango/pipedream | Gmail v1 + Pub/Sub `users.watch` |
| 16 | **google-calendar** | T1 | — | nango/pipedream | Calendar v3 + `events.watch` push |
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
- **OPFS** — browser-only mount, covered conceptually by `local-disk` in our agent-side mount layer. Not a SaaS adapter.
- **Paperclip / Semantic Scholar / Vercel** — Paperclip is a citation tool with no public API of note; we ship Semantic Scholar + Vercel.
- **OCI** — covered by S3-compatible client; can be a config flag on the s3 adapter rather than a separate row.

If the marketing team wants 60+ headline number for splash, the "stretch row" candidates are: `oci`, `webflow`, `airtable`, `mailchimp`, `shopify`, `quickbooks` — all already have Nango templates and OpenAPI specs available.

## 5. Tier-1 adapter spec sheets

Compact spec per T1 adapter — enough to file the YAML mapping without further research. All paths are VFS paths under the workspace root; OAuth is handled by the Nango/Pipedream/Composio provider.

### 5.1 `jira`

- **Base URL**: `https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3`
- **Auth**: OAuth 2.0 (3LO), `cloudid` resolved via `/oauth/token/accessible-resources`
- **Pagination**: `startAt` / `maxResults` (offset, default 50, max 100); newer endpoints use `nextPageToken` (next-token)
- **Webhooks**: registered via Connect app or REST `/rest/api/3/webhook`; signature header `X-Atlassian-Webhook-Identifier`
- **Path mapping**:
  - `/jira/projects/{projectKey}/issues/{issueKey}/metadata.json`
  - `/jira/projects/{projectKey}/issues/{issueKey}/comments/{commentId}.json`
- **Webhook events**: `jira:issue_created|updated|deleted`, `comment_created|updated|deleted`
- **Writeback globs**:
  - `/jira/projects/*/issues/*/comments/*.json` → `POST /issue/{issueKey}/comment`
  - `/jira/projects/*/issues/*/transition.json` → `POST /issue/{issueKey}/transitions`
  - `/jira/projects/*/issues/*/metadata.json` (PUT) → `PUT /issue/{issueKey}`
- **Nango template ref**: `integrations/jira`

### 5.2 `asana`

- **Base URL**: `https://app.asana.com/api/1.0`
- **Auth**: OAuth 2.0 or PAT
- **Pagination**: `offset` token in `next_page.offset`, `limit` 1–100
- **Webhooks**: `POST /webhooks` with `target` URL; handshake via `X-Hook-Secret` echo; subsequent deliveries signed with `X-Hook-Signature` (HMAC-SHA256)
- **Path mapping**:
  - `/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json`
  - `/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/stories/{sid}.json`
- **Webhook events**: `task.{added|changed|deleted}`, `story.added`
- **Writeback globs**:
  - `/asana/.../tasks/*/stories/*.json` → `POST /tasks/{tid}/stories`
  - `/asana/.../tasks/*/metadata.json` (PUT) → `PUT /tasks/{tid}`
- **Nango template ref**: `integrations/asana`

### 5.3 `discord`

- **Base URL**: `https://discord.com/api/v10`
- **Auth**: bot token (preferred for write) + OAuth 2.0 for user-scoped reads
- **Pagination**: `before` / `after` snowflake cursors
- **Ingest**: prefer **interaction webhooks** + **outgoing channel webhooks** for posts; for high-volume guild events use the gateway via a sidecar daemon (deferred to T1.5)
- **Signature verify**: Ed25519 over `X-Signature-Ed25519` + `X-Signature-Timestamp` (interactions). Channel webhooks aren't signed; rely on URL secrecy + IP allowlist.
- **Path mapping**:
  - `/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json`
  - `/discord/guilds/{gid}/members/{uid}.json`
- **Writeback globs**:
  - `/discord/guilds/*/channels/*/messages/post.json` → `POST /channels/{cid}/messages`
  - `/discord/guilds/*/channels/*/messages/*.json` (PUT) → `PATCH /channels/{cid}/messages/{mid}`

### 5.4 `hubspot`

- **Base URL**: `https://api.hubapi.com`
- **Auth**: OAuth 2.0 or private app token
- **Pagination**: `paging.next.after` cursor (`limit` ≤ 100)
- **Webhooks**: configured per-app in HubSpot dev portal; signed with `X-HubSpot-Signature-v3` (HMAC-SHA256 over method + URI + body + timestamp)
- **Path mapping**:
  - `/hubspot/objects/contacts/{id}.json`
  - `/hubspot/objects/deals/{id}.json`
  - `/hubspot/objects/companies/{id}.json`
- **Webhook events**: `contact.creation|propertyChange|deletion`, `deal.*`, `company.*`
- **Writeback globs**:
  - `/hubspot/objects/contacts/*.json` (PUT) → `PATCH /crm/v3/objects/contacts/{id}`
  - `/hubspot/objects/contacts/create.json` → `POST /crm/v3/objects/contacts`
- **Nango template ref**: `integrations/hubspot`

### 5.5 `intercom`

- **Base URL**: `https://api.intercom.io`
- **Auth**: OAuth or access token
- **Pagination**: `pages.next.starting_after` cursor (Conversations API)
- **Webhooks**: per-app subscriptions, signed with `X-Hub-Signature` (HMAC-SHA1 over body using app client secret)
- **Path mapping**:
  - `/intercom/conversations/{id}/metadata.json`
  - `/intercom/conversations/{id}/parts/{partId}.json`
  - `/intercom/contacts/{id}.json`
- **Webhook events**: `conversation.user.created|replied`, `conversation.admin.replied|noted`, `contact.*`
- **Writeback globs**:
  - `/intercom/conversations/*/reply.json` → `POST /conversations/{id}/reply`
  - `/intercom/contacts/*.json` (PUT) → `PUT /contacts/{id}`

### 5.6 `pagerduty`

- **Base URL**: `https://api.pagerduty.com`
- **Auth**: OAuth or REST API token (`Authorization: Token token=...`)
- **Pagination**: `offset` / `limit` (max 100); newer endpoints use `cursor`
- **Webhooks**: v3 subscriptions API (`POST /webhook_subscriptions`), signed with `X-PagerDuty-Signature` (HMAC-SHA256)
- **Path mapping**:
  - `/pagerduty/services/{sid}/incidents/{iid}/metadata.json`
  - `/pagerduty/services/{sid}/incidents/{iid}/log_entries/{leid}.json`
- **Webhook events**: `incident.triggered|acknowledged|resolved|annotated`
- **Writeback globs**:
  - `/pagerduty/.../incidents/*/notes.json` → `POST /incidents/{iid}/notes`
  - `/pagerduty/.../incidents/*/metadata.json` (PUT) → `PUT /incidents/{iid}`

### 5.7 `sentry`

- **Base URL**: `https://sentry.io/api/0`
- **Auth**: OAuth or auth token (org-scoped)
- **Pagination**: `Link` header cursor (link-header strategy)
- **Webhooks**: per-integration; signed with `Sentry-Hook-Signature` (HMAC-SHA256 of body using integration client secret)
- **Path mapping**:
  - `/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json`
  - `/sentry/orgs/{org}/projects/{project}/issues/{issueId}/events/{eventId}.json`
- **Webhook events**: `issue.created|resolved|assigned`, `error.created`
- **Writeback globs**:
  - `/sentry/.../issues/*/metadata.json` (PUT) → `PUT /issues/{issueId}`
  - `/sentry/.../issues/*/comments.json` → `POST /issues/{issueId}/comments`

### 5.8 `stripe`

- **Base URL**: `https://api.stripe.com/v1`
- **Auth**: secret key (no OAuth needed for app-level; Connect uses OAuth)
- **Pagination**: `starting_after` cursor (objects sortable by creation)
- **Webhooks**: signed with `Stripe-Signature` (timestamp + v1 HMAC-SHA256, anti-replay window)
- **Path mapping**:
  - `/stripe/customers/{cid}.json`
  - `/stripe/customers/{cid}/subscriptions/{sid}.json`
  - `/stripe/charges/{chargeId}.json`
- **Webhook events**: `customer.*`, `invoice.*`, `charge.*`, `payment_intent.*`
- **Writeback globs**:
  - `/stripe/customers/*.json` (PUT) → `POST /customers/{cid}` (form-encoded)
  - `/stripe/customers/*/refund.json` → `POST /refunds`

### 5.9 `gmail`

- **Base URL**: `https://gmail.googleapis.com/gmail/v1`
- **Auth**: OAuth 2.0 (scopes: `gmail.readonly` + `gmail.send` + `gmail.modify`)
- **Pagination**: `pageToken` (next-token)
- **Ingest**: `users.watch` → Pub/Sub topic → relay webhook (sidecar required, or use Pipedream's Gmail trigger as ingest source)
- **Path mapping**:
  - `/gmail/messages/{messageId}/metadata.json`
  - `/gmail/messages/{messageId}/raw.eml`
  - `/gmail/labels/{labelId}/messages/` (virtual list)
- **Writeback globs**:
  - `/gmail/messages/send.json` → `POST /users/me/messages/send`
  - `/gmail/messages/*/labels.json` (PUT) → `POST /users/me/messages/{id}/modify`

### 5.10 `google-calendar`

- **Base URL**: `https://www.googleapis.com/calendar/v3`
- **Auth**: OAuth 2.0 (scope `calendar.events`)
- **Pagination**: `pageToken` (next-token); incremental sync via `syncToken`
- **Ingest**: `events.watch` push channels → webhook (channels expire ≤30d, need refresher)
- **Path mapping**:
  - `/gcal/calendars/{calId}/events/{eventId}.json`
- **Webhook events**: `events.changed` (Google sends a sync ping; adapter pulls delta)
- **Writeback globs**:
  - `/gcal/calendars/*/events/*.json` (PUT) → `PUT /calendars/{calId}/events/{eventId}`
  - `/gcal/calendars/*/events/create.json` → `POST /calendars/{calId}/events`

### 5.11 `google-drive`

- **Base URL**: `https://www.googleapis.com/drive/v3`
- **Auth**: OAuth 2.0 (scopes: `drive` or `drive.file`)
- **Pagination**: `pageToken` (next-token)
- **Ingest**: `changes.watch` push channels (account-wide change feed)
- **Path mapping**:
  - `/gdrive/files/{fileId}/metadata.json`
  - `/gdrive/files/{fileId}/content` (binary, exported per mimeType)
- **Writeback globs**:
  - `/gdrive/files/*/metadata.json` (PUT) → `PATCH /files/{fileId}` (rename, move via `addParents`/`removeParents`)
  - `/gdrive/files/upload.json` → resumable upload `POST /upload/drive/v3/files`

### 5.12 `slack` *(existing — list for completeness; verify parity)*

- **Base URL**: `https://slack.com/api`
- **Auth**: OAuth 2.0 (bot + user scopes)
- **Pagination**: `response_metadata.next_cursor`
- **Ingest**: Events API webhook, signed with `X-Slack-Signature` (v0 HMAC-SHA256 + timestamp)
- **Already shipping** — confirm webhook signature and writeback globs match this spec.

### 5.13 `linear` *(existing)*

- GraphQL only. Confirm webhook subscriptions are configured during connection setup.

### 5.14 `notion` *(existing)*

- Notion shipped webhooks in 2025; mapping should add webhook entries for `page.updated`, `database.updated`, `comment.created`. Existing `notion-ingest-handler` in `provider-nango` should keep working as polling fallback.

### 5.15 `s3`

- **Base URL**: `https://{bucket}.s3.{region}.amazonaws.com`
- **Auth**: SigV4 (Nango handles via AWS connector) or static credentials
- **Pagination**: `ContinuationToken` (cursor)
- **Ingest**: S3 → EventBridge / SNS / SQS → relay webhook ingestor (the adapter ships an SQS poller mode that posts to the workspace as if it were a webhook)
- **Path mapping**:
  - `/s3/{bucket}/{key}` (binary content)
  - `/s3/{bucket}/{key}/metadata.json` (object headers)
- **Writeback globs**:
  - `/s3/{bucket}/*` (PUT) → `PUT /{bucket}/{key}` (multipart for >5MB)

### 5.16 `github` *(existing)*

- Reference for everything. Don't change.

### 5.17 `local-disk` *(existing — primitive)*

- Primitive mount; acts as the universal write target when no SaaS is mapped. Already covered by `relayfile-mount`.

## 6. Tier-2 spec sheets (compact)

For T2, only fields differing from T1 norms are listed. All use Nango/Pipedream OAuth unless noted.

| Adapter | Base URL | Pagination | Ingest | Notable writeback paths |
|---|---|---|---|---|
| `salesforce` | `https://{instance}.my.salesforce.com/services/data/v60.0` | next-record-url (link-style) | Streaming API / Platform Events sidecar | `/sf/objects/Account/*.json`, `/sf/objects/Contact/*.json` |
| `zendesk` | `https://{sub}.zendesk.com/api/v2` | cursor (`after_cursor`) | Webhooks resource (`/webhooks`) signed with `X-Zendesk-Webhook-Signature` | `/zendesk/tickets/{id}/comments.json` |
| `confluence` | `https://api.atlassian.com/ex/confluence/{cloudid}/wiki/api/v2` | `cursor` | Connect-app webhooks | `/confluence/spaces/{key}/pages/{id}/body.json` |
| `bitbucket` | `https://api.bitbucket.org/2.0` | `next` URL | Repository webhooks | `/bitbucket/{ws}/{repo}/pullrequests/{id}/comments.json` |
| `vercel` | `https://api.vercel.com` | `next` cursor | Deployment / log-drain webhooks | `/vercel/projects/{id}/env/*.json` |
| `outlook-mail` | `https://graph.microsoft.com/v1.0/me` | `@odata.nextLink` | Graph subscriptions | `/outlook/messages/send.json` |
| `onedrive` | `https://graph.microsoft.com/v1.0/me/drive` | `@odata.nextLink` | Graph subscriptions | `/onedrive/items/{id}` content + metadata |
| `dropbox` | `https://api.dropboxapi.com/2` | `cursor` | account webhook + `files/list_folder/longpoll` | `/dropbox/files/{path}` |
| `box` | `https://api.box.com/2.0` | `marker` | webhooks v2 (signed) | `/box/files/{id}`, `/box/folders/{id}/items` |
| `posthog` | `https://app.posthog.com/api` | `next` URL | action webhooks | `/posthog/projects/{id}/insights/{iid}.json` |
| `datadog` | `https://api.datadoghq.com/api/v2` | `next_cursor` | webhooks integration | `/datadog/monitors/{id}.json`, `/datadog/incidents/{id}.json` |
| `gcs` | `https://storage.googleapis.com/storage/v1` | `pageToken` | Pub/Sub object change notifications | `/gcs/{bucket}/{object}` |
| `azure-blob` | `https://{account}.blob.core.windows.net` | `marker` | Event Grid → relay | `/azureblob/{container}/{blob}` |
| `r2` | S3-compatible | continuation-token | bucket → queue → relay | `/r2/{bucket}/{key}` |
| `supabase` | `https://{ref}.supabase.co` | range header | already supported | reuse existing |
| `clickup` | `https://api.clickup.com/api/v2` | `page` | webhooks | `/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json` |
| `trello` | `https://api.trello.com/1` | none (list-based) | webhook callbacks | `/trello/boards/{id}/cards/{cardId}.json` |
| `telegram` | `https://api.telegram.org/bot{token}` | `offset` | `setWebhook` | `/telegram/chats/{chatId}/messages/send.json` |
| `teams` | Graph chats | `@odata.nextLink` | change notifications | already shipping; confirm |
| `smtp-imap` | `imap://...` / `smtp://...` | IMAP UID | IMAP IDLE sidecar | `/email/inbox/{uid}.eml`, `/email/send.json` |
| `ssh` | host:port | n/a | none | `/ssh/{host}/...` |

## 7. Tier-3 spec sheets (catalog-only)

Each T3 adapter ships:

- A mapping YAML pointing at the public OpenAPI spec (or hand-written `samples` if no OpenAPI exists).
- A read-only resource set generated by the schema adapter.
- A single placeholder writeback (`/{adapter}/_unsupported.json` returns 501) to keep the contract consistent.
- One smoke test fixture per object type.

Adapters: `freshdesk`, `pipedrive`, `shortcut`, `coda`, `langfuse`, `sharepoint`, `google-slides`, `netlify`, `postgres`, `mongodb`, `semantic-scholar`, `arxiv`.

For `postgres` and `mongodb`, the read surface is a synthetic VFS:

- `/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json` — generated by introspection
- `/postgres/{db}/queries/{name}.sql` (write) → executes prepared statement, results land at `/postgres/{db}/queries/{name}.results.json`
- `mongodb` analogous with collections + `.find.json` / `.results.json`

These are explicitly **catalog entries that demonstrate the model**, not full DB shells. Mirage's Postgres/Mongo support is also read-only, so we tie on functionality and surpass on writeback intent.

## 8. Build plan (7 days)

| Day | Deliverable |
|---|---|
| **Mon** | Land scaffolding tooling: a `pnpm gen:adapter <name>` that takes (mapping yaml + openapi url) and emits a package skeleton with tests. Pull Nango template hints into a `templates/<name>.hints.yaml` for each row. |
| **Tue** | T1 batch A: `jira`, `asana`, `hubspot`, `stripe` (4 adapters). One owner per adapter; webhook signature verifier is the gating test. |
| **Wed** | T1 batch B: `intercom`, `pagerduty`, `sentry`, `discord` (4). |
| **Thu** | T1 batch C: `gmail`, `google-calendar`, `google-drive`, `s3` (4). Push-channel/EventBridge ingest stubs land here. |
| **Fri** | T2 wave: 12 adapters generated from OpenAPI in bulk. Each one needs only a YAML mapping + 1 path-mapper test. |
| **Sat** | T3 wave: 12 adapters. Generator runs in CI; manual review of generated paths only. Add catalog matrix to docs site. |
| **Sun** | Launch hygiene: every adapter gets a one-paragraph README, a `mirage-vs-relayfile.md` row, and a smoke test in CI. Cut `@relayfile/adapters@<launch>` versions. |

Parallelism: T1 needs ~4 owners (one per batch). T2/T3 fan out across whoever's free. Each T1 adapter ≈ 0.5–1d for an experienced adapter author given the scaffolding; T2 ≈ 2h; T3 ≈ 30min once the generator is solid.

## 9. Quality bar

Per-adapter checklist before a tag is cut:

- [ ] `mapping.yaml` validated by `@relayfile/adapter-core` parser (zero warnings).
- [ ] Path-mapper unit tests cover every documented webhook event type and every writeback glob.
- [ ] Webhook signature verifier with at least one passing fixture and one tampered fixture (T1 only).
- [ ] Pagination strategy declared and exercised by at least one fixture.
- [ ] Writeback round-trip recorded against a sandbox account where one exists; otherwise a recorded fixture from Pipedream / Nango.
- [ ] One-line README + a row in `docs/CATALOG.md`.
- [ ] Provider compatibility matrix (which providers are tested for this adapter).

CI gate: a `pnpm catalog:audit` script asserts that the published catalog count ≥ Mirage's tracked count (manually maintained in `docs/MIRAGE_PARITY.md` and grepped from their docs weekly).

## 10. Open questions

1. **Which Mirage rows do we *not* match by design?** Current proposal: skip Paperclip, OPFS, OCI (S3-compat covers it). Confirm before launch.
2. **Headline number for marketing**: 50, 54, or 60 (with stretch row additions)?
3. **Nango vs Pipedream as default in docs.** Both work; we should pick one for the quickstart and footnote the other.
4. **Database adapters** (`postgres`, `mongodb`, `mysql`): is `query.json` writeback acceptable for launch, or do we ship them read-only and add writeback in a follow-up?
5. **Discord ingest**: ship gateway sidecar at launch, or ship interaction-webhook-only and call it T1.5 until gateway lands?

## 11. References

- [Mirage resource matrix](https://docs.mirage.strukto.ai/home/resource-matrix) (32 resources, mostly read-only)
- [NangoHQ/integration-templates](https://github.com/NangoHQ/integration-templates) — ~110 templates; lift mapping hints from `integrations/<name>/syncs/*.ts`
- [`docs/MAPPING_YAML_SPEC.md`](./MAPPING_YAML_SPEC.md) — the format every adapter generates into
- [`docs/PATH_SLUGIFICATION_SPEC.md`](./PATH_SLUGIFICATION_SPEC.md) — path safety rules every adapter must follow
- Provider package READMEs in `relayfile-providers/packages/{nango,pipedream,composio,clerk,supabase,n8n}`
