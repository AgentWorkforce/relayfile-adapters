export const CONFLUENCE_LAYOUT_PROMPT = `# Confluence Mount Layout

Always run \`ls\` before constructing a path. v2 standardizes human-readable leaf names to \`<sanitized-title>__<id>\`, so consumers should inspect the live directory instead of guessing a filename.

## Tree

\`/confluence/LAYOUT.md\` is this guide.
\`/confluence/pages/\` and \`/confluence/spaces/\` each own their canonical JSON records plus a sibling \`_index.json\` and alias subtrees.
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

## Aliases

Pages are addressable through three parallel paths that all resolve to identical JSON bytes:

- Canonical: \`/confluence/pages/<title>__<pageId>.json\` (or the space-scoped variant).
- By id: \`/confluence/pages/by-id/<pageId>.json\` — stable when the title changes.
- By title: \`/confluence/pages/by-title/<sanitized-title>.json\` — collisions get an 8-char hash suffix.
- By state: \`/confluence/pages/by-state/<status>/<pageId>.json\` — \`current\`, \`draft\`, \`archived\`, or \`trashed\`.

Spaces follow the same pattern under \`/confluence/spaces/by-id/\` and \`/confluence/spaces/by-title/\`.

## JSONL And Querying

Confluence does not emit JSONL in this adapter today. Each page and space is a standalone \`.json\` record.

Examples:

\`\`\`bash
ls /confluence/pages
jq '.[0]' /confluence/pages/_index.json
jq '.[] | {id, title, status}' /confluence/pages/_index.json
grep -R "Release plan" /confluence/pages
\`\`\`
`;

export function confluenceLayoutPromptFile() {
  return {
    path: '/confluence/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: CONFLUENCE_LAYOUT_PROMPT.endsWith('\n') ? CONFLUENCE_LAYOUT_PROMPT : `${CONFLUENCE_LAYOUT_PROMPT}\n`,
  };
}
