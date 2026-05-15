export const GITHUB_LAYOUT_PROMPT = `# GitHub Mount Layout

Always run \`ls\` before constructing a path. PR 0 standardizes issue and pull request directory names to \`<number>__<slug>\` (the GitHub number first, then a sanitized title slug), so consumers should inspect the live repo directory instead of assuming a filename.

## Tree

\`/github/LAYOUT.md\` is this guide.
\`/github/repos/_index.json\` lists materialized repositories.
\`/github/repos/<owner>/<repo>/issues/\` and \`/github/repos/<owner>/<repo>/pulls/\` each own a sibling \`_index.json\` plus per-record subdirectories named \`<number>__<slug>\`.
\`pulls/<number>__<slug>/diff.patch\`, \`pulls/<number>__<slug>/files/**\`, and \`pulls/<number>__<slug>/base/**\` are nested artifacts and should not be treated as canonical records.
Issue and pull request aliases include \`by-id/<number>.json\`, \`by-title/<slug>.json\`, and \`by-state/<state>/<number>.json\`.

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
ls /github/repos/octocat__hello-world/issues/by-state/open
grep -R "TODO" /github/repos/octocat/hello-world/pulls
\`\`\`
`;

export function githubLayoutPromptFile() {
  return {
    path: '/github/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: GITHUB_LAYOUT_PROMPT.endsWith('\n') ? GITHUB_LAYOUT_PROMPT : `${GITHUB_LAYOUT_PROMPT}\n`,
  };
}
