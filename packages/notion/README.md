# @relayfile/adapter-notion

Relayfile adapter for Notion. It ingests databases, pages, blocks, markdown content, and comments into the relayfile VFS and supports writeback for page properties, markdown content, comments, and page creation inside databases.

## Quick Start

```bash
npm install
npm test
npm run build
```

```ts
import { RelayFileClient } from '@relayfile/sdk';
import { NotionAdapter } from '@relayfile/adapter-notion';

const relay = new RelayFileClient({
  baseUrl: process.env.RELAYFILE_BASE_URL ?? 'https://api.relayfile.com',
  token: process.env.RELAYFILE_TOKEN ?? '',
});

const adapter = new NotionAdapter(relay, undefined, {
  token: process.env.NOTION_TOKEN ?? '',
  databaseIds: ['database-id'],
  pageIds: ['page-id'],
});

await adapter.bulkIngest('workspace-id');
```

Create a Notion internal integration in the Notion developer dashboard, grant it access to the target databases/pages, and use the integration token as `NOTION_TOKEN`.

## VFS Layout

```text
/notion/databases/{database_id}/metadata.json
/notion/databases/{database_id}/pages/{page_id}.json
/notion/databases/{database_id}/pages/{page_id}/content.md
/notion/databases/{database_id}/pages/{page_id}/blocks/{block_id}.json
/notion/databases/{database_id}/pages/{page_id}/comments.json
/notion/pages/{page_id}.json
/notion/pages/{page_id}/content.md
/notion/pages/{page_id}/comments.json
```

## Supported Property Types

Writeable property serializers are included for:

- `title`
- `rich_text`
- `number`
- `select`
- `multi_select`
- `status`
- `date`
- `people`
- `files`
- `checkbox`
- `url`
- `email`
- `phone_number`
- `relation`

Read-only Notion properties such as `formula`, `rollup`, `created_time`, and `last_edited_time` are preserved in ingested JSON but rejected during writeback.

## Markdown Content Support

The adapter uses the Notion markdown content endpoints when enabled and falls back to rendering block trees when those endpoints are unavailable. Notion’s current markdown endpoints are `GET /v1/pages/{page_id}/markdown` and `PATCH /v1/pages/{page_id}/markdown`, and the adapter defaults those calls to `Notion-Version: 2026-03-11`.

Classic database/page/block APIs still default to `Notion-Version: 2022-06-28` because that version preserves the legacy database schema and `POST /v1/databases/{id}/query` behavior this package targets. Override either version through `apiVersion` and `markdownApiVersion` if your workspace needs a different combination.

## Poll-Based Sync

Notion webhooks are not broadly available across all plans, so the adapter includes poll-based sync helpers:

- Database pages are queried with `last_edited_time > cursor`.
- Standalone pages are scanned through `POST /v1/search`, sorted by `last_edited_time`.
- The sync cursor is an ISO timestamp watermark.

## Writeback

- Editing `*.json` page files maps to `PATCH /v1/pages/{page_id}`.
- Editing `content.md` maps to `PATCH /v1/pages/{page_id}/markdown`.
- Editing `comments.json` creates a new comment with `POST /v1/comments`.
- Writing to `/notion/databases/{database_id}/pages` creates a new page with `POST /v1/pages`.
