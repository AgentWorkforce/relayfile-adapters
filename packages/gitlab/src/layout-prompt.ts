export const GITLAB_LAYOUT_PROMPT = `# GitLab Mount Layout

Always run \`ls\` before constructing a path. GitLab projects may live in nested groups, so everything under \`/gitlab/projects/<namespace>/<project>\` should be discovered from indexes instead of by string concatenation.

## Tree

\`/gitlab/LAYOUT.md\` is this guide.
\`/gitlab/_index.json\` lists top-level resource roots.
\`/gitlab/projects/_index.json\` lists materialized projects.
\`/gitlab/projects/<namespace>/<project>/merge_requests/_index.json\`, \`issues/_index.json\`, \`pipelines/_index.json\`, \`commits/_index.json\`, \`deployments/_index.json\`, and \`tags/_index.json\` list records for a project.

Directory records own child files and use \`<id>__<slug>/meta.json\`: merge requests, issues, pipelines, and commits. Merge requests may have \`diff.patch\`, \`discussions/*.json\`, and \`approvals.json\` next to \`meta.json\`; issues and commits may have \`comments/*.json\`; pipelines may have \`jobs/*.json\`. Flat records with no child files use \`<slug>__<id>.json\` or \`<id>.json\` when no useful slug exists.

## Indexes

Project rows use:

\`\`\`json
{ "id": "group/project", "title": "group/project", "updated": "2026-05-14T00:00:00.000Z" }
\`\`\`

Record rows always include \`id\`, \`title\`, and \`updated\`, with filter-friendly fields such as \`iid\`, \`sha\`, \`state\`, \`status\`, and \`ref\` where GitLab exposes them.

## Aliases

When a canonical directory embeds a slug, a stable \`by-id/<id>.json\` alias points to the canonical record. Merge requests, issues, and commits also emit \`by-title/<slug>__<id>.json\`; merge requests and issues emit \`by-state/<state>/<id>.json\`, \`by-assignee/<assignee>/<id>.json\`, \`by-creator/<creator>/<id>.json\`, and \`by-priority/<priority>/<id>.json\`; pipelines and tags emit \`by-ref/<ref-slug>__<id>.json\`; pipelines and deployments emit \`by-status/<status>/<id>.json\`. Alias files are minimal pointers:

\`\`\`json
{ "id": "42", "canonicalPath": "/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json", "title": "Add OAuth" }
\`\`\`

## Querying

\`\`\`bash
ls /gitlab/projects/acme/api/merge_requests
jq '.[] | {iid, state, title}' /gitlab/projects/acme/api/merge_requests/_index.json
ls /gitlab/projects/acme/api/issues/by-state/opened
ls /gitlab/projects/acme/api/issues/by-assignee/ada
ls /gitlab/projects/acme/api/issues/by-priority/high
jq '.[] | select(.status == "failed")' /gitlab/projects/acme/api/pipelines/_index.json
ls /gitlab/projects/acme/api/merge_requests/by-title
\`\`\`
`;

export function gitLabLayoutPromptFile() {
  return {
    path: '/gitlab/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: GITLAB_LAYOUT_PROMPT.endsWith('\n') ? GITLAB_LAYOUT_PROMPT : `${GITLAB_LAYOUT_PROMPT}\n`,
  };
}
