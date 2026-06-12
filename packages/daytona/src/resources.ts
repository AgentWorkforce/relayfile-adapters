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
    name: "usage",
    path: "/daytona/usage",
    pathPattern: /^\/daytona\/usage\/(?:(?!_index\.json$)[^/]+|by-id\/(?!_index\.json$)[^/]+)\.json$/,
    idPattern: /^[A-Za-z0-9_.:@-]+$/,
    schema: "discovery/daytona/usage/.schema.json",
    createExample: "discovery/daytona/usage/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  return resources.find((resource) => resource.pathPattern.test(path));
}
