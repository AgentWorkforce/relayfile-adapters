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
    name: "threads",
    path: "/gmail/{account}/threads",
    pathPattern: /^\/gmail\/[^\/]+\/threads(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: "discovery/gmail/threads/.schema.json",
    createExample: "discovery/gmail/threads/.create.example.json",
  },
  {
    name: "drafts",
    path: "/gmail/{account}/drafts",
    pathPattern: /^\/gmail\/[^\/]+\/drafts(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_-]+$/,
    schema: "discovery/gmail/drafts/.schema.json",
    createExample: "discovery/gmail/drafts/.create.example.json",
  },
  {
    name: "watches",
    path: "/gmail/watches",
    pathPattern: /^\/gmail\/watches(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[^\/]+$/,
    schema: "discovery/gmail/watches/.schema.json",
    createExample: "discovery/gmail/watches/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
