# Eval Integration Catalog

This document organizes Relayfile adapters and priority gaps by integration type, using a Nango-like catalog shape for eval navigation. Nango's public catalog groups APIs into broad categories such as CRM, Communication, Dev Tools, Design, E-commerce, Knowledge Base, Payment, Productivity, Storage, Support, Ticketing, and Analytics; Nango's provider registry also stores provider-level `categories` metadata in `providers.yaml`.

Use this file as the eval-facing integration index. It separates implemented adapter packages from high-priority gaps so eval runners can choose coverage by category, coordination value, and real-time capability.

## Eval Priority Legend

| Priority | Meaning |
|---|---|
| P0 | Core eval cohort. Must be covered in the main eval suite. |
| P1 | High-value eval target. Include in category-specific or next-wave evals. |
| P2 | Breadth eval. Useful for proving coverage, less central to Relayfile's coordination thesis. |
| Gap | Not implemented in this repo yet, but strategically important. |

## Category Index

| Category | Implemented packages | Priority gaps |
|---|---:|---:|
| Project Management & Collaboration | 5 | 2 |
| Code Collaboration & Dev Tools | 2 | 0 |
| CRM & Sales | 3 | 1 |
| Support, Ticketing & Incidents | 2 | 3 |
| Communication & Messaging | 3 | 4 |
| Documents, Knowledge Base & Productivity | 4 | 5 |
| Design & Whiteboarding | 0 | 2 |
| Storage & Files | 8 | 5 |
| Databases & Runtime State | 2 | 2 |
| Analytics & Customer Data | 2 | 2 |
| E-commerce & Payments | 2 | 0 |
| Marketing & Transactional Email | 2 | 1 |
| Scheduling & Calendar | 2 | 0 |
| Core Adapter Infrastructure | 2 | 0 |

## P0 Core Eval Cohort

These integrations should anchor the large eval effort because they cover the main Relayfile thesis: human and agent actors sharing changing state, detecting stale reads, handling writeback safely, and reacting to provider events.

| Integration | Type | Status | Package | Eval focus |
|---|---|---|---|---|
| Linear | Project Management & Collaboration | Implemented | `@relayfile/adapter-linear` | Issue triage, comments, status changes, concurrent updates. |
| Jira | Project Management & Collaboration | Implemented | `@relayfile/adapter-jira` | Enterprise issue workflow, comments, project/sprint context. |
| GitHub | Code Collaboration & Dev Tools | Implemented | `@relayfile/adapter-github` | PR review, issue updates, comments, checks, code collaboration. |
| Notion | Documents, Knowledge Base & Productivity | Implemented | `@relayfile/adapter-notion` | Pages, databases, blocks, comments, document writeback. |
| Salesforce | CRM & Sales | Implemented | `@relayfile/adapter-salesforce` | Consequential CRM record writes and relation-heavy account state. |
| HubSpot | CRM & Sales | Implemented | `@relayfile/adapter-hubspot` | Contacts, companies, deals, activities, CRM writeback. |
| Zendesk | Support, Ticketing & Incidents | Implemented | `@relayfile/adapter-zendesk` | Ticket replies, assignment, status, human/AI support queue conflicts. |
| Intercom | Support, Ticketing & Incidents | Implemented | `@relayfile/adapter-intercom` | Customer conversations, contacts, article context, public-facing replies. |
| Slack | Communication & Messaging | Implemented | `@relayfile/adapter-slack` | Channels, threads, message writeback, event awareness. |
| Teams | Communication & Messaging | Implemented | `@relayfile/adapter-teams` | Microsoft enterprise chat/channel state. |
| Google Drive | Storage & Files | Implemented | `@relayfile/google-drive` | Real-time document/file changes through watch-style storage bridge. |
| SharePoint | Storage & Files | Implemented | `@relayfile/sharepoint` | Enterprise document libraries and Microsoft 365 collaboration. |
| OneDrive | Storage & Files | Implemented | `@relayfile/onedrive` | Microsoft personal/team drive file changes. |
| Gmail | Communication & Messaging | Implemented | `@relayfile/gmail` | Mailbox thread freshness, labels, drafts, real-time business communication. |
| GCS | Storage & Files | Implemented | `@relayfile/gcs` | Object storage event bridge and cloud data arrival. |
| S3 | Storage & Files | Implemented | `@relayfile/s3` | SQS/event-driven object storage bridge. |
| Postgres | Databases & Runtime State | Implemented | `@relayfile/postgres` | Database row freshness, writeback, and app-state bridge behavior. |

