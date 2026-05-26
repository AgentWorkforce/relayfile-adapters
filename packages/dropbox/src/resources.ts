export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly sampleIndexPath?: string;
}

export const resources = [
  {
    name: 'files',
    path: '/dropbox/files',
    pathPattern: /^\/dropbox\/files\/(?!_index\.json$)[^/]+\.json$/,
    idPattern: /^[A-Za-z0-9_.:@%+-][A-Za-z0-9_.:@%+-]*$/,
    schema: 'discovery/dropbox/files/.schema.json',
    createExample: 'discovery/dropbox/files/.create.example.json',
  },
  {
    name: 'folders',
    path: '/dropbox/folders',
    pathPattern: /^\/dropbox\/folders\/(?!_index\.json$)[^/]+\.json$/,
    idPattern: /^[A-Za-z0-9_.:@%+-][A-Za-z0-9_.:@%+-]*$/,
    schema: 'discovery/dropbox/folders/.schema.json',
    createExample: 'discovery/dropbox/folders/.create.example.json',
  },
  {
    name: 'shared-folders',
    path: '/dropbox/shared-folders',
    pathPattern: /^\/dropbox\/shared-folders\/(?:[^/]+|by-id\/[^/]+)\.json$/,
    idPattern: /^[A-Za-z0-9_.:@-]+$/,
    schema: 'discovery/dropbox/shared-folders/.schema.json',
    createExample: 'discovery/dropbox/shared-folders/.create.example.json',
  },
  {
    name: 'shared-links',
    path: '/dropbox/shared-links',
    pathPattern: /^\/dropbox\/shared-links\/(?:[^/]+|by-id\/[^/]+)\.json$/,
    idPattern: /^[A-Za-z0-9_.:@-]+$/,
    schema: 'discovery/dropbox/shared-links/.schema.json',
    createExample: 'discovery/dropbox/shared-links/.create.example.json',
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  return resources.find((resource) => resource.pathPattern.test(path));
}
