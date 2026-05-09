export const GITHUB_LAYOUT_PROMPT = `# GitHub Mount Layout

Always run \`ls\` before constructing a path. PR 0 standardizes human-readable leaf names to \`<sanitized-name>__<id>\`, so consumers should inspect the live repo directory instead of assuming a filename.

## Tree

\`/github/.layout.md\` is this guide.
\`/github/repos/_index.json\` lists materialized repositories.
\`/github/repos/<owner>/<repo>/issues/\` and \`/github/repos/<owner>/<repo>/pulls/\` each own a sibling \`_index.json\` plus per-record subdirectories.
\`pulls/<n>/diff.patch\`, \`pulls/<n>/files/**\`, and \`pulls/<n>/base/**\` are nested artifacts and should not be treated as canonical records.

## Indexes

\`/github/repos/_index.json\` rows use:

\`\`\`json
{ "id": "<owner/repo>", "title": "<owner/repo>", "updated": "<iso8601>" }
\`\`\`

\`issues/_index.json\` and \`pulls/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "number": 42, "state": "open" }
\`\`\`

## JSONL And Querying

GitHub does not emit JSONL in this adapter today. Canonical records are JSON files, and pull-request file trees are ordinary files.

Examples:

\`\`\`bash
ls /github/repos
jq '.[0]' /github/repos/_index.json
jq '.[] | {number, state, title}' /github/repos/octocat/hello-world/pulls/_index.json
grep -R "TODO" /github/repos/octocat/hello-world/pulls
\`\`\`
`;

export function githubLayoutPromptFile() {
  return {
    path: '/github/.layout.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: GITHUB_LAYOUT_PROMPT.endsWith('\n') ? GITHUB_LAYOUT_PROMPT : `${GITHUB_LAYOUT_PROMPT}\n`,
  };
}