## Implemented Adapters By Type

### Project Management & Collaboration

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Linear | `@relayfile/adapter-linear` | `packages/linear` | P0 | Issues, projects, cycles, comments, status changes. |
| Jira | `@relayfile/adapter-jira` | `packages/jira` | P0 | Issues, comments, projects, sprints, workflow transitions. |
| Asana | `@relayfile/adapter-asana` | `packages/asana` | P1 | Projects, tasks, sections, assignees, task comments. |
| ClickUp | `@relayfile/adapter-clickup` | `packages/clickup` | P1 | Spaces, lists, tasks, comments, statuses. |
| Notion | `@relayfile/adapter-notion` | `packages/notion` | P0 | Pages, databases, blocks, comments, relation-rich docs. |

### Code Collaboration & Dev Tools

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| GitHub | `@relayfile/adapter-github` | `packages/github` | P0 | Pull requests, issues, reviews, commits, checks. |
| GitLab | `@relayfile/adapter-gitlab` | `packages/gitlab` | P1 | Merge requests, issues, pipelines, jobs, commits. |

### Social & Search

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| X | `@relayfile/adapter-x` | `packages/x` | P1 | Budgeted recent/archive social search, posts, optional user hydration. |

### CRM & Sales

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Salesforce | `@relayfile/adapter-salesforce` | `packages/salesforce` | P0 | Leads, accounts, opportunities, contacts. |
| HubSpot | `@relayfile/adapter-hubspot` | `packages/hubspot` | P0 | Contacts, deals, companies, tickets, activities. |
| Pipedrive | `@relayfile/adapter-pipedrive` | `packages/pipedrive` | P1 | Deals, persons, organizations, activities. |

### Support, Ticketing & Incidents

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Zendesk | `@relayfile/adapter-zendesk` | `packages/zendesk` | P0 | Tickets, users, organizations, comments, status. |
| Intercom | `@relayfile/adapter-intercom` | `packages/intercom` | P0 | Conversations, contacts, articles, customer replies. |

### Communication & Messaging

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Slack | `@relayfile/adapter-slack` | `packages/slack` | P0 | Channels, messages, reactions, threads. |
| Microsoft Teams | `@relayfile/adapter-teams` | `packages/teams` | P0 | Teams, channels, chats, messages, change notifications. |
| Gmail | `@relayfile/gmail` | `packages/gmail` | P0 | Threads, messages, labels, drafts, mailbox change events. |

### Documents, Knowledge Base & Productivity

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Notion | `@relayfile/adapter-notion` | `packages/notion` | P0 | Pages, databases, blocks, comments. |
| Airtable | `@relayfile/adapter-airtable` | `packages/airtable` | P1 | Bases, tables, records, structured field updates. |
| Google Calendar | `@relayfile/adapter-google-calendar` | `packages/google-calendar` | P1 | Calendars, events, watch notifications, event writeback. |
| Calendly | `@relayfile/adapter-calendly` | `packages/calendly` | P2 | Event types, scheduled events, invitees. |

### Storage & Files

| Integration | Package | Directory | Eval priority | Realtime / bridge surface |
|---|---|---|---|---|
| Google Drive | `@relayfile/google-drive` | `packages/google-drive` | P0 | Watch notifications, delta fetch, file CRUD. |
| SharePoint | `@relayfile/sharepoint` | `packages/sharepoint` | P0 | Microsoft Graph subscriptions, document libraries. |
| OneDrive | `@relayfile/onedrive` | `packages/onedrive` | P0 | Microsoft Graph subscriptions, drive delta. |
| Dropbox | `@relayfile/dropbox` | `packages/dropbox` | P1 | Dropbox webhooks, cursor delta fetch. |
| Box | `@relayfile/box` | `packages/box` | P1 | Box webhooks, file/folder events. |
| Google Cloud Storage | `@relayfile/gcs` | `packages/gcs` | P0 | Pub/Sub object notifications. |
| Azure Blob Storage | `@relayfile/azure-blob` | `packages/azure-blob` | P1 | Event Grid blob events. |
| Amazon S3 | `@relayfile/s3` | `packages/s3` | P0 | SQS event notifications. |

