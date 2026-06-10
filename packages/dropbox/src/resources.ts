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
    pathPattern: /^\/dropbox\/files\/(?!_index\.json$)(?!by-(?:id|path)\/)[^\/]+(?:\.json)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/dropbox/files/.schema.json",
    createExample: "discovery/dropbox/files/.create.example.json",
  },
  {
    name: "folders",
    path: "/dropbox/folders",
    pathPattern: /^\/dropbox\/folders\/(?!_index\.json$)(?!by-(?:id|path)\/)[^\/]+(?:\.json)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/dropbox/folders/.schema.json",
    createExample: "discovery/dropbox/folders/.create.example.json",
  },
  {
    name: "shared-folders",
    path: "/dropbox/shared-folders",
    pathPattern: /^\/dropbox\/shared-folders\/(?!_index\.json$)(?:by-id\/)?[^\/]+(?:\.json)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/dropbox/shared-folders/.schema.json",
    createExample: "discovery/dropbox/shared-folders/.create.example.json",
  },
  {
    name: "shared-links",
    path: "/dropbox/shared-links",
    pathPattern: /^\/dropbox\/shared-links\/(?!_index\.json$)(?:by-id\/)?[^\/]+(?:\.json)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/dropbox/shared-links/.schema.json",
    createExample: "discovery/dropbox/shared-links/.create.example.json",
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
