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
    name: 'recordings',
    path: '/recall/recordings',
    pathPattern: /^\/recall\/recordings(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: 'discovery/recall/recordings/.schema.json',
    createExample: 'discovery/recall/recordings/.create.example.json',
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('.json') ? path : path.replace(/\/$/, '');
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
