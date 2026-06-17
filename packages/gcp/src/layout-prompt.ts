import { GCP_PATH_ROOT } from "./types.js";

export const GCP_LAYOUT_PROMPT = `# GCP Mount Layout

Always run \`ls\` before constructing a path. The adapter keys Cloud Run services and alert policies by their provider-assigned id, so consumers should inspect the live directory instead of guessing a filename.

GCP exposes data over REST across multiple API hosts (run.googleapis.com, monitoring.googleapis.com, cloudbilling.googleapis.com). This adapter is auth-agnostic; auth is supplied at runtime by a provider via a Nango GCP connection.

## Tree

\`/gcp/LAYOUT.md\` is this guide.
\`/gcp/run/services/\` holds Cloud Run service records, sourced from the Cloud Run Admin API GET /v2/projects/{project}/locations/{location}/services (and revisions). One record per service, keyed by service name.
\`/gcp/monitoring/alerts/\` holds Cloud Monitoring alert policy records, sourced from GET /v3/projects/{project}/alertPolicies plus firing incidents (delivered via Pub/Sub push). One record per alert policy, keyed by policyId.
\`/gcp/billing/current.json\` is the single FinOps current-state file, sourced from the Cloud Billing API GET /v1/billingAccounts/{id} and project billing info.

## Indexes

\`/gcp/_index.json\` is the root index listing available resource directories:

\`\`\`json
[
  { "id": "run", "title": "Cloud Run Services", "canonicalPath": "/gcp/run/services/_index.json" },
  { "id": "monitoring", "title": "Monitoring Alerts", "canonicalPath": "/gcp/monitoring/alerts/_index.json" },
  { "id": "billing", "title": "Billing", "canonicalPath": "/gcp/billing/current.json" }
]
\`\`\`

\`/gcp/run/services/_index.json\` rows use:

\`\`\`json
{ "id": "<serviceName>", "title": "<serviceName>", "updated": "<iso8601>", "canonicalPath": "/gcp/run/services/<serviceName>.json" }
\`\`\`

\`/gcp/monitoring/alerts/_index.json\` rows use:

\`\`\`json
{ "id": "<policyId>", "title": "<displayName>", "updated": "<iso8601>", "canonicalPath": "/gcp/monitoring/alerts/<policyId>.json" }
\`\`\`

Indexes are sorted by \`id\` ascending.

## Aliases

- Canonical: \`/gcp/run/services/<serviceName>.json\`, \`/gcp/monitoring/alerts/<policyId>.json\`.
- By id: \`/gcp/run/services/by-id/<serviceName>.json\`, \`/gcp/monitoring/alerts/by-id/<policyId>.json\`.

Billing has no alias subtree — it is a single \`current.json\` file.

## JSONL And Querying

GCP does not emit JSONL in this adapter today. All records are individual \`.json\` files.

Examples:

\`\`\`bash
ls /gcp/run/services
jq '.ready' /gcp/run/services/<serviceName>.json
jq '.url' /gcp/run/services/<serviceName>.json
ls /gcp/monitoring/alerts
jq '.[] | select(.firing == true)' /gcp/monitoring/alerts/_index.json
jq '.firing' /gcp/monitoring/alerts/<policyId>.json
jq '{open, currency, amount}' /gcp/billing/current.json
\`\`\`
`;

export function layoutPromptFile(): {
  path: string;
  content: string;
  contentType: string;
} {
  return {
    path: `${GCP_PATH_ROOT}/LAYOUT.md`,
    contentType: "text/markdown; charset=utf-8",
    content: GCP_LAYOUT_PROMPT.endsWith("\n")
      ? GCP_LAYOUT_PROMPT
      : `${GCP_LAYOUT_PROMPT}\n`,
  };
}
