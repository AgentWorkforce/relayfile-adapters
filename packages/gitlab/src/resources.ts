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
    name: "discussions",
    path: "/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/discussions",
    pathPattern: /^\/gitlab\/projects\/.+?\/merge_requests\/[^\/]+(?:__[^\/]+)?\/discussions(?:\/[^\/]+(?:\.json)?|\/[^\/]+\/notes\/[^\/]+\.json)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/discussions/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/discussions/.create.example.json",
  },
  {
    name: "comments",
    path: "/gitlab/projects/{projectPath}/issues/{issueIid}__{slug}/comments",
    pathPattern: /^\/gitlab\/projects\/.+?\/issues\/[^\/]+(?:__[^\/]+)?\/comments(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/gitlab/projects/{projectPath}/issues/{issueIid}__{slug}/comments/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/issues/{issueIid}__{slug}/comments/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
