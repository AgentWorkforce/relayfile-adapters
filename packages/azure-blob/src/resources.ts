export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
}

export const resources = [
  {
    name: "blobs",
    path: "/azure/{account}/{container}/blobs",
    pathPattern: /^\/azure\/[^\/]+\/[^\/]+\/blobs(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^.+$/,
    schema: "discovery/azure-blob/blobs/.schema.json",
    createExample: "discovery/azure-blob/blobs/.create.example.json",
  },
  {
    name: "event-subscriptions",
    path: "/azure/event-subscriptions",
    pathPattern: /^\/azure\/event-subscriptions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9._-]+$/,
    schema: "discovery/azure-blob/event-subscriptions/.schema.json",
    createExample: "discovery/azure-blob/event-subscriptions/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
