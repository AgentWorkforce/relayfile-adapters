import { dockerHubLayoutPath } from './path-mapper.js';

export const DOCKER_HUB_LAYOUT_PROMPT = `# Docker Hub Mount Layout

Always inspect the live tree with \`ls\` before constructing paths. The Docker Hub adapter mirrors the Composio-backed Nango syncs for repositories, tags, and webhooks. It is repository-centered: tags and webhooks are stored under the repository they belong to, while top-level resource indexes and by-id aliases provide cross-repository discovery.

## Tree

\`/docker-hub/LAYOUT.md\` is this guide.
\`/docker-hub/_index.json\` lists the top-level resource roots: \`repositories\`, \`tags\`, and \`webhooks\`.
\`/docker-hub/repositories/_index.json\` lists every materialized repository, sorted by the repository \`last_updated\` watermark descending.
\`/docker-hub/repositories/<namespace>/<name>.json\` is the canonical repository record. Docker Hub has no numeric repository id, so the stable id is \`<namespace>/<name>\`.
\`/docker-hub/repositories/<namespace>/<name>/tags/_index.json\` lists tags for one repository.
\`/docker-hub/repositories/<namespace>/<name>/tags/<tag-name>.json\` is the canonical tag record for that repository. Tag names are URI-encoded as one path segment.
\`/docker-hub/repositories/<namespace>/<name>/webhooks/_index.json\` lists webhooks for one repository.
\`/docker-hub/repositories/<namespace>/<name>/webhooks/<webhook-id>.json\` is the canonical webhook record.
\`/docker-hub/tags/_index.json\` is the flat cross-repository tag index.
\`/docker-hub/webhooks/_index.json\` is the flat cross-repository webhook index.

## Indexes

\`/docker-hub/repositories/_index.json\` and \`/docker-hub/repositories/by-namespace/<namespace>/_index.json\` rows use:

\`\`\`json
{ "id": "acme/api", "title": "acme/api", "updated": "2026-05-21T18:00:00Z", "namespace": "acme", "name": "api", "repository_type": "image", "status": 1, "is_private": false, "star_count": 12, "pull_count": 5000 }
\`\`\`

\`/docker-hub/tags/_index.json\` and per-repository tag index rows use:

\`\`\`json
{ "id": "acme/api/latest", "title": "acme/api:latest", "updated": "2026-05-21T18:05:00Z", "namespace": "acme", "repository": "api", "name": "latest", "digest": "sha256:...", "tag_status": "active", "architecture": "amd64", "os": "linux" }
\`\`\`

\`/docker-hub/webhooks/_index.json\`, \`/docker-hub/webhooks/by-repository/<namespace>__<repo>/_index.json\`, and per-repository webhook index rows use:

\`\`\`json
{ "id": "acme/api/123", "title": "acme/api: deploy", "updated": "2026-05-21T18:10:00Z", "namespace": "acme", "repository": "api", "webhook_id": "123", "active": true, "creator": "mona", "last_called": "2026-05-21T18:30:00Z" }
\`\`\`

Indexes are sorted by \`updated\` descending, with stable id tie-breaks, so consumers can read them without re-sorting.

## Aliases

Aliases are materialized mirrors of the canonical record envelope. The alias body can be read directly; it also includes \`canonicalPath\` for clients that want to jump to the canonical location.

- \`/docker-hub/repositories/by-id/<namespace>__<name>.json\`
- \`/docker-hub/repositories/by-namespace/<namespace>/_index.json\`
- \`/docker-hub/tags/by-id/<namespace>__<repository>__<tag-name>.json\`
- \`/docker-hub/webhooks/by-id/<webhook-id>.json\`
- \`/docker-hub/webhooks/by-repository/<namespace>__<repository>/_index.json\`

The human-readable joiner is \`__\`. Alias components are URI-encoded and use the shared Relayfile slug/alias utilities where slug normalization or collision suffixes are needed by callers.

## Examples

\`\`\`bash
ls /docker-hub
ls /docker-hub/repositories
ls /docker-hub/repositories/acme/api/tags
ls /docker-hub/webhooks/by-repository
jq '.[0]' /docker-hub/repositories/_index.json
jq '.[] | select(.namespace == "acme") | {id, title, pull_count}' /docker-hub/repositories/_index.json
jq '.[] | select(.repository == "api") | {name, digest, updated}' /docker-hub/tags/_index.json
jq '.[] | select(.active == true) | {id, title, last_called}' /docker-hub/webhooks/_index.json
jq '{objectType, objectId, canonicalPath, payload: {namespace: .payload.namespace, name: .payload.name}}' /docker-hub/repositories/acme/api.json
jq '.payload.digest' /docker-hub/repositories/acme/api/tags/latest.json
\`\`\`
`;

export function dockerHubLayoutPromptFile() {
  return {
    path: dockerHubLayoutPath(),
    contentType: 'text/markdown; charset=utf-8' as const,
    content: DOCKER_HUB_LAYOUT_PROMPT.endsWith('\n') ? DOCKER_HUB_LAYOUT_PROMPT : `${DOCKER_HUB_LAYOUT_PROMPT}\n`,
  };
}
