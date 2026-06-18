import { NEON_PATH_ROOT } from "./types.js";

export const NEON_LAYOUT_PROMPT = `# Neon Mount Layout

Always run \`ls\` before constructing a path. Neon records are keyed by provider ids and are materialized from scheduled syncs, not from direct agent-held credentials.

## Tree

\`/neon/LAYOUT.md\` is this guide.
\`/neon/organizations/\` holds one record per Neon organization.
\`/neon/projects/\` holds one record per Neon project.
\`/neon/branches/\` holds one record per Neon branch.
\`/neon/endpoints/\` holds one record per Neon compute endpoint.
\`/neon/operations/\` holds one record per Neon control-plane operation.
\`/neon/consumption/projects/\` holds per-project consumption snapshots for a metric and time bucket.
\`/neon/consumption/branches/\` holds per-branch consumption snapshots for a metric and time bucket.
\`/neon/spending-limits/\` holds one record per organization spending limit snapshot.
\`/neon/advisors/\` holds one record per Neon advisor issue.

## Discovery

\`/discovery/neon/organizations/.schema.json\`
\`/discovery/neon/projects/.schema.json\`
\`/discovery/neon/branches/.schema.json\`
\`/discovery/neon/endpoints/.schema.json\`
\`/discovery/neon/operations/.schema.json\`
\`/discovery/neon/project-consumption/.schema.json\`
\`/discovery/neon/branch-consumption/.schema.json\`
\`/discovery/neon/spending-limits/.schema.json\`
\`/discovery/neon/advisor-issues/.schema.json\`

## Indexes

\`/neon/_index.json\` lists the top-level resources.

\`/neon/projects/_index.json\` rows use:

\`\`\`json
{ "id": "<projectId>", "title": "<projectName>", "updated": "<iso8601>", "canonicalPath": "/neon/projects/<projectId>.json", "orgId": "<orgId>" }
\`\`\`

\`/neon/operations/_index.json\` rows use:

\`\`\`json
{ "id": "<operationId>", "title": "<title>", "updated": "<iso8601>", "canonicalPath": "/neon/operations/<operationId>.json", "projectId": "<projectId>", "status": "<status>" }
\`\`\`

\`/neon/consumption/projects/_index.json\` rows use:

\`\`\`json
{ "id": "<recordId>", "title": "<projectName> <metric>", "updated": "<iso8601>", "canonicalPath": "/neon/consumption/projects/<recordId>.json", "projectId": "<projectId>", "metric": "<metric>" }
\`\`\`

Indexes are sorted by \`updated\` descending.

## Aliases

- Stable anchors: every resource has a \`by-id/\` alias.
- Projects also emit \`/neon/projects/by-org/<orgId>/<projectId>.json\`.
- Branches emit \`/neon/branches/by-project/<projectId>/<branchId>.json\` and \`by-state/\`.
- Endpoints emit \`by-project/\`, \`by-branch/\`, and \`by-state/\`.
- Operations emit \`by-project/\`, \`by-branch/\`, and \`by-status/\`.
- Consumption emits \`by-project/\` or \`by-branch/\` and \`by-metric/\`.
- Advisor issues emit \`by-project/\`, \`by-level/\`, and collision-safe \`by-name/\`.

Alias files are canonical mirrors containing \`{ provider, objectType, objectId, canonicalPath, payload }\`.

## Querying

\`\`\`bash
ls /neon/projects
jq '.title' /neon/projects/<projectId>.json
ls /neon/operations/by-status/failed
jq '.payload.error' /neon/operations/by-id/<operationId>.json
ls /neon/consumption/projects/by-metric/compute-unit-seconds
jq '.payload.spending_limit_cents' /neon/spending-limits/<orgId>.json
ls /neon/advisors/by-level/error
\`\`\`
`;

export function layoutPromptFile(): {
  path: string;
  content: string;
  contentType: string;
} {
  return {
    path: `${NEON_PATH_ROOT}/LAYOUT.md`,
    contentType: "text/markdown; charset=utf-8",
    content: NEON_LAYOUT_PROMPT.endsWith("\n")
      ? NEON_LAYOUT_PROMPT
      : `${NEON_LAYOUT_PROMPT}\n`,
  };
}
