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
    name: "objects",
    path: "/s3/{bucket}/objects",
    pathPattern: /^\/s3\/[^\/]+\/objects(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^.+$/,
    schema: "discovery/s3/objects/.schema.json",
    createExample: "discovery/s3/objects/.create.example.json",
  },
  {
    name: "queues",
    path: "/s3/queues",
    pathPattern: /^\/s3\/queues(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9._-]+$/,
    schema: "discovery/s3/queues/.schema.json",
    createExample: "discovery/s3/queues/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
