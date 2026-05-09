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
    name: "items",
    path: "/onedrive/{accountId}/items",
    pathPattern: /^\/onedrive\/[^\/]+\/items(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9!._-]+$/,
    schema: "discovery/onedrive/items/.schema.json",
    createExample: "discovery/onedrive/items/.create.example.json",
  },
  {
    name: "subscriptions",
    path: "/onedrive/subscriptions",
    pathPattern: /^\/onedrive\/subscriptions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: "discovery/onedrive/subscriptions/.schema.json",
    createExample: "discovery/onedrive/subscriptions/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
