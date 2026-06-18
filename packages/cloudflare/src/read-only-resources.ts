export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly sampleIndexPath?: string;
}

export const readOnlyResources = [
  {
    name: "workers-scripts",
    path: "/cloudflare/workers/scripts/{scriptName}.json",
    pathPattern: /^\/cloudflare\/workers\/scripts\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/workers-scripts/.schema.json",
    createExample: "discovery/cloudflare/workers-scripts/.create.example.json",
    sampleIndexPath: "/cloudflare/workers/scripts/_index.json",
  },
  {
    name: "worker-usage",
    path: "/cloudflare/analytics/workers/scripts/{scriptName}.json",
    pathPattern: /^\/cloudflare\/analytics\/workers\/scripts\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/worker-usage/.schema.json",
    createExample: "discovery/cloudflare/worker-usage/.create.example.json",
    sampleIndexPath: "/cloudflare/analytics/workers/scripts/_index.json",
  },
  {
    name: "pages-projects",
    path: "/cloudflare/pages/projects/{projectName}.json",
    pathPattern: /^\/cloudflare\/pages\/projects\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/pages-projects/.schema.json",
    createExample: "discovery/cloudflare/pages-projects/.create.example.json",
    sampleIndexPath: "/cloudflare/pages/projects/_index.json",
  },
  {
    name: "d1-databases",
    path: "/cloudflare/d1/databases/{databaseId}.json",
    pathPattern: /^\/cloudflare\/d1\/databases\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/d1-databases/.schema.json",
    createExample: "discovery/cloudflare/d1-databases/.create.example.json",
    sampleIndexPath: "/cloudflare/d1/databases/_index.json",
  },
  {
    name: "kv-namespaces",
    path: "/cloudflare/kv/namespaces/{namespaceId}.json",
    pathPattern: /^\/cloudflare\/kv\/namespaces\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/kv-namespaces/.schema.json",
    createExample: "discovery/cloudflare/kv-namespaces/.create.example.json",
    sampleIndexPath: "/cloudflare/kv/namespaces/_index.json",
  },
  {
    name: "r2-buckets",
    path: "/cloudflare/r2/buckets/{bucketName}.json",
    pathPattern: /^\/cloudflare\/r2\/buckets\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/r2-buckets/.schema.json",
    createExample: "discovery/cloudflare/r2-buckets/.create.example.json",
    sampleIndexPath: "/cloudflare/r2/buckets/_index.json",
  },
  {
    name: "queues",
    path: "/cloudflare/queues/{queueId}.json",
    pathPattern: /^\/cloudflare\/queues\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/queues/.schema.json",
    createExample: "discovery/cloudflare/queues/.create.example.json",
    sampleIndexPath: "/cloudflare/queues/_index.json",
  },
  {
    name: "tunnels",
    path: "/cloudflare/tunnels/{tunnelId}.json",
    pathPattern: /^\/cloudflare\/tunnels\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/tunnels/.schema.json",
    createExample: "discovery/cloudflare/tunnels/.create.example.json",
    sampleIndexPath: "/cloudflare/tunnels/_index.json",
  },
  {
    name: "zones",
    path: "/cloudflare/zones/{zoneId}.json",
    pathPattern: /^\/cloudflare\/zones\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/zones/.schema.json",
    createExample: "discovery/cloudflare/zones/.create.example.json",
    sampleIndexPath: "/cloudflare/zones/_index.json",
  },
  {
    name: "dns-records",
    path: "/cloudflare/zones/{zoneId}/dns-records/{recordId}.json",
    pathPattern: /^\/cloudflare\/zones\/[^/]+\/dns-records\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/dns-records/.schema.json",
    createExample: "discovery/cloudflare/dns-records/.create.example.json",
    sampleIndexPath: "/cloudflare/zones/{zoneId}/dns-records/_index.json",
  },
  {
    name: "notification-webhooks",
    path: "/cloudflare/notifications/webhooks/{webhookId}.json",
    pathPattern: /^\/cloudflare\/notifications\/webhooks\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/notification-webhooks/.schema.json",
    createExample:
      "discovery/cloudflare/notification-webhooks/.create.example.json",
    sampleIndexPath: "/cloudflare/notifications/webhooks/_index.json",
  },
  {
    name: "notification-policies",
    path: "/cloudflare/notifications/policies/{policyId}.json",
    pathPattern: /^\/cloudflare\/notifications\/policies\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/notification-policies/.schema.json",
    createExample:
      "discovery/cloudflare/notification-policies/.create.example.json",
    sampleIndexPath: "/cloudflare/notifications/policies/_index.json",
  },
  {
    name: "notification-events",
    path: "/cloudflare/notifications/events/{eventId}.json",
    pathPattern: /^\/cloudflare\/notifications\/events\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/cloudflare/notification-events/.schema.json",
    createExample:
      "discovery/cloudflare/notification-events/.create.example.json",
    sampleIndexPath: "/cloudflare/notifications/events/_index.json",
  },
] as const satisfies readonly AdapterResourceConfig[];
