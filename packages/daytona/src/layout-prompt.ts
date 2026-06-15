import { DAYTONA_PATH_ROOT } from "./types.js";

export const DAYTONA_LAYOUT_PROMPT = `# Daytona Mount Layout

Always run \`ls\` before constructing a path. The adapter uses the organizationId verbatim as the filename for usage records, so consumers should inspect the live directory instead of guessing a filename.

## Tree

\`/daytona/LAYOUT.md\` is this guide.
\`/daytona/usage/\` holds per-organization quota and usage snapshots, polled hourly from Daytona's GET /organizations/{organizationId}/usage. One record per organization, keyed by organizationId.
\`/daytona/usage/by-id/\` contains stable id-keyed alias pointers for each usage record.
\`/daytona/sandboxes/\` holds sandbox records materialized from Daytona webhook events (sandbox.created, sandbox.state.updated). One record per sandbox id.
\`/daytona/snapshots/\` holds snapshot records materialized from Daytona webhook events (snapshot.created, snapshot.state.updated, snapshot.removed). One record per snapshot id.
\`/daytona/volumes/\` holds volume records materialized from Daytona webhook events (volume.created, volume.state.updated). One record per volume id.

## Indexes

\`/daytona/_index.json\` is the root index listing available resource directories:

\`\`\`json
[{ "id": "usage", "title": "Usage", "canonicalPath": "/daytona/usage/_index.json" }]
\`\`\`

\`/daytona/usage/_index.json\` rows use:

\`\`\`json
{ "id": "<organizationId>", "title": "<organizationName>", "updated": "<iso8601>", "canonicalPath": "/daytona/usage/<organizationId>.json", "organizationId": "<organizationId>" }
\`\`\`

Indexes are sorted by \`id\` ascending.

## Aliases

- Canonical: \`/daytona/usage/<organizationId>.json\`.
- By id: \`/daytona/usage/by-id/<organizationId>.json\`.

Alias files under \`by-id/\` are materialized canonical mirrors containing the full provider payload alongside \`{ provider, objectType, objectId, canonicalPath }\` metadata. Collisions are avoided since the organizationId is a stable, unique key.

Sandbox, snapshot, and volume records have no alias subtrees — they are keyed directly by provider-assigned id at their canonical paths. Terminal states (e.g. a snapshot that was removed) remain as records with the last known state; only hard deletes trigger file removal.

## JSONL And Querying

Daytona does not emit JSONL in this adapter today. All records are individual \`.json\` files.

Examples:

\`\`\`bash
ls /daytona/usage
jq '.[0]' /daytona/usage/_index.json
jq '.[] | {id, title, updated}' /daytona/usage/_index.json
ls /daytona/usage/by-id
jq '.canonicalPath' /daytona/usage/by-id/<organizationId>.json
jq '.payload.totalSnapshotQuota' /daytona/usage/<organizationId>.json
ls /daytona/sandboxes
jq '.state' /daytona/sandboxes/<sandboxId>.json
grep -r "running" /daytona/sandboxes
jq '.currentSnapshotUsage' /daytona/usage/<organizationId>.json
\`\`\`
`;

export function layoutPromptFile(): {
  path: string;
  content: string;
  contentType: string;
} {
  return {
    path: `${DAYTONA_PATH_ROOT}/LAYOUT.md`,
    contentType: "text/markdown; charset=utf-8",
    content: DAYTONA_LAYOUT_PROMPT.endsWith("\n")
      ? DAYTONA_LAYOUT_PROMPT
      : `${DAYTONA_LAYOUT_PROMPT}\n`,
  };
}
