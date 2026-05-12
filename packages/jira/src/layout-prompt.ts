export const JIRA_LAYOUT_PROMPT = `# Jira Mount Layout

Always run \`ls\` before constructing a path. The current jira adapter writes human-readable leaf names as \`<slug>--<id>.json\` (double hyphen) — this is PRE-MIGRATION. A follow-up convention-unification PR will switch this adapter to the cross-adapter \`<slug>__<id>\` (double underscore) joiner so it matches \`github\`, \`linear\`, \`notion\`, and \`confluence\`. Until then, inspect the live directory rather than guessing a filename, and use the \`by-id\` and \`by-key\` alias subtrees when you have a stable identifier.

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

- Canonical: \`/jira/issues/<slug>--<id>.json\` (\`__\` after the migration PR).
- By id: \`/jira/issues/by-id/<id>.json\` — stable when the summary changes.
- By key: \`/jira/issues/by-key/<TEAM-123>.json\` — Jira's natural human-readable key.
- By state: \`/jira/issues/by-state/<status>/<id>.json\` — \`to-do\`, \`in-progress\`, \`done\`, etc.

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
