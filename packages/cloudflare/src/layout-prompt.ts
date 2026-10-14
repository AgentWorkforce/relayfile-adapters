import { CLOUDFLARE_PATH_ROOT } from "./types.js";

export const CLOUDFLARE_LAYOUT_PROMPT = `# Cloudflare Mount Layout

Always run \`ls\` before constructing a path. Cloudflare records are keyed by provider ids or stable names, and DNS records are nested under their zone.

\`/cloudflare/LAYOUT.md\` is this guide.
\`/cloudflare/workers/scripts/\` holds Worker script inventory.
\`/cloudflare/analytics/workers/scripts/\` holds current Workers usage summaries keyed by script name.
\`/cloudflare/workers/errors/\` holds hourly per-script Workers error rollups from Workers Observability (Workers Logs). Start at \`/cloudflare/workers/errors/_index.json\` (one row per script: latest hour's \`events\`, \`exceptions\`, \`failures\`, \`status_5xx\`, \`severity\`, \`top_error\`, and \`canonicalPath\` of that hour). Each script has \`/cloudflare/workers/errors/<script>/_index.json\` (its most recent hours, newest first) and one file per UTC hour at \`/cloudflare/workers/errors/<script>/<YYYY-MM-DD>/<HH>.json\` with outcome counts, HTTP status-class counts, wall-time p50/p99, and the top error messages. A rollup is only written for hours with an error signal (non-ok outcome, 5xx, or a logged error), so a missing hour means no recorded errors — or that the script has Workers Logs disabled.
\`/cloudflare/pages/projects/\`, \`/cloudflare/d1/databases/\`, \`/cloudflare/kv/namespaces/\`, \`/cloudflare/r2/buckets/\`, \`/cloudflare/queues/\`, and \`/cloudflare/tunnels/\` hold account-level infrastructure inventory.
\`/cloudflare/zones/\` holds zone inventory. Each zone may expose \`/cloudflare/zones/<zoneId>/dns-records/\`.
\`/cloudflare/notifications/webhooks/\`, \`/cloudflare/notifications/policies/\`, and \`/cloudflare/notifications/events/\` hold Notification configuration and delivered alert events.

Example: \`jq '.[] | select(.severity == "critical" or .severity == "high") | {id, status_5xx, top_error, canonicalPath}' /cloudflare/workers/errors/_index.json\`, then \`ls /cloudflare/workers/errors/<script>/$(date -u +%F)/\`.

Each inventory collection exposes an \`_index.json\` plus \`by-id/\` aliases (error rollups have indexes but no \`by-id/\`; the script/date/hour path is the key). Start from concrete indexes such as \`/cloudflare/workers/scripts/_index.json\`, \`/cloudflare/analytics/workers/scripts/_index.json\`, \`/cloudflare/zones/_index.json\`, and \`/cloudflare/zones/<zoneId>/dns-records/_index.json\`. Discovery schemas are emitted under \`/discovery/cloudflare/\`.

Discovery contracts:
- \`/cloudflare/workers/scripts/{scriptName}.json\` → \`discovery/cloudflare/workers-scripts/.schema.json\`
- \`/cloudflare/analytics/workers/scripts/{scriptName}.json\` → \`discovery/cloudflare/worker-usage/.schema.json\`
- \`/cloudflare/workers/errors/{scriptName}/{date}/{hour}.json\` → \`discovery/cloudflare/worker-error-rollups/.schema.json\`
- \`/cloudflare/pages/projects/{projectName}.json\` → \`discovery/cloudflare/pages-projects/.schema.json\`
- \`/cloudflare/d1/databases/{databaseId}.json\` → \`discovery/cloudflare/d1-databases/.schema.json\`
- \`/cloudflare/kv/namespaces/{namespaceId}.json\` → \`discovery/cloudflare/kv-namespaces/.schema.json\`
- \`/cloudflare/r2/buckets/{bucketName}.json\` → \`discovery/cloudflare/r2-buckets/.schema.json\`
- \`/cloudflare/queues/{queueId}.json\` → \`discovery/cloudflare/queues/.schema.json\`
- \`/cloudflare/tunnels/{tunnelId}.json\` → \`discovery/cloudflare/tunnels/.schema.json\`
- \`/cloudflare/zones/{zoneId}.json\` → \`discovery/cloudflare/zones/.schema.json\`
- \`/cloudflare/zones/{zoneId}/dns-records/{recordId}.json\` → \`discovery/cloudflare/dns-records/.schema.json\`
- \`/cloudflare/notifications/webhooks/{webhookId}.json\` → \`discovery/cloudflare/notification-webhooks/.schema.json\`
- \`/cloudflare/notifications/policies/{policyId}.json\` → \`discovery/cloudflare/notification-policies/.schema.json\`
- \`/cloudflare/notifications/events/{eventId}.json\` → \`discovery/cloudflare/notification-events/.schema.json\`
`;

export function layoutPromptFile(): {
  path: string;
  content: string;
  contentType: string;
} {
  return {
    path: `${CLOUDFLARE_PATH_ROOT}/LAYOUT.md`,
    contentType: "text/markdown; charset=utf-8",
    content: CLOUDFLARE_LAYOUT_PROMPT.endsWith("\n")
      ? CLOUDFLARE_LAYOUT_PROMPT
      : `${CLOUDFLARE_LAYOUT_PROMPT}\n`,
  };
}
