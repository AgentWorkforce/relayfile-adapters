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
    name: "files",
    path: "/box/files",
    pathPattern: /^\/box\/files(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[0-9]+$/,
    schema: "discovery/box/files/.schema.json",
    createExample: "discovery/box/files/.create.example.json",
  },
  {
    name: "webhooks",
    path: "/box/webhooks",
    pathPattern: /^\/box\/webhooks(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[0-9]+$/,
    schema: "discovery/box/webhooks/.schema.json",
    createExample: "discovery/box/webhooks/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
