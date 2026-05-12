import type { NotionVfsFile } from './types.js';

export const NOTION_LAYOUT_PROMPT = `# Notion Mount Layout

\`/notion/\` mirrors your Notion workspace as a file tree. Pages, databases,
and users are stored as JSON; page bodies live next to their record as
\`content.md\`. Always \`ls\` a directory before constructing a path —
titles can collide and the canonical filenames append a UUID suffix.

> Notion writes (PATCH /v1/pages/{id}, POST /v1/comments, etc.) require
> the canonical UUID, never a title. The \`by-*\` alias subtrees below
> exist so an agent can look up a UUID by name without scanning the
> whole workspace. Resolve, then write:
>
> \`\`\`bash
> id=$(jq -r '.id' /notion/pages/by-title/launch-checklist__a1b2c3d4.json)
> # now PATCH /v1/pages/$id
> \`\`\`

## Tree

\`\`\`
/notion/
├── LAYOUT.md                          ← this guide
├── pages/                             ← standalone pages (not in a database)
│   ├── _index.json                    ← { id, title, updated, parent_id, parent_type }
│   ├── <slug>__<id>.json              ← canonical page record (UUID-named)
│   ├── <slug>__<id>/
│   │   ├── content.md                 ← page body as markdown
│   │   ├── comments.json              ← page comments
│   │   └── blocks/<block-id>.json     ← raw block JSON
│   ├── by-id/<dehyphenated-uuid>.json ← duplicate canonical record, keyed by UUID
│   ├── by-title/<slug>__<short_id>.json
│   ├── by-database/<db-slug>__<db_short>/<page-slug>__<short>.json
│   └── by-parent/<page|database>-<parent-slug>__<short>/<page-slug>__<short>.json
├── databases/
│   ├── _index.json
│   ├── <slug>__<id>/
│   │   ├── metadata.json              ← database schema + title + properties
│   │   └── pages/
│   │       ├── _index.json
│   │       └── <slug>__<id>.json      ← rows in this database
│   ├── by-id/<dehyphenated-uuid>.json
│   └── by-title/<slug>__<short_id>.json
└── users/
    ├── _index.json
    ├── <slug>__<id>.json
    ├── by-id/<dehyphenated-uuid>.json
    └── by-name/<slug>__<short_id>.json
\`\`\`

## UUID-stability promise

Notion UUIDs are immutable; titles are not. A user can rename "Tasks" to
"Backlog" at any time, which would silently break any path that encodes
the title alone. We append \`__<short_id>\` (last 8 hex chars of the
canonical UUID) to every alias filename so:

  1. Two pages with the same title cannot clobber each other.
  2. An agent holding only the UUID can compute the alias filename
     locally — no index scan required.
  3. A title rename invalidates the *alias*, not the canonical record at
     \`pages/<slug>__<id>.json\`, so writeback against the canonical path
     keeps working through renames.

## Indexes

Every \`_index.json\` row carries both the UUID and the human-readable
fields, so an agent can resolve a UUID with a single jq query:

\`\`\`json
{
  "id": "<uuid>",
  "title": "<human-readable>",
  "updated": "<iso8601>",
  "parent_id": "<uuid|null>",
  "parent_type": "database|page|workspace"
}
\`\`\`

For \`/notion/users/_index.json\`, \`title\` carries the user's display name.
For database rows, \`parent_id\` is \`null\` and \`parent_type\` is
\`"workspace"\` because Notion's API does not surface a stable parent for
databases.

## Alias subtrees (each is load-bearing for writes)

### \`/notion/pages/by-title/<slug>__<short_id>.json\`
Title lookup for standalone pages. Notion permits duplicate titles, so
the \`__<short_id>\` suffix is **mandatory** — agents construct it from
the last 8 hex characters of the canonical UUID.

### \`/notion/pages/by-id/<dehyphenated-uuid>.json\`
UUID lookup. The filename is the 32-char dehyphenated form of the
canonical UUID (e.g. \`a1b2c3d4e5f6...\`), recoverable to the
\`8-4-4-4-12\` API form by reinserting hyphens.

### \`/notion/pages/by-database/<db-slug>__<db_short>/<page-slug>__<short>.json\`
Pages scoped to their parent database. The "find the row in my Tasks
database titled 'X'" lookup:

\`\`\`bash
ls /notion/pages/by-database/tasks__a1b2c3d4/
jq -r '.id' /notion/pages/by-database/tasks__a1b2c3d4/launch-checklist__deadbeef.json
\`\`\`

### \`/notion/pages/by-parent/<type>-<parent-slug>__<short>/<page-slug>__<short>.json\`
Child pages under a parent page (Notion's hierarchical workspace
model). The \`<type>-\` prefix is one of \`page-\` or \`database-\` so an
agent can tell the parent shape from the path alone. Workspace-rooted
pages are intentionally **not** materialized under \`by-parent\` because
the workspace bucket would collect every top-level page and lose its
navigational value — use \`/notion/pages/_index.json\` instead.

### \`/notion/databases/by-title/<slug>__<short_id>.json\`
Database title lookup. Same shape and collision-handling as the page
by-title alias.

### \`/notion/users/by-name/<slug>__<short_id>.json\`
User display-name lookup. Critical because Notion lets multiple users
share a display name (especially when bot integrations name themselves
after the human installer).

## Writes: alias → UUID → API

\`\`\`bash
# 1. Resolve the page UUID from its title
id=$(jq -r '.id' /notion/pages/by-title/launch-checklist__a1b2c3d4.json)

# 2. Or resolve via the database-scoped lookup
id=$(jq -r '.id' /notion/pages/by-database/tasks__deadbeef/launch-checklist__a1b2c3d4.json)

# 3. Use the resolved UUID in a Notion API call
curl -X PATCH "https://api.notion.com/v1/pages/$id" -d '{ "archived": true }'
\`\`\`

When writing back through the relayfile mount itself, the canonical path
encodes the UUID — \`PATCH /notion/pages/<slug>__<id>.json\` — so writeback
strips the slug and recovers the UUID from the trailing 32-hex segment
(see \`writeback.ts:extractNotionId\`).

## Common commands

\`\`\`bash
# List databases
jq '.[] | {title, id}' /notion/databases/_index.json

# Find every page in the "Engineering Wiki" database
ls /notion/pages/by-database/engineering-wiki__<db_short>/

# Find every direct child of a parent page
ls /notion/pages/by-parent/page-<parent-slug>__<short>/

# Resolve a user UUID by name
jq -r '.id' /notion/users/by-name/alice-chen__a1b2c3d4.json

# Browse raw notion records
ls /notion/pages
jq '.[0]' /notion/pages/_index.json
grep -R "keyword" /notion/pages
\`\`\`
`;

export function notionLayoutPromptFile(): NotionVfsFile {
  return {
    path: '/notion/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: NOTION_LAYOUT_PROMPT.endsWith('\n') ? NOTION_LAYOUT_PROMPT : `${NOTION_LAYOUT_PROMPT}\n`,
  };
}
