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
    name: "conversations",
    path: "/intercom/conversations",
    pathPattern: /^\/intercom\/conversations(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: "discovery/intercom/conversations/.schema.json",
    createExample: "discovery/intercom/conversations/.create.example.json",
  },
  {
    name: "contacts",
    path: "/intercom/contacts",
    pathPattern: /^\/intercom\/contacts(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: "discovery/intercom/contacts/.schema.json",
    createExample: "discovery/intercom/contacts/.create.example.json",
  },
  {
    name: "companies",
    path: "/intercom/companies",
    pathPattern: /^\/intercom\/companies(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: "discovery/intercom/companies/.schema.json",
    createExample: "discovery/intercom/companies/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
