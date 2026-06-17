import { GCP_PATH_ROOT } from "./types.js";

export const GCP_LAYOUT_PROMPT = `# GCP Mount Layout

Always run \`ls\` before constructing a path. The adapter keys Cloud Run services and alert policies by their provider-assigned id, so consumers should inspect the live directory instead of guessing a filename.

GCP exposes data over REST across multiple API hosts (run.googleapis.com, monitoring.googleapis.com, cloudbilling.googleapis.com). This adapter is auth-agnostic; auth is supplied at runtime by a provider via a Nango GCP connection.

Connection scopes are \`project\`, \`location\`, and \`billingAccountId\`. \`project\` selects the GCP project for Cloud Run and Monitoring reads, \`location\` narrows regional Cloud Run services, and \`billingAccountId\` selects the billing account snapshot.

## Tree

\`/gcp/LAYOUT.md\` is this guide.
\`/gcp/run/services/\` holds Cloud Run service records, sourced from the Cloud Run Admin API GET /v2/projects/{project}/locations/{location}/services (and revisions). One record per service, keyed by service name.
\`/gcp/monitoring/alerts/\` holds Cloud Monitoring alert policy records, sourced from GET /v3/projects/{project}/alertPolicies plus firing incidents (delivered via Pub/Sub push). One record per alert policy, keyed by policyId.
\`/gcp/billing/current.json\` is the single FinOps current-state file, sourced from the Cloud Billing API GET /v1/billingAccounts/{id} and project billing info.

## Discovery

\`/discovery/gcp/cloud-run-services/.schema.json\` documents the Cloud Run service record shape.
\`/discovery/gcp/monitoring-alerts/.schema.json\` documents the Monitoring alert record shape.
\`/discovery/gcp/billing/.schema.json\` documents the billing current-state record shape.

## Indexes

\`/gcp/_index.json\` is the root index listing available resource directories:

\`\`\`json
[
  { "id": "run", "title": "Cloud Run Services", "canonicalPath": "/gcp/run/services/_index.json" },
  { "id": "monitoring", "title": "Monitoring Alerts", "canonicalPath": "/gcp/monitoring/alerts/_index.json" },
  { "id": "billing", "title": "Billing", "canonicalPath": "/gcp/billing/_index.json" }
]
\`\`\`

\`/gcp/run/services/_index.json\` rows use:

\`\`\`json
{ "id": "<serviceName>", "title": "<serviceName>", "updated": "<iso8601>", "canonicalPath": "/gcp/run/services/<serviceName>.json", "region": "<location>", "status": "ready" }
\`\`\`

\`/gcp/monitoring/alerts/_index.json\` rows use:

\`\`\`json
{ "id": "<policyId>", "title": "<displayName>", "updated": "<iso8601>", "canonicalPath": "/gcp/monitoring/alerts/<policyId>.json", "state": "open", "firing": true }
\`\`\`

\`/gcp/billing/_index.json\` rows use:

\`\`\`json
{ "id": "<billingAccountId>", "title": "Billing current state", "updated": "<iso8601>", "canonicalPath": "/gcp/billing/current.json" }
\`\`\`

Indexes are sorted by \`updated\` descending so readers can consume recent records without re-sorting.

## Aliases

- Canonical: \`/gcp/run/services/<serviceName>.json\`, \`/gcp/monitoring/alerts/<policyId>.json\`.
- Stable anchor: \`/gcp/run/services/by-id/<serviceName>.json\`, \`/gcp/monitoring/alerts/by-id/<policyId>.json\`.
- Cloud Run by region: \`/gcp/run/services/by-region/<region-slug>/<serviceName>.json\`.
- Cloud Run by status: \`/gcp/run/services/by-status/<ready|not-ready>/<serviceName>.json\`.
- Monitoring by title: \`/gcp/monitoring/alerts/by-title/<display-name-slug>-<hash>__<policyId>.json\`.
- Monitoring by state: \`/gcp/monitoring/alerts/by-state/<open|closed>/<policyId>.json\`.

Alias files are materialized canonical mirrors containing the full provider payload alongside \`{ provider, objectType, objectId, canonicalPath }\` metadata. Title aliases use the shared \`slugifyAlias\` and \`aliasCollisionSuffix\` helpers for deterministic collision safety. Billing has no alias subtree — it is a single \`current.json\` file.

## JSONL And Querying

GCP does not emit JSONL in this adapter today. All records are individual \`.json\` files.

Examples:

\`\`\`bash
ls /gcp/run/services
jq '.ready' /gcp/run/services/<serviceName>.json
jq '.url' /gcp/run/services/<serviceName>.json
ls /gcp/run/services/by-region/us-central1
ls /gcp/run/services/by-status/ready
ls /gcp/monitoring/alerts
jq '.[] | select(.firing == true)' /gcp/monitoring/alerts/_index.json
jq '.firing' /gcp/monitoring/alerts/<policyId>.json
ls /gcp/monitoring/alerts/by-state/open
jq '.canonicalPath' /gcp/monitoring/alerts/by-title/<display-name-slug>-<hash>__<policyId>.json
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