### Databases & Runtime State

| Integration | Package | Directory | Eval priority | Realtime / bridge surface |
|---|---|---|---|---|
| Postgres | `@relayfile/postgres` | `packages/postgres` | P0 | Row/object state through LISTEN/NOTIFY-style bridge semantics. |
| Redis | `@relayfile/redis` | `packages/redis` | P1 | Keyspace events and runtime cache/state changes. |

### Analytics & Customer Data

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Mixpanel | `@relayfile/adapter-mixpanel` | `packages/mixpanel` | P2 | Events, profiles, cohorts, mostly read-heavy analytics. |
| Segment | `@relayfile/adapter-segment` | `packages/segment` | P2 | Sources, destinations, tracking events, customer traits. |

### E-commerce & Payments

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Shopify | `@relayfile/adapter-shopify` | `packages/shopify` | P1 | Products, orders, customers, commerce operations. |
| Stripe | `@relayfile/adapter-stripe` | `packages/stripe` | P1 | Customers, charges, subscriptions, invoices, payments. |

### Marketing & Transactional Email

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Mailgun | `@relayfile/adapter-mailgun` | `packages/mailgun` | P2 | Domains, messages, events, delivery status. |
| SendGrid | `@relayfile/adapter-sendgrid` | `packages/sendgrid` | P2 | Templates, campaigns, contacts, delivery status. |

### Scheduling & Calendar

| Integration | Package | Directory | Eval priority | Coordination surface |
|---|---|---|---|---|
| Google Calendar | `@relayfile/adapter-google-calendar` | `packages/google-calendar` | P1 | Event watch, create/update/delete, calendar state. |
| Calendly | `@relayfile/adapter-calendly` | `packages/calendly` | P2 | Booking data and scheduled event state. |

### Core Adapter Infrastructure

| Package | Directory | Purpose |
|---|---|---|
| `@relayfile/adapter-core` | `packages/core` | Schema-driven adapter generator and runtime. |
| `@relayfile/webhook-server` | `packages/webhook-server` | Hono webhook receiver for adapter-driven ingestion. |

## Priority Gaps By Type

These are not implemented packages in this repo today, but they should be part of eval planning because they exercise high-value categories or provider shapes.

### P0 / P1 Gaps

| Integration | Type | Target priority | Why it matters for eval |
|---|---|---|---|
| Confluence | Documents, Knowledge Base & Productivity | Gap P0 | Completes Atlassian with Jira; enterprise pages, comments, and links. |
| Google Docs / Sheets | Documents, Knowledge Base & Productivity | Gap P0 | Collaborative document/spreadsheet edits; pairs naturally with Google Drive. |
| Freshdesk | Support, Ticketing & Incidents | Gap P1 | Major Zendesk alternative; support queue concurrency. |
| ServiceNow | Support, Ticketing & Incidents | Gap P1 | Enterprise ITSM records, high-stakes incident/change workflows. |
| PagerDuty | Support, Ticketing & Incidents | Gap P1 | Incident state, acknowledgement, escalation, resolution. |
| Monday.com | Project Management & Collaboration | Gap P1 | Board/item collaboration and project automation. |
| Discord | Communication & Messaging | Gap P1 | Developer community and internal team messaging. |
| Outlook / Exchange | Communication & Messaging | Gap P1 | Microsoft email counterpart to Gmail. |
| Figma | Design | Gap P1 | Design collaboration, comments, file versions, spec extraction. |
| Coda | Documents, Knowledge Base & Productivity | Gap P1 | Doc-database hybrid with product/ops workflows. |
| Trello | Project Management & Collaboration | Gap P1 | Simple card/list project management with broad adoption. |
| Miro | Design / Productivity | Gap P1 | Whiteboards, planning boards, sticky notes, diagrams. |
| Freshsales | CRM & Sales | Gap P2 | Freshworks CRM companion to Freshdesk. |
| Telegram | Communication & Messaging | Gap P2 | Bot webhook delivery; niche but real-time channel/file workflows. |

