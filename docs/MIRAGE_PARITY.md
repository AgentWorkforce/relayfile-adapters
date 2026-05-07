# Mirage Parity

Mirage's tracked matrix is currently represented as 32 resources for launch audit purposes. `npm run catalog:audit` fails if the Relayfile launch catalog drops below that count, below 50 total launch entries, below 16 Tier-1 entries, or below 12 Tier-2 entries.

Intentional non-matches are handled as coverage decisions, not gaps. OPFS is covered conceptually by the local-disk RAM/Disk/OPFS primitive rather than a SaaS adapter. OCI is covered by the S3-compatible object storage path rather than a separate launch row. Paperclip is not treated as a required SaaS row because the catalog covers Semantic Scholar directly.

| Mirage row | Relayfile launch coverage | Status |
|---|---|---|
| RAM | in-memory, local-disk | covered |
| Disk | local-disk | covered |
| OPFS | local-disk RAM/Disk/OPFS primitive | covered by primitive |
| SSH | ssh | covered |
| S3 | s3 | covered |
| R2 | r2 | covered |
| GCS | gcs | covered |
| Supabase | supabase | covered |
| Drive | google-drive | covered |
| Dropbox | dropbox | covered |
| Box | box | covered |
| Gmail | gmail with `/users/me/messages` and `/users/me/messages/send` | covered |
| Docs | google-docs | covered |
| Sheets | google-sheets | covered |
| Slides | google-slides | covered |
| GitHub | github | covered |
| GitHub CI | github | covered |
| Vercel | vercel | covered |
| Linear | linear | covered |
| Trello | trello | covered |
| Notion | notion | covered |
| Slack | slack | covered |
| Discord | discord | covered |
| Telegram | telegram | covered |
| PostHog | posthog | covered |
| Langfuse | langfuse | covered |
| Postgres | postgres | covered |
| MongoDB | mongodb | covered |
| Email | smtp-imap | covered |
| Semantic Scholar | semantic-scholar | covered |
| OCI | s3-compatible configuration flag | covered by S3-compatible |
| Paperclip | semantic-scholar direct research adapter | covered by replacement |

The provider quickstart remains Nango/Pipedream/Composio while adapter packages stay a thin schema, path, webhook, and writeback layer.
