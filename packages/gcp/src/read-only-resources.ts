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
    name: "cloud-run-services",
    path: "/gcp/run/services/{serviceName}.json",
    pathPattern: /^\/gcp\/run\/services\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/gcp/cloud-run-services/.schema.json",
    createExample: "discovery/gcp/cloud-run-services/.create.example.json",
    sampleIndexPath: "/gcp/run/services/_index.json",
  },
  {
    name: "monitoring-alerts",
    path: "/gcp/monitoring/alerts/{policyId}.json",
    pathPattern: /^\/gcp\/monitoring\/alerts\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/gcp/monitoring-alerts/.schema.json",
    createExample: "discovery/gcp/monitoring-alerts/.create.example.json",
    sampleIndexPath: "/gcp/monitoring/alerts/_index.json",
  },
  {
    name: "billing",
    path: "/gcp/billing/current.json",
    pathPattern: /^\/gcp\/billing\/current\.json$/u,
    idPattern: /^current$/u,
    schema: "discovery/gcp/billing/.schema.json",
    createExample: "discovery/gcp/billing/.create.example.json",
  },
  {
    name: "error-reporting-groups",
    path: "/gcp/error-reporting/groups/{groupId}.json",
    pathPattern: /^\/gcp\/error-reporting\/groups\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/gcp/error-reporting-groups/.schema.json",
    createExample: "discovery/gcp/error-reporting-groups/.create.example.json",
    sampleIndexPath: "/gcp/error-reporting/groups/_index.json",
  },
] as const satisfies readonly AdapterResourceConfig[];
