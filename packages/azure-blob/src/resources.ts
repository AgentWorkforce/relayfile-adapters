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
    path: "/azure-blob/blobs",
    pathPattern: /^\/azure-blob\/blobs(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/azure-blob/blobs/.schema.json",
    createExample: "discovery/azure-blob/blobs/.create.example.json",
  },
  {
    name: "event-subscriptions",
    path: "/azure-blob/event-subscriptions",
    pathPattern: /^\/azure-blob\/event-subscriptions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/azure-blob/event-subscriptions/.schema.json",
    createExample: "discovery/azure-blob/event-subscriptions/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
