export const JIRA_LAYOUT_PROMPT = `# Jira Mount Layout

Always run \`ls\` before constructing a path. The jira adapter writes human-readable leaf names as \`<slug>__<id>.json\` (double underscore), matching the cross-adapter convention shared with \`github\`, \`linear\`, \`notion\`, and \`confluence\`. Mounts written before the convention migration used \`<slug>--<id>\` (double hyphen); the reader still recognizes that legacy form so older records remain addressable. Inspect the live directory rather than guessing a filename, and use the \`by-id\` and \`by-key\` alias subtrees when you have a stable identifier.

## Tree

\`/jira/LAYOUT.md\` is this guide.
\`/jira/issues/\`, \`/jira/projects/\`, and \`/jira/sprints/\` each own their canonical JSON records plus a sibling \`_index.json\` and \`by-*\` alias subtrees.
\`/jira/issues/<issueIdOrKey>/comments/<commentId>.json\` is the nested form required to round-trip a comment through the Jira REST API (\`GET/PUT /rest/api/3/issue/{issueIdOrKey}/comment/{commentId}\`). A flat \`/jira/comments/<commentId>.json\` is retained only for legacy webhook payloads that lack issue context and cannot be edited.

## Indexes

\`/jira/issues/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<summary>", "updated": "<iso8601>", "key": "<TEAM-123>", "state": "<status name>", "projectKey": "<TEAM>" }
\`\`\`

\`/jira/projects/_index.json\` and \`/jira/sprints/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "key": "<project or sprint key>" }
\`\`\`

Indexes are sorted by \`updated\` descending so the newest records are first.

## Aliases

Issues are addressable through parallel paths that all resolve to the same canonical record:

- Canonical: \`/jira/issues/<slug>__<id>.json\` (legacy \`--\` joiner still readable).
- By id: \`/jira/issues/by-id/<id>.json\` — stable when the summary changes.
- By key: \`/jira/issues/by-key/<TEAM-123>.json\` — Jira's natural human-readable key.
- By state: \`/jira/issues/by-state/<status>/<id>.json\` — \`to-do\`, \`in-progress\`, \`done\`, etc.
- By assignee: \`/jira/issues/by-assignee/<accountId>/<issueId>.json\` — grouped by the Atlassian \`accountId\` of the current assignee. Unassigned issues are not emitted under this prefix.

Projects and sprints carry a stable reconciliation anchor keyed on the immutable id, so renames leave the alias resolving to the latest payload:

- \`/jira/projects/by-id/<id>.json\` — durable lookup for projects.
- \`/jira/sprints/by-id/<id>.json\` — durable lookup for sprints.

Each alias file is a minimal pointer of the form \`{ id, canonicalPath, title? }\`; readers follow \`canonicalPath\` for the full record. Collisions on a \`by-key\`/\`by-title\` slug get a deterministic 8-character hash suffix (never first-writer-wins).

## JSONL And Querying

Jira does not emit JSONL in this adapter today. Each issue, project, sprint, and comment is a standalone \`.json\` record.

Examples:

\`\`\`bash
ls /jira/issues
ls /jira/issues/by-state
jq '.[0]' /jira/issues/_index.json
jq '.[] | select(.state == "In Progress") | {key, title}' /jira/issues/_index.json
jq '.canonicalPath' /jira/issues/by-key/ENG-42.json
grep -R "regression" /jira/issues
\`\`\`
`;

export function jiraLayoutPromptFile() {
  return {
    path: '/jira/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: JIRA_LAYOUT_PROMPT.endsWith('\n') ? JIRA_LAYOUT_PROMPT : `${JIRA_LAYOUT_PROMPT}\n`,
  };
}
