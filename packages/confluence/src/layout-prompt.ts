export const CONFLUENCE_LAYOUT_PROMPT = `# Confluence Mount Layout

Always run \`ls\` before constructing a path. v2 standardizes human-readable leaf names to \`<sanitized-title>__<id>\`, so consumers should inspect the live directory instead of guessing a filename.

## Tree

\`/confluence/LAYOUT.md\` is this guide.
\`/confluence/pages/\` and \`/confluence/spaces/\` each own their canonical JSON records plus a sibling \`_index.json\` and the \`by-*\` alias subtrees described below.
Space-scoped pages also materialize under \`/confluence/spaces/<spaceId>/pages/<title>__<pageId>.json\` so an agent can resolve a page by its containing space.

## Indexes

\`/confluence/pages/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "spaceId": "<spaceId>", "status": "<page status>" }
\`\`\`

\`/confluence/spaces/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "key": "<space key>" }
\`\`\`

## Page Aliases

Every page is duplicated into the \`by-*\` paths below — they all resolve to identical JSON bytes. Use whichever lookup primitive you have at hand:

- Canonical: \`/confluence/pages/<title>__<pageId>.json\` (or the space-scoped \`/confluence/spaces/<spaceId>/pages/...\` variant).
- By id: \`/confluence/pages/by-id/<pageId>.json\` — stable when the title changes.
- By title: \`/confluence/pages/by-title/<sanitized-title>.json\` — last writer wins on title collisions; compute the disambiguated form with \`confluencePageByTitleAliasPath(title, id, true)\` for guaranteed uniqueness (8-char hex suffix on the id).
- By state: \`/confluence/pages/by-state/<status>/<pageId>.json\` — \`current\`, \`draft\`, \`archived\`, or \`trashed\` (v2 documents only \`current|draft\`; archive/trash variants surface in real mounts).
- By space: \`/confluence/pages/by-space/<spaceId>/<pageId>.json\` — flat sibling of the space-scoped canonical tree so \`ls\` works without slug resolution.
- By parent: \`/confluence/pages/by-parent/<parentId>/<pageId>.json\` — only emitted when \`payload.parentId\` is present (top-level pages have no parent record).

## Space Aliases

- Canonical: \`/confluence/spaces/<name>__<spaceId>.json\`.
- By id: \`/confluence/spaces/by-id/<spaceId>.json\`.
- By title: \`/confluence/spaces/by-title/<sanitized-name>.json\`.
- By key: \`/confluence/spaces/by-key/<KEY>.json\` — the globally-unique human-meaningful space key (e.g. \`ENG\`). Mirrors the v2 \`GET /spaces?keys=\` filter.

## JSONL And Querying

Confluence does not emit JSONL in this adapter today. Each page and space is a standalone \`.json\` record, duplicated verbatim into every alias path it qualifies for.

Examples:

\`\`\`bash
# List every page in a space without resolving titles
ls /confluence/pages/by-space/12345/

# Look up a space by its stable Confluence key
jq '.payload | {id, name, homepageId}' /confluence/spaces/by-key/ENG.json

# Iterate drafts pending review
ls /confluence/pages/by-state/draft/
jq '.payload.title' /confluence/pages/by-state/draft/*.json

# Walk a page's children
ls /confluence/pages/by-parent/98765/
jq '.payload | {id, title, status}' /confluence/pages/by-parent/98765/*.json

# Sorted snapshot from the canonical index
jq '.[] | {id, title, status}' /confluence/pages/_index.json
\`\`\`
`;

export function confluenceLayoutPromptFile() {
  return {
    path: '/confluence/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: CONFLUENCE_LAYOUT_PROMPT.endsWith('\n') ? CONFLUENCE_LAYOUT_PROMPT : `${CONFLUENCE_LAYOUT_PROMPT}\n`,
  };
}
