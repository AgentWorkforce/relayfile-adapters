/**
 * 062-notion-adapter.ts
 *
 * Build @relayfile/adapter-notion — full Notion adapter.
 *
 * Notion API: https://developers.notion.com/reference/intro
 * Docs index: https://developers.notion.com/llms.txt
 *
 * Notion is a knowledge management category adapter. Its data model:
 *   Workspaces → Databases → Pages → Blocks (content tree)
 *   Pages have Properties (typed fields from database schema)
 *   Comments live on pages and blocks
 *   No native webhooks — uses polling or third-party (Zapier/Make)
 *   BUT: Notion has a "webhook" beta + SIEM events for enterprise
 *
 * Run: npx tsx workflows/062-notion-adapter.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const ROOT = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-notion';
const SDK_ROOT = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const LINEAR_ADAPTER = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-linear';

async function main() {
  const result = await workflow('notion-adapter')
    .description('Build @relayfile/adapter-notion — full Notion database, page, and content adapter')
    .pattern('linear')
    .channel('wf-notion-adapter')
    .maxConcurrency(2)
    .timeout(3_600_000)

    .agent('architect', { cli: 'claude', role: 'Designs the Notion adapter from API docs' })
    .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements the full adapter' })
    .agent('reviewer', { cli: 'codex', preset: 'worker', role: 'Reviews and tests' })

    .step('design', {
      agent: 'architect',
      task: `Design @relayfile/adapter-notion based on the Notion API.

READ the Linear adapter for reference (project management category sibling):
- ${LINEAR_ADAPTER}/src/

READ the relayfile SDK:
- ${SDK_ROOT}/packages/sdk/typescript/src/provider.ts — IntegrationProvider
- ${SDK_ROOT}/packages/sdk/typescript/src/types.ts — WebhookInput

FETCH Notion API docs (they have an llms.txt!):
- https://developers.notion.com/llms.txt
- https://developers.notion.com/reference/intro
- https://developers.notion.com/reference/post-database-query
- https://developers.notion.com/reference/retrieve-a-page
- https://developers.notion.com/reference/get-block-children
- https://developers.notion.com/reference/create-comment
- https://developers.notion.com/reference/post-search
- https://developers.notion.com/guides/data-apis/working-with-databases.md
- https://developers.notion.com/guides/data-apis/working-with-page-content.md
- https://developers.notion.com/guides/data-apis/working-with-markdown-content.md

Design the adapter:

**1. VFS Path Mapping**:
Notion's hierarchy: workspace → databases → pages → blocks
\`\`\`
/notion/databases/{database_id}/metadata.json         — database schema (properties)
/notion/databases/{database_id}/pages/{page_id}.json  — page with all properties
/notion/databases/{database_id}/pages/{page_id}/content.md  — page content as markdown
/notion/databases/{database_id}/pages/{page_id}/blocks/{block_id}.json — individual block
/notion/databases/{database_id}/pages/{page_id}/comments.json — page comments
/notion/pages/{page_id}.json                          — standalone page (no database)
/notion/pages/{page_id}/content.md                    — standalone page content
/notion/pages/{page_id}/comments.json                 — comments
\`\`\`

**2. Notion data model concepts**:
- Databases have a schema (properties: title, rich_text, number, select, multi_select, 
  date, people, files, checkbox, url, email, phone, formula, relation, rollup, status, etc.)
- Pages are rows in a database, each with property values matching the schema
- Page content = tree of blocks (paragraph, heading, bulleted_list, numbered_list, 
  to_do, toggle, code, image, table, callout, quote, divider, etc.)
- Blocks can be nested (children)
- Comments can be on pages or specific blocks (discussion_id)
- Search: POST /v1/search — full-text across all accessible pages

**3. Content format**:
- Notion API returns block trees (rich_text arrays with annotations)
- The adapter should also support the NEW markdown endpoints:
  GET /v1/blocks/{page_id}/markdown — returns page content as enhanced markdown
  PATCH /v1/blocks/{page_id}/markdown — update page content from markdown
- Store both: blocks as JSON, content as markdown

**4. Webhooks (Notion has real webhooks!)**:
FETCH: https://developers.notion.com/reference/webhooks
- Subscription created via integration settings (not API — dashboard only)
- Events: page.content_updated, page.created, page.deleted, page.property_updated, page.moved, database.created, database.updated, etc.
- POST to your endpoint with { type, data: { page_id, ... }, timestamp }
- HMAC signature verification (X-Notion-Signature header)
- The adapter MUST support webhook ingestion as the primary path
- NO polling fallback — the provider (Nango/Composio) handles webhook registration and token refresh
- The adapter only processes incoming webhook events, never polls the Notion API directly

**5. Writeback rules**:
- /notion/.../pages/{id}.json → PATCH /v1/pages/{id} (update properties)
- /notion/.../pages/{id}/content.md → PATCH /v1/blocks/{id}/markdown (update content)
- /notion/.../comments.json → POST /v1/comments (create comment)
- /notion/databases/{id}/pages/ → POST /v1/pages (create new page in database)

**6. Auth**:
- Bearer token (internal integration) OR OAuth2 (public integration)
- Header: Authorization: Bearer {token}, Notion-Version: 2022-06-28
- All requests need Notion-Version header

**7. File structure**:
\`\`\`
src/
  adapter.ts          — NotionAdapter extends IntegrationAdapter
  types.ts            — Notion types (Database, Page, Block, Property, etc.)
  path-mapper.ts      — computePath()
  databases/
    ingestion.ts      — database schema + page query ingestion
    query.ts          — database query builder (filters, sorts)
  pages/
    ingestion.ts      — page property ingestion
    properties.ts     — property value serialization/deserialization
  content/
    blocks.ts         — block tree traversal and ingestion
    markdown.ts       — markdown endpoint support
    renderer.ts       — blocks → markdown fallback renderer
  comments/
    ingestion.ts      — comment ingestion
  webhook/
    handler.ts        — webhook event processor
    verify.ts         — HMAC signature verification (X-Notion-Signature)
  search.ts           — full-text search wrapper (on-demand, not polling)
  writeback.ts        — VFS path → Notion API endpoint
  bulk-ingest.ts      — full database/workspace ingestion
notion.mapping.yaml
\`\`\`

Keep output under 80 lines. End with DESIGN_COMPLETE.`,
      verification: { type: 'output_contains', value: 'DESIGN_COMPLETE' },
      timeout: 300_000,
    })

    .step('implement', {
      agent: 'builder',
      dependsOn: ['design'],
      task: `Implement @relayfile/adapter-notion — the full Notion adapter.

Design: {{steps.design.output}}

Working in ${ROOT}.

Build ALL components:
1. notion.mapping.yaml
2. src/types.ts — Notion types (rich_text, property types, block types, etc.)
3. src/adapter.ts — NotionAdapter class
4. src/path-mapper.ts — computePath()
5. src/databases/ — schema ingestion, query builder with filter/sort support
6. src/pages/ — page ingestion, property value serialization
7. src/content/ — block tree traversal, markdown support (both new API and fallback renderer)
8. src/comments/ — comment ingestion
9. src/search.ts — POST /v1/search wrapper
10. src/writeback.ts — path → Notion API endpoint
12. src/bulk-ingest.ts — full database ingestion
13. src/index.ts

Key implementation details:
- All requests need: Authorization: Bearer {token} + Notion-Version: 2022-06-28
- Pagination: cursor-based (start_cursor + has_more)
- Rich text: array of { type, text: { content, link }, annotations: { bold, italic, ... } }
- Block types: paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item,
  to_do, toggle, code, image, table, callout, quote, divider, bookmark, embed, etc.
- Nested blocks: GET /v1/blocks/{id}/children (recursive)
- Database query: POST /v1/databases/{id}/query with filter object and sorts array
- Property types need individual serializers (title, rich_text, number, select, 
  multi_select, date, people, relation, formula, rollup, status, checkbox, url, etc.)
- Markdown content API: GET/PATCH /v1/blocks/{page_id}/markdown (Notion-flavored markdown)

Tests:
- Path mapping for databases, pages, blocks, comments
- Property value serialization for each type
- Block tree → markdown rendering
- Database query filter building
- Writeback rule matching
- Webhook event normalization for each event type

README with:
- Quick start (create integration, get token)
- VFS path structure
- Supported property types
- Markdown content support
- Webhook events supported
- Why there's no polling (provider handles webhook lifecycle)

npm install, build check, commit feat/full-adapter, push.
End with IMPLEMENT_COMPLETE.`,
      verification: { type: 'output_contains', value: 'IMPLEMENT_COMPLETE' },
      timeout: 1_200_000,
    })

    .step('review', {
      agent: 'reviewer',
      dependsOn: ['implement'],
      task: `Review @relayfile/adapter-notion in ${ROOT}.
Verify:
- All property types handled (title, rich_text, number, select, multi_select, 
  date, people, files, checkbox, url, email, phone, formula, relation, rollup, status)
- Block tree recursion handles nested blocks
- Markdown rendering covers all common block types
- Database query builder supports compound filters (and/or)
- Notion-Version header on all requests
- Pagination with start_cursor
- Webhook-only (no polling — provider handles webhook lifecycle)
- Writeback for page properties, content (markdown), and comments
- No hardcoded tokens
- Tests for each component
Fix issues. Keep under 50 lines. End with REVIEW_COMPLETE.`,
      verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
      timeout: 300_000,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: ROOT });

  console.log('Notion adapter complete:', result.status);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
