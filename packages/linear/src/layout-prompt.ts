export const LINEAR_LAYOUT_PROMPT = `# Linear Mount Layout

Always run \`ls\` before constructing a path. PR 0 standardizes human-readable leaf names to \`<sanitized-name>__<id>\`, so consumers should inspect the live directory instead of guessing a filename.

## Tree

\`/linear/LAYOUT.md\` is this guide.
\`/linear/issues/\`, \`/linear/comments/\`, \`/linear/users/\`, \`/linear/teams/\`, \`/linear/projects/\`, \`/linear/states/\`, \`/linear/cycles/\`, \`/linear/milestones/\`, and \`/linear/roadmaps/\` each own their canonical JSON records plus a sibling \`_index.json\`.
\`/linear/comments/<name>__<id>/meta.json\` is the canonical comment record (a directory record, so per-comment children such as reactions or threaded replies can nest under \`comments/<name>__<id>/\` without a file/directory collision).

Issue lookups: \`/linear/issues/by-uuid/<uuid>.json\` is the stable anchor (always emitted, keyed on the Linear UUID). \`/linear/issues/by-id/<TEAM-123>.json\` is the human-readable lookup keyed on the Linear identifier (only emitted when the issue has one). \`/linear/issues/by-title/<slug>.json\`, \`/linear/issues/by-state/<state>/<TEAM-123>.json\`, \`/linear/issues/by-assignee/<user-id>/<TEAM-123>.json\`, \`/linear/issues/by-creator/<user-id>/<TEAM-123>.json\`, \`/linear/issues/by-priority/<priority>/<TEAM-123>.json\`, and \`/linear/issues/by-edited/YYYY-MM-DD/<issue-uuid>.json\` are additional lookups. The edited-date bucket is formatted as \`YYYY-MM-DD\` and uses the first available timestamp in this order: \`updatedAt\`, \`updated_at\`, \`completedAt\`, \`canceledAt\`, \`createdAt\`, then \`created_at\`.

Writable resources advertise sibling schemas and create examples at \`discovery/linear/issues/.schema.json\`, \`discovery/linear/issues/.create.example.json\`, \`discovery/linear/issues/{issueId}/comments/.schema.json\`, and \`discovery/linear/issues/{issueId}/comments/.create.example.json\`.

## Indexes

\`/linear/issues/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "identifier": "<TEAM-123>", "state": "<state name>" }
\`\`\`

\`/linear/comments/_index.json\`, \`/linear/users/_index.json\`, \`/linear/teams/_index.json\`, \`/linear/projects/_index.json\`, \`/linear/states/_index.json\`, \`/linear/cycles/_index.json\`, \`/linear/milestones/_index.json\`, and \`/linear/roadmaps/_index.json\` use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>" }
\`\`\`

## JSONL And Querying

Linear does not emit JSONL in this adapter today. Comments are individual \`comments/<name>__<id>/meta.json\` directory records rather than \`comments.jsonl\`.

Examples:

\`\`\`bash
ls /linear/issues
jq '.[0]' /linear/issues/_index.json
jq '.[] | {identifier, state, title}' /linear/issues/_index.json
ls /linear/issues/by-assignee
ls /linear/issues/by-priority
ls /linear/issues/by-edited/2026-05-12
jq '.identifier' /linear/issues/by-edited/2026-05-12/11111111-1111-1111-1111-111111111111.json
jq '.[0]' /linear/states/_index.json
jq '.required' discovery/linear/issues/.schema.json
ls discovery/linear/issues/{issueId}/comments
grep -R "ENG-" /linear/comments
\`\`\`
`;

export function linearLayoutPromptFile() {
  return {
    path: '/linear/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: LINEAR_LAYOUT_PROMPT.endsWith('\n') ? LINEAR_LAYOUT_PROMPT : `${LINEAR_LAYOUT_PROMPT}\n`,
  };
}
