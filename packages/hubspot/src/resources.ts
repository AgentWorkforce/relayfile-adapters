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
    name: "contacts",
    path: "/hubspot/contacts",
    pathPattern: /^\/hubspot\/contacts(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[0-9]+$/,
    schema: "discovery/hubspot/contacts/.schema.json",
    createExample: "discovery/hubspot/contacts/.create.example.json",
  },
  {
    name: "companies",
    path: "/hubspot/companies",
    pathPattern: /^\/hubspot\/companies(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[0-9]+$/,
    schema: "discovery/hubspot/companies/.schema.json",
    createExample: "discovery/hubspot/companies/.create.example.json",
  },
  {
    name: "deals",
    path: "/hubspot/deals",
    pathPattern: /^\/hubspot\/deals(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[0-9]+$/,
    schema: "discovery/hubspot/deals/.schema.json",
    createExample: "discovery/hubspot/deals/.create.example.json",
  },
  {
    name: "tickets",
    path: "/hubspot/tickets",
    pathPattern: /^\/hubspot\/tickets(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[0-9]+$/,
    schema: "discovery/hubspot/tickets/.schema.json",
    createExample: "discovery/hubspot/tickets/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
