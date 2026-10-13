export function bitbucketLayoutPromptFile() {
  return {
    path: '/bitbucket/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: `# Bitbucket Cloud mount

Start at /bitbucket/_index.json to enumerate resource collections. Each collection
has /bitbucket/{resource}/_index.json containing id, title, updated, and
canonicalPath. Rows are sorted by update time descending, then stable id. An
empty updated value means the provider supplied no timestamp; it is not a
fabricated update time. Follow canonicalPath to read the original provider data.

## Canonical tree

- repositories/{workspace}/{repository}/meta.json: repository metadata.
- workspaces/{workspace}/projects/{key}.json: workspace project metadata.
- repositories/{workspace}/{repository}/pull-requests/{number}.json: pull requests.
- repositories/{workspace}/{repository}/commits/{hash}.json: commit metadata.
- repositories/{workspace}/{repository}/pipelines/{uuid}.json: pipeline runs.
- repositories/{workspace}/{repository}/deployments/{uuid}.json: deployments.
- repositories/{workspace}/{repository}/tags/{name}.json: tags and target hashes.
- repositories/{workspace}/{repository}/issues/{number}.json: historical issues.

All paths start at /bitbucket. Path segments are URI encoded. Stable Nango ids
for repository children include workspace/repository to prevent cross-repository
collisions. Each resource also has by-id/{encoded-id}.json, a full record mirror
with the same data as the canonical file. Projects belong to workspaces and do
not require repository context.

## Discovery

- discovery/bitbucket/repositories/{workspace}/{repository}/pull-requests/.schema.json

Discovery samples /bitbucket/pull-requests/_index.json and follows canonicalPath
or by-id aliases. Historical issues have no writable discovery contract.
Historical Issues were retired by Atlassian in August 2026. Their cached records
remain readable; the legacy issue sync does not start automatically and HTTP 410
preserves cached data. Do not attempt issue writes against the retired API.

## Lifecycle and lookup examples

MERGED and DECLINED pull requests remain readable with their terminal state.
Completed pipelines and deployments remain records. Only explicit upstream
deletion, or successful full enumeration where deletion tracking is enabled,
removes records. Provider mutations emit filesystem events for activity digests.

List repository folders: ls /bitbucket/repositories/
List pull requests: jq '.[] | {title, canonicalPath}' /bitbucket/pull-requests/_index.json
Find merged work: jq '.[] | select(.state == "MERGED")' /bitbucket/pull-requests/_index.json
Read a record by following the canonicalPath from an index, or use its stable
encoded id in /bitbucket/pull-requests/by-id/.
Pull requests and historical issues also have by-state, by-assignee,
by-creator, and by-priority mirrors when those fields are present. Pipelines
and deployments have by-status mirrors using the outcome when available.
Lookup paths use a normalized bucket
and an encoded stable id; stale mirrors are removed on lifecycle changes.
`,
  };
}
