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
    path: "/sharepoint/items",
    pathPattern: /^\/sharepoint\/items(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/sharepoint/items/.schema.json",
    createExample: "discovery/sharepoint/items/.create.example.json",
  },
  {
    name: "subscriptions",
    path: "/sharepoint/subscriptions",
    pathPattern: /^\/sharepoint\/subscriptions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/sharepoint/subscriptions/.schema.json",
    createExample: "discovery/sharepoint/subscriptions/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
