export const LINEAR_LAYOUT_PROMPT = `# Linear Mount Layout

Always run \`ls\` before constructing a path. PR 0 standardizes human-readable leaf names to \`<sanitized-name>__<id>\`, so consumers should inspect the live directory instead of guessing a filename.

## Tree

\`/linear/LAYOUT.md\` is this guide.
\`/linear/issues/\`, \`/linear/comments/\`, \`/linear/users/\`, \`/linear/teams/\`, \`/linear/projects/\`, \`/linear/cycles/\`, \`/linear/milestones/\`, and \`/linear/roadmaps/\` each own their canonical JSON records plus a sibling \`_index.json\`.

Issue lookups: \`/linear/issues/by-uuid/<uuid>.json\` is the stable anchor (always emitted, keyed on the Linear UUID). \`/linear/issues/by-id/<TEAM-123>.json\` is the human-readable lookup keyed on the Linear identifier (only emitted when the issue has one). \`/linear/issues/by-title/<slug>.json\` and \`/linear/issues/by-state/<state>/<TEAM-123>.json\` are additional lookups.

## Indexes

\`/linear/issues/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "identifier": "<TEAM-123>", "state": "<state name>" }
\`\`\`

\`/linear/comments/_index.json\`, \`/linear/users/_index.json\`, \`/linear/teams/_index.json\`, \`/linear/projects/_index.json\`, \`/linear/cycles/_index.json\`, \`/linear/milestones/_index.json\`, and \`/linear/roadmaps/_index.json\` use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>" }
\`\`\`

## JSONL And Querying

Linear does not emit JSONL in this adapter today. Comments are individual \`.json\` records rather than \`comments.jsonl\`.

Examples:

\`\`\`bash
ls /linear/issues
jq '.[0]' /linear/issues/_index.json
jq '.[] | {identifier, state, title}' /linear/issues/_index.json
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
