# Launch Catalog

The launch catalog is code-backed by `scripts/launch-catalog.mjs` and audited by `npm run catalog:audit`. It declares 54 entries against Mirage's 32 tracked resources, with launch floors of at least 50 total entries, at least 16 Tier-1 entries, and at least 12 Tier-2 entries.

Provider quickstart routing is explicitly documented as Nango/Pipedream/Composio. Local callers run `catalog:audit` and `test:catalog` directly against repo files (catalog metadata + audit script + catalog tests; adapter-package implementation is out of scope for this artifact), cloud callers use the provider matrix for OAuth-backed transport, and MCP callers consume materialized catalog and audit artifacts.

| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |
|---|---|---|---|---|---|
| 1 | local-disk | T1 | RAM/Disk/OPFS | none | existing relayfile-mount |
| 2 | in-memory | T1 | RAM | none | existing primitive mount |
| 3 | ssh | T2 | SSH | nango/pipedream | RFC 4254 + libssh2 |
| 4 | s3 | T1 | S3 | nango (sigv4) | AWS S3 REST + EventBridge/SQS notifications |
| 5 | r2 | T2 | R2 | direct (S3-compatible) | Cloudflare R2 docs |
| 6 | gcs | T2 | GCS | nango oauth | GCS JSON API + Pub/Sub notifications |
| 7 | azure-blob | T2 | beats Mirage | nango oauth | Blob REST + Event Grid |
| 8 | supabase | T2 | Supabase | supabase provider | Storage REST |
| 9 | google-drive | T1 | Drive | nango/pipedream | Drive v3 + `/upload/drive/v3/files` upload |
| 10 | dropbox | T2 | Dropbox | nango/pipedream | API v2 + webhooks |
| 11 | box | T2 | Box | nango/pipedream | API + webhooks v2 |
| 12 | outlook-mail | T2 | beats Mirage | nango/pipedream | Graph `/me/messages` + subscriptions |
| 13 | onedrive | T2 | beats Mirage | nango/pipedream | Graph `/drives` + subscriptions |
| 14 | sharepoint | T3 | beats Mirage | nango/pipedream | Graph sites + lists |
| 15 | gmail | T1 | Gmail | nango/pipedream | `/users/me/messages` read + `/users/me/messages/send` write |
| 16 | google-calendar | T1 | beats Mirage | nango/pipedream | Calendar v3 + events.watch push |
| 17 | google-docs | T2 | Docs | nango/pipedream | Docs v1 with Drive change ingest |
| 18 | google-sheets | T2 | Sheets | nango/pipedream | Sheets v4 batchUpdate |
| 19 | google-slides | T3 | Slides | nango/pipedream | Slides v1 |
| 20 | github | T1 | GitHub + GitHub CI | nango/clerk | REST v3 + webhooks |
| 21 | gitlab | T1 | beats Mirage | nango | REST v4 + webhooks |
| 22 | bitbucket | T2 | beats Mirage | nango | Cloud REST 2.0 + webhooks |
| 23 | vercel | T2 | Vercel | nango | REST + deployment webhooks |
| 24 | netlify | T3 | beats Mirage | nango | REST + outgoing webhooks |
| 25 | linear | T1 | Linear | nango/pipedream | GraphQL + webhooks |
| 26 | jira | T1 | beats Mirage | nango/pipedream | REST v3 + webhooks |
| 27 | asana | T1 | beats Mirage | nango/pipedream | REST + webhooks |
| 28 | trello | T2 | Trello | nango | REST + webhook callbacks |
| 29 | clickup | T2 | beats Mirage | nango | API v2 + webhooks |
| 30 | shortcut | T3 | beats Mirage | nango | REST v3 |
| 31 | notion | T1 | Notion | nango | API + webhooks |
| 32 | confluence | T2 | beats Mirage | nango/pipedream | REST + Connect app webhooks |
| 33 | coda | T3 | beats Mirage | nango | API v1 + webhooks |
| 34 | slack | T1 | Slack | nango/pipedream | Web API + Events API |
| 35 | teams | T2 | beats Mirage | nango/pipedream | Graph chats + change notifications |
| 36 | discord | T1 | Discord | nango | REST v10 + interaction webhooks |
| 37 | telegram | T2 | Telegram | nango | Bot API + setWebhook |
| 38 | hubspot | T1 | beats Mirage | nango/pipedream | CRM v3 writeback via `/crm/v3/objects/contacts` |
| 39 | salesforce | T2 | beats Mirage | nango/pipedream | REST + Streaming/Platform Events |
| 40 | pipedrive | T3 | beats Mirage | nango | API v2 + webhooks v1 |
| 41 | intercom | T1 | beats Mirage | nango/pipedream | REST + webhook topics |
| 42 | zendesk | T2 | beats Mirage | nango/pipedream | REST + webhooks/triggers |
| 43 | freshdesk | T3 | beats Mirage | nango | REST + webhook automations |
| 44 | sentry | T1 | beats Mirage | nango | REST + webhook integrations |
| 45 | datadog | T2 | beats Mirage | nango | API v2 + webhooks integration |
| 46 | posthog | T2 | PostHog | nango | API + action webhooks |
| 47 | pagerduty | T1 | beats Mirage | nango | REST + webhook subscriptions v3 |
| 48 | langfuse | T3 | Langfuse | direct PAT | OpenAPI |
| 49 | postgres | T3 | Postgres | direct DSN | LISTEN/NOTIFY + query.json writeback |
| 50 | mongodb | T3 | MongoDB | direct DSN | change streams + query.json writeback |
| 51 | stripe | T1 | beats Mirage | nango | REST + signed webhooks |
| 52 | smtp-imap | T2 | Email | direct creds | RFC 5321/3501 |
| 53 | semantic-scholar | T3 | Semantic Scholar | optional API key | Graph API v1 |
| 54 | arxiv | T3 | beats Mirage | none | OAI-PMH / Atom feed |
