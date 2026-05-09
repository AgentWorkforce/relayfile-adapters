import type { NotionVfsFile } from './types.js';

export const NOTION_LAYOUT_PROMPT = `# Notion Mount Layout

Always run \`ls\` on the live directory before constructing a path. Page and database titles can collide, and PR 0 standardizes the human-readable leaf convention to \`<sanitized-name>__<id>\`.

## Tree

\`/notion/.layout.md\` is this guide.
\`/notion/pages/\` holds standalone page records, their \`_index.json\`, and nested page artifacts such as \`content.md\`, \`comments.json\`, and \`blocks/*.json\`.
\`/notion/databases/\` holds one directory per database, a root \`_index.json\`, and per-database \`pages/_index.json\` files for the database page collections.

## Indexes

\`/notion/pages/_index.json\` lists standalone pages.
\`/notion/databases/_index.json\` lists databases.
\`/notion/databases/<database>/pages/_index.json\` lists the pages under one database.

Each row is tiny and stable:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>" }
\`\`\`

## JSON And Querying

Notion does not emit JSONL subtrees today. Comments are JSON arrays in \`comments.json\`, and canonical records are JSON files.

Examples:

\`\`\`bash
ls /notion/pages
jq '.[0]' /notion/pages/_index.json
jq '.[] | {id, title, updated}' /notion/databases/_index.json
grep -R \"keyword\" /notion/pages
\`\`\`
`;

export function notionLayoutPromptFile(): NotionVfsFile {
  return {
    path: '/notion/.layout.md',
    contentType: 'text/markdown; charset=utf-8',
    content: NOTION_LAYOUT_PROMPT.endsWith('\n') ? NOTION_LAYOUT_PROMPT : `${NOTION_LAYOUT_PROMPT}\n`,
  };
}
