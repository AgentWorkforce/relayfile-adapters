export const GITHUB_LAYOUT_PROMPT = `# GitHub Mount Layout

Always run \`ls\` before constructing a path. PR 0 standardizes issue and pull request directory names to \`<number>__<slug>\` (the GitHub number first, then a sanitized title slug), so consumers should inspect the live repo directory instead of assuming a filename.

## Tree

\`/github/LAYOUT.md\` is this guide.
\`/github/repos/_index.json\` lists materialized repositories.
\`/github/repos/<owner>/<repo>/issues/\` and \`/github/repos/<owner>/<repo>/pulls/\` each own a sibling \`_index.json\` plus per-record subdirectories named \`<number>__<slug>\`.
\`issues/<number>__<slug>/comments/<commentId>/meta.json\` holds issue comment records (each a directory record, so per-comment children such as reactions can nest under \`comments/<commentId>/\` without a file/directory collision).
\`pulls/<number>__<slug>/diff.patch\`, \`pulls/<number>__<slug>/files/**\`, and \`pulls/<number>__<slug>/base/**\` are nested artifacts and should not be treated as canonical records.
Issue and pull request aliases are materialized under \`/github/repos/<owner>__<repo>/<issues|pulls>/...\`, distinct from the canonical \`/github/repos/<owner>/<repo>/...\` tree. Alias views include \`by-id/<number>.json\`, \`by-title/<slug>__<number>.json\`, \`by-state/<state>/<number>.json\`, \`by-assignee/<assignee>/<number>.json\`, \`by-creator/<creator>/<number>.json\`, \`by-priority/<priority>/<number>.json\`, and \`by-edited/YYYY-MM-DD/<number>.json\`. The edited-date bucket uses the provider update timestamp, or a merge/close timestamp when that is the most recent activity-summary fallback date.

Programmatic consumers that need to parse issue or pull request read-mount paths should import \`parseGitHubRepoPath\`, \`parseGitHubIssuePath\`, or \`parseGitHubPullPath\` from \`@relayfile/adapter-github/path-mapper\`. \`@relayfile/relay-helpers\` is not the right abstraction for read-mount parsing; it provides ergonomic write clients, while these parser helpers are the adapter-owned path contract.

Writable resources advertise sibling schemas and create examples at \`discovery/github/repos/{owner}/{repo}/issues/.schema.json\`, \`discovery/github/repos/{owner}/{repo}/issues/.create.example.json\`, \`discovery/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/.schema.json\`, \`discovery/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/.create.example.json\`, \`discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/.schema.json\`, and \`discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/.create.example.json\`. To merge a pull request, write \`{"method":"squash"}\` or another valid merge payload to \`/github/repos/<owner>/<repo>/pulls/<number>/merge.json\`.

## Indexes

\`/github/repos/_index.json\` rows use:

\`\`\`json
{ "id": "<owner/repo>", "title": "<owner/repo>", "updated": "<iso8601>" }
\`\`\`

\`issues/_index.json\` and \`pulls/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "number": 42, "state": "open", "labels": ["factory"] }
\`\`\`

\`labels\` carries the issue's label names inline so you can filter on the index without opening every \`meta.json\` (e.g. \`jq '.[] | select(.labels | index("factory"))'\`). It is present on issue rows; pull rows may omit it. Merged pull rows additionally carry \`"merged": true\` and \`"mergedAt": "<iso8601>"\`; issues and unmerged pulls omit both fields.

## JSONL And Querying

GitHub does not emit JSONL in this adapter today. Canonical records are JSON files, and pull-request file trees are ordinary files.

Examples:

\`\`\`bash
ls /github/repos
jq '.[0]' /github/repos/_index.json
jq '.[] | {number, state, title}' /github/repos/octocat/hello-world/pulls/_index.json
jq '.[] | select(.mergedAt != null) | {number, title, mergedAt}' /github/repos/octocat/hello-world/pulls/_index.json
jq '.[] | select(.labels | index("factory"))' /github/repos/octocat/hello-world/issues/_index.json
ls /github/repos/octocat__hello-world/issues/by-state/open
ls /github/repos/octocat__hello-world/issues/by-assignee/octocat
ls /github/repos/octocat__hello-world/issues/by-priority/high
ls /github/repos/octocat__hello-world/issues/by-edited/2026-05-12
jq '.title' /github/repos/octocat__hello-world/issues/by-edited/2026-05-12/42.json
jq '.required' discovery/github/repos/{owner}/{repo}/issues/.schema.json
ls discovery/github/repos/{owner}/{repo}/issues
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
