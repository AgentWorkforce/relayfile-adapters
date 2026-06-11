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
    name: 'scheduled-events',
    path: '/calendly/scheduled-events',
    pathPattern: /^\/calendly\/scheduled-events(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: /^event_[A-Za-z0-9_-]+$/,
    schema: 'discovery/calendly/scheduled-events/.schema.json',
    createExample: 'discovery/calendly/scheduled-events/.create.example.json',
  },
  {
    name: 'event-types',
    path: '/calendly/event-types',
    pathPattern: /^\/calendly\/event-types(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: /^type_[A-Za-z0-9_-]+$/,
    schema: 'discovery/calendly/event-types/.schema.json',
    createExample: 'discovery/calendly/event-types/.create.example.json',
  },
  {
    name: 'invitees',
    path: '/calendly/invitees',
    pathPattern: /^\/calendly\/invitees(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: /^invitee_[A-Za-z0-9_-]+$/,
    schema: 'discovery/calendly/invitees/.schema.json',
    createExample: 'discovery/calendly/invitees/.create.example.json',
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('.json') ? path : path.replace(/\/$/, '');
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
