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
    name: "deals",
    path: "/pipedrive/deals",
    pathPattern: /^\/pipedrive\/deals(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?\d+$/,
    schema: "discovery/pipedrive/deals/.schema.json",
    createExample: "discovery/pipedrive/deals/.create.example.json",
  },
  {
    name: "persons",
    path: "/pipedrive/persons",
    pathPattern: /^\/pipedrive\/persons(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?\d+$/,
    schema: "discovery/pipedrive/persons/.schema.json",
    createExample: "discovery/pipedrive/persons/.create.example.json",
  },
  {
    name: "organizations",
    path: "/pipedrive/organizations",
    pathPattern: /^\/pipedrive\/organizations(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?\d+$/,
    schema: "discovery/pipedrive/organizations/.schema.json",
    createExample: "discovery/pipedrive/organizations/.create.example.json",
  },
  {
    name: "activities",
    path: "/pipedrive/activities",
    pathPattern: /^\/pipedrive\/activities(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?\d+$/,
    schema: "discovery/pipedrive/activities/.schema.json",
    createExample: "discovery/pipedrive/activities/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
