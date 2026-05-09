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
    path: "/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}/discussions",
    pathPattern: /^\/gitlab\/projects\/.+?\/merge_requests\/[^\/]+\/discussions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}/discussions/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}/discussions/.create.example.json",
  },
  {
    name: "comments",
    path: "/gitlab/projects/{projectPath}/issues/{issueIid}/comments",
    pathPattern: /^\/gitlab\/projects\/.+?\/issues\/[^\/]+\/comments(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/gitlab/projects/{projectPath}/issues/{issueIid}/comments/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/issues/{issueIid}/comments/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
