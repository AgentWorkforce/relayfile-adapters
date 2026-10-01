export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample?: string;
  readonly operations?: readonly AdapterResourceOperation[];
}

export type AdapterResourceOperation = "create" | "update" | "delete";

export const resources = [
  {
    name: "issues",
    path: "/gitlab/projects/{projectPath}/issues",
    pathPattern: /^\/gitlab\/projects\/.+?\/issues(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[1-9]\d*$/,
    schema: "discovery/gitlab/projects/{projectPath}/issues/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/issues/.create.example.json",
    operations: ["create"],
  },
  {
    name: "issues",
    path: "/gitlab/projects/{projectPath}/issues/{issueIid}__{slug}/meta.json",
    pathPattern: /^\/gitlab\/projects\/.+?\/issues\/[1-9]\d*(?:__[^\/]+)?\/meta\.json$/,
    idPattern: /^[1-9]\d*(?:__.*)?$/,
    schema: "discovery/gitlab/projects/{projectPath}/issues/{issueIid}__{slug}/meta.json/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/issues/{issueIid}__{slug}/meta.json/.create.example.json",
    operations: ["update"],
  },
  {
    name: "merge-requests",
    path: "/gitlab/projects/{projectPath}/merge-requests",
    pathPattern: /^\/gitlab\/projects\/.+?\/merge-requests(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[1-9]\d*$/,
    schema: "discovery/gitlab/projects/{projectPath}/merge-requests/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/merge-requests/.create.example.json",
    operations: ["create"],
  },
  {
    name: "merge-requests",
    path: "/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/meta.json",
    pathPattern: /^\/gitlab\/projects\/.+?\/merge_requests\/[1-9]\d*(?:__[^\/]+)?\/meta\.json$/,
    idPattern: /^[1-9]\d*(?:__.*)?$/,
    schema: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/meta.json/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/meta.json/.create.example.json",
    operations: ["update"],
  },
  {
    name: "merge",
    path: "/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/merge.json",
    pathPattern: /^\/gitlab\/projects\/.+?\/merge_requests\/[1-9]\d*(?:__[^\/]+)?\/merge\.json$/,
    idPattern: /^[1-9]\d*(?:__.*)?$/,
    schema: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/merge.json/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/merge.json/.create.example.json",
    operations: ["update"],
  },
  {
    name: "close-merge-request",
    path: "/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/close.json",
    pathPattern: /^\/gitlab\/projects\/.+?\/merge_requests\/[1-9]\d*(?:__[^\/]+)?\/close\.json$/,
    idPattern: /^[1-9]\d*(?:__.*)?$/,
    schema: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/close.json/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/close.json/.create.example.json",
    operations: ["update"],
  },
  {
    name: "refs",
    path: "/gitlab/projects/{projectPath}/refs",
    pathPattern: /^\/gitlab\/projects\/.+?\/refs(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^$/,
    schema: "discovery/gitlab/projects/{projectPath}/refs/.schema.json",
    createExample: "discovery/gitlab/projects/{projectPath}/refs/.create.example.json",
    operations: ["create"],
  },
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
