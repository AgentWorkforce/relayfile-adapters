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
    name: "keys",
    path: "/redis/{db}",
    pathPattern: /^\/redis\/[^\/]+(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^.+$/,
    schema: "discovery/redis/keys/.schema.json",
    createExample: "discovery/redis/keys/.create.example.json",
  },
  {
    name: "listeners",
    path: "/redis/listeners",
    pathPattern: /^\/redis\/listeners(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[0-9]+$/,
    schema: "discovery/redis/listeners/.schema.json",
    createExample: "discovery/redis/listeners/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
