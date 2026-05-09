export const LINEAR_LAYOUT_PROMPT = `# Linear Mount Layout

Always run \`ls\` before constructing a path. PR 0 standardizes human-readable leaf names to \`<sanitized-name>__<id>\`, so consumers should inspect the live directory instead of guessing a filename.

## Tree

\`/linear/.layout.md\` is this guide.
\`/linear/issues/\`, \`/linear/comments/\`, \`/linear/users/\`, and \`/linear/teams/\` each own their canonical JSON records plus a sibling \`_index.json\`.
Other integration-owned trees include \`/linear/projects/\`, \`/linear/cycles/\`, \`/linear/milestones/\`, and \`/linear/roadmaps/\`.

## Indexes

\`/linear/issues/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "identifier": "<TEAM-123>", "state": "<state name>" }
\`\`\`

\`/linear/comments/_index.json\`, \`/linear/users/_index.json\`, and \`/linear/teams/_index.json\` use:

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
    path: '/linear/.layout.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: LINEAR_LAYOUT_PROMPT.endsWith('\n') ? LINEAR_LAYOUT_PROMPT : `${LINEAR_LAYOUT_PROMPT}\n`,
  };
}
