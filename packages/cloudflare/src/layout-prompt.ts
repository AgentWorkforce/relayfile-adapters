import { CLOUDFLARE_PATH_ROOT } from "./types.js";

export const CLOUDFLARE_LAYOUT_PROMPT = `# Cloudflare Mount Layout

Always run \`ls\` before constructing a path. Cloudflare records are keyed by provider ids or stable names, and DNS records are nested under their zone.

\`/cloudflare/LAYOUT.md\` is this guide.
\`/cloudflare/workers/scripts/\` holds Worker script inventory.
\`/cloudflare/analytics/workers/scripts/\` holds current Workers usage summaries keyed by script name.
\`/cloudflare/pages/projects/\`, \`/cloudflare/d1/databases/\`, \`/cloudflare/kv/namespaces/\`, \`/cloudflare/r2/buckets/\`, \`/cloudflare/queues/\`, and \`/cloudflare/tunnels/\` hold account-level infrastructure inventory.
\`/cloudflare/zones/\` holds zone inventory. Each zone may expose \`/cloudflare/zones/<zoneId>/dns-records/\`.
\`/cloudflare/notifications/webhooks/\`, \`/cloudflare/notifications/policies/\`, and \`/cloudflare/notifications/events/\` hold Notification configuration and delivered alert events.

Each collection exposes an \`_index.json\` plus \`by-id/\` aliases. Start from concrete indexes such as \`/cloudflare/workers/scripts/_index.json\`, \`/cloudflare/analytics/workers/scripts/_index.json\`, \`/cloudflare/zones/_index.json\`, and \`/cloudflare/zones/<zoneId>/dns-records/_index.json\`. Discovery schemas are emitted under \`/discovery/cloudflare/\`.

Discovery contracts:
- \`/cloudflare/workers/scripts/{scriptName}.json\` → \`discovery/cloudflare/workers-scripts/.schema.json\`
- \`/cloudflare/analytics/workers/scripts/{scriptName}.json\` → \`discovery/cloudflare/worker-usage/.schema.json\`
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
