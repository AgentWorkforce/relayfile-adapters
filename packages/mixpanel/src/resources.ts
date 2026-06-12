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
    name: 'events',
    path: '/mixpanel/events',
    pathPattern: /^\/mixpanel\/events(?:\/[^/]+(?:\.json|\/import\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: 'discovery/mixpanel/events/.schema.json',
    createExample: 'discovery/mixpanel/events/.create.example.json',
  },
  {
    name: 'profiles',
    path: '/mixpanel/profiles',
    pathPattern: /^\/mixpanel\/profiles(?:\/[^/]+(?:\.json|\/delete\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: 'discovery/mixpanel/profiles/.schema.json',
    createExample: 'discovery/mixpanel/profiles/.create.example.json',
  },
  {
    name: 'cohorts',
    path: '/mixpanel/cohorts',
    pathPattern: /^\/mixpanel\/cohorts(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: 'discovery/mixpanel/cohorts/.schema.json',
    createExample: 'discovery/mixpanel/cohorts/.create.example.json',
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('.json') ? path : path.replace(/\/$/, '');
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