### Storage, Database, And Infrastructure Gaps

| Integration | Type | Target priority | Why it matters for eval |
|---|---|---|---|
| MongoDB Atlas | Databases & Runtime State | Gap P1 | Change streams through Atlas Triggers; document JSON state. |
| Cloudflare R2 | Storage & Files | Gap P1 | Object storage through Cloudflare Queues and Worker bridge. |
| Supabase Storage | Storage & Files | Gap P1 | Developer-heavy storage surface; self-hosted webhooks. |
| Nextcloud | Storage & Files | Gap P2 | Self-hosted files and WebDAV-style enterprise/self-hosted use. |
| Smartsheet | Documents, Knowledge Base & Productivity | Gap P2 | Spreadsheet-like work management. |
| Snowflake | Analytics & Customer Data | Gap P2 | Warehouse read-heavy analytics and cross-record enrichment. |
| BigQuery | Analytics & Customer Data | Gap P2 | GCP warehouse read-heavy analytics. |
| Twilio | Communication & Messaging | Gap P2 | SMS/voice transactional workflows. |
| Typeform | Productivity / Surveys | Gap P2 | Form response ingestion, mostly append-only. |
| Webflow | CMS / Marketing | Gap P2 | CMS publishing and marketing-site content writeback. |
| Convex | Databases & Runtime State | Gap P2 | App database/storage with user-built event forwarding. |
| Hugging Face Buckets | Storage & Files | Gap P2 | ML artifact storage; useful but polling/manual sync only. |
| SFTP / FTP | Storage & Files | Gap P2 | Legacy file transfer; polling-based freshness. |

## Suggested Eval Slices

| Eval slice | Include |
|---|---|
| Collaboration state | Linear, Jira, GitHub, Notion, Asana, ClickUp |
| Consequential writeback | Salesforce, HubSpot, Zendesk, Intercom, Jira, GitHub |
| Communication awareness | Slack, Teams, Gmail, Google Calendar |
| Real-time storage bridge | Google Drive, SharePoint, OneDrive, GCS, S3, Dropbox |
| Data and runtime state | Postgres, Redis, Airtable, Segment, Mixpanel |
| Commerce and payments | Shopify, Stripe |
| Social and search | X |
| Long-tail provider breadth | Mailgun, SendGrid, Calendly, Box, Azure Blob |
| Gap validation | Confluence, Google Docs, Freshdesk, ServiceNow, PagerDuty, Monday.com, Discord, Outlook, Figma |

## Repo Publish Group Mapping

The current publish resolver uses these group aliases. Keep this list aligned with `scripts/resolve-publish-targets.mjs` if package groupings change.

| Publish group | Package directories |
|---|---|
| `storage` | `azure-blob`, `box`, `dropbox`, `gcs`, `google-drive`, `onedrive`, `s3`, `sharepoint` |
| `messaging` | `gmail`, `slack`, `teams` |
| `calendar` | `google-calendar` |
| `devtools` | `github`, `gitlab` |
| `crm` | `hubspot`, `salesforce`, `pipedrive` |
| `pm` | `asana`, `clickup`, `jira`, `linear`, `notion` |
| `support` | `intercom`, `zendesk` |
| `analytics` | `mixpanel`, `segment` |
| `email` | `mailgun`, `sendgrid` |
| `commerce` | `shopify`, `stripe` |
| `db` | `postgres`, `redis` |
| `social` | `x` |

## Sources

- Nango public integration catalog: https://nango.dev/api-integrations
- Nango provider registry: https://github.com/NangoHQ/nango/blob/master/packages/providers/providers.yaml
- Local package inventory: `packages/*/package.json`
- Local publish group aliases: `scripts/resolve-publish-targets.mjs`
