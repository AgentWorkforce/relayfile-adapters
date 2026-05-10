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
    name: "pages",
    path: "/confluence/pages",
    pathPattern: /^\/confluence\/pages(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?\d+$/,
    schema: "discovery/confluence/pages/.schema.json",
    createExample: "discovery/confluence/pages/.create.example.json",
  },
  {
    name: "pages",
    path: "/confluence/spaces/{spaceIdOrKey}/pages",
    pathPattern: /^\/confluence\/spaces\/[^\/]+\/pages(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?\d+$/,
    schema: "discovery/confluence/spaces/{spaceIdOrKey}/pages/.schema.json",
    createExample: "discovery/confluence/spaces/{spaceIdOrKey}/pages/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
