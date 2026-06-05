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
    path: "/dropbox/files",
    pathPattern: /^\/dropbox\/files(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/dropbox/files/.schema.json",
    createExample: "discovery/dropbox/files/.create.example.json",
  },
  {
    name: "cursors",
    path: "/dropbox/cursors",
    pathPattern: /^\/dropbox\/cursors(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/dropbox/cursors/.schema.json",
    createExample: "discovery/dropbox/cursors/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
