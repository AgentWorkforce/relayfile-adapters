import { xLayoutPath } from './path-mapper.js';

export const X_LAYOUT_PROMPT = `# X Mount Layout

Always inspect the live tree with \`ls\` before constructing paths. The X adapter is intentionally search-first and budget-aware: it does not mirror global X/Twitter data. It materializes explicit saved searches, the posts returned by those searches, and only the user profiles included by an opt-in hydration policy.

## Tree

\`/x/LAYOUT.md\` is this guide.
\`/x/_index.json\` lists the top-level resource roots: \`searches\`, \`posts\`, and \`users\`.
\`/x/searches/\` stores saved search runs as directory records because each search owns child result pointers. The canonical search path is \`/x/searches/<searchId>__<query-slug>/meta.json\`.
\`/x/searches/<searchId>__<query-slug>/results/\` stores one result pointer per matched post plus a local \`_index.json\` sorted by rank.
\`/x/posts/\` stores canonical post records as flat \`<text-slug>__<postId>.json\` files.
\`/x/users/\` stores optional hydrated user records as flat \`<username-or-name-slug>__<userId>.json\` files.

## Indexes

\`/x/searches/_index.json\` rows use:

\`\`\`json
{ "id": "<search id>", "title": "<label>", "updated": "<iso8601>", "query": "<x query>", "mode": "recent", "resultCount": 25, "estimatedUsd": 0.25 }
\`\`\`

\`/x/posts/_index.json\` rows use:

\`\`\`json
{ "id": "<post id>", "title": "<post text excerpt>", "updated": "<created_at>", "authorId": "<user id>", "username": "<handle>", "conversationId": "<conversation id>", "lang": "en" }
\`\`\`

\`/x/users/_index.json\` rows use:

\`\`\`json
{ "id": "<user id>", "title": "<display name>", "updated": "", "username": "<handle>", "verified": true }
\`\`\`

Indexes are sorted by \`updated\` descending when timestamps exist. Search result indexes are sorted by rank because they represent a single query page rather than a provider lifecycle stream.

## Aliases

Search aliases are materialized mirrors of the search \`meta.json\` envelope:

- \`/x/searches/by-id/<searchId>.json\`
- \`/x/searches/by-query/<query-slug>__<searchId>.json\`

Post aliases are materialized mirrors of the canonical post envelope:

- \`/x/posts/by-id/<postId>.json\`
- \`/x/posts/by-author/<author-id-or-username>/<postId>.json\`
- \`/x/posts/by-conversation/<conversationId>/<postId>.json\`
- \`/x/posts/by-query/<searchId>/<postId>.json\`

User aliases are materialized mirrors of the canonical user envelope:

- \`/x/users/by-id/<userId>.json\`
- \`/x/users/by-username/<username-slug>__<userId>.json\`

Aliases use the shared \`<slug>__<id>\` joiner and slug normalization from \`@relayfile/adapter-core\`. Search result files are minimal pointers with \`{ searchId, postId, rank, canonicalPath, query }\`; follow \`canonicalPath\` to read the full post.

## Cost Controls

The adapter expects callers to set per-run budgets before contacting X:

\`\`\`json
{ "budgetUsd": 2.5, "maxPostReads": 300, "maxUserReads": 25 }
\`\`\`

The search client defaults to recent search, requests only useful post fields, includes authors only up to the configured user cap, and stops before a page request would cross the configured budget. Full-archive search is represented as \`mode: "archive"\` and should be treated as a premium opt-in.

## Examples

\`\`\`bash
ls /x
ls /x/searches
ls /x/posts/by-query
jq '.[0]' /x/searches/_index.json
jq '.[] | {id, title, estimatedUsd}' /x/searches/_index.json
jq '.[] | select(.lang == "en") | {id, username, title}' /x/posts/_index.json
jq '{query, costEstimate}' /x/searches/<searchId>__<query-slug>/meta.json
jq '.[0]' /x/searches/<searchId>__<query-slug>/results/_index.json
\`\`\`
`;

export function xLayoutPromptFile() {
  return {
    path: xLayoutPath(),
    contentType: 'text/markdown; charset=utf-8' as const,
    content: X_LAYOUT_PROMPT.endsWith('\n') ? X_LAYOUT_PROMPT : `${X_LAYOUT_PROMPT}\n`,
  };
}
