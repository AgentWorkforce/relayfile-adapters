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
    name: "rows",
    path: "/postgres/{db}/{schema}/{table}",
    pathPattern: /^\/postgres\/[^\/]+\/[^\/]+\/[^\/]+(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^.+$/,
    schema: "discovery/postgres/rows/.schema.json",
    createExample: "discovery/postgres/rows/.create.example.json",
  },
  {
    name: "listeners",
    path: "/postgres/listeners",
    pathPattern: /^\/postgres\/listeners(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
    schema: "discovery/postgres/listeners/.schema.json",
    createExample: "discovery/postgres/listeners/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
