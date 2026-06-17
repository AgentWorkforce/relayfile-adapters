export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly sampleIndexPath?: string;
}

export const resources = [
  {
    name: "cloud-run-services",
    path: "/gcp/run/services",
    pathPattern:
      /^\/gcp\/run\/services\/(?:(?!_index\.json$)[^/]+|by-id\/(?!_index\.json$)[^/]+)\.json$/,
    idPattern: /^[A-Za-z0-9_.:@-]+$/,
    schema: "discovery/gcp/cloud-run-services/.schema.json",
    createExample: "discovery/gcp/cloud-run-services/.create.example.json",
  },
  {
    name: "monitoring-alerts",
    path: "/gcp/monitoring/alerts",
    pathPattern:
      /^\/gcp\/monitoring\/alerts\/(?:(?!_index\.json$)[^/]+|by-id\/(?!_index\.json$)[^/]+)\.json$/,
    idPattern: /^[A-Za-z0-9_.:@-]+$/,
    schema: "discovery/gcp/monitoring-alerts/.schema.json",
    createExample: "discovery/gcp/monitoring-alerts/.create.example.json",
  },
  {
    name: "billing",
    path: "/gcp/billing/current",
    pathPattern: /^\/gcp\/billing\/current\.json$/,
    idPattern: /^[A-Za-z0-9_.:@-]+$/,
    schema: "discovery/gcp/billing/.schema.json",
    createExample: "discovery/gcp/billing/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  return resources.find((resource) => resource.pathPattern.test(path));
}
