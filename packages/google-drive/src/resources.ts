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
    path: "/google-drive/files",
    pathPattern: /^\/google-drive\/files(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: "discovery/google-drive/files/.schema.json",
    createExample: "discovery/google-drive/files/.create.example.json",
  },
  {
    name: "channels",
    path: "/google-drive/channels",
    pathPattern: /^\/google-drive\/channels(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: "discovery/google-drive/channels/.schema.json",
    createExample: "discovery/google-drive/channels/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
