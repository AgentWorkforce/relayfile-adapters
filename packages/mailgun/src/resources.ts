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
    name: 'messages',
    path: '/mailgun/domains/{domain}/messages',
    pathPattern: /^\/mailgun\/domains\/[^/]+\/messages(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: 'discovery/mailgun/domains/{domain}/messages/.schema.json',
    createExample: 'discovery/mailgun/domains/{domain}/messages/.create.example.json',
  },
  {
    name: 'lists',
    path: '/mailgun/lists',
    pathPattern: /^\/mailgun\/lists(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: /^[^@\s]+@[^@\s]+$/,
    schema: 'discovery/mailgun/lists/.schema.json',
    createExample: 'discovery/mailgun/lists/.create.example.json',
  },
  {
    name: 'members',
    path: '/mailgun/lists/{listAddress}/members',
    pathPattern: /^\/mailgun\/lists\/[^/]+\/members(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: /^[^@\s]+@[^@\s]+$/,
    schema: 'discovery/mailgun/lists/{listAddress}/members/.schema.json',
    createExample: 'discovery/mailgun/lists/{listAddress}/members/.create.example.json',
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('.json') ? path : path.replace(/\/$/, '');
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
