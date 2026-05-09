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
    name: "reviews",
    path: "/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews",
    pathPattern: /^\/github\/repos\/[^\/]+\/[^\/]+\/pulls\/[^\/]+\/reviews(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/.schema.json",
    createExample: "discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
