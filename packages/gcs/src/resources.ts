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
    path: "/gcs/{bucket}/objects",
    pathPattern: /^\/gcs\/[^\/]+\/objects(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^.+$/,
    schema: "discovery/gcs/objects/.schema.json",
    createExample: "discovery/gcs/objects/.create.example.json",
  },
  {
    name: "notifications",
    path: "/gcs/notifications/{bucketId}",
    pathPattern: /^\/gcs\/notifications\/[^\/]+(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9._-]+$/,
    schema: "discovery/gcs/notifications/.schema.json",
    createExample: "discovery/gcs/notifications/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
