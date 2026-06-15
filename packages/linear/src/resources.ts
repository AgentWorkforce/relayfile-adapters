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
    name: "issues",
    path: "/linear/issues",
    pathPattern: /^\/linear\/issues(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/linear/issues/.schema.json",
    createExample: "discovery/linear/issues/.create.example.json",
  },
  {
    name: "comments",
    path: "/linear/issues/{issueId}/comments",
    pathPattern: /^\/linear\/issues\/[^\/]+\/comments(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/linear/issues/{issueId}/comments/.schema.json",
    createExample: "discovery/linear/issues/{issueId}/comments/.create.example.json",
  },
  {
    name: "projects",
    path: "/linear/projects",
    pathPattern: /^\/linear\/projects(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/linear/projects/.schema.json",
    createExample: "discovery/linear/projects/.create.example.json",
  },
  {
    name: "projects",
    path: "/linear/projects/{projectId}/meta.json",
    pathPattern: /^\/linear\/projects\/[^\/]+\/meta\.json$/,
    idPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    schema: "discovery/linear/projects/{projectId}/meta.json/.schema.json",
    createExample: "discovery/linear/projects/{projectId}/meta.json/.create.example.json",
  },
  {
    name: "project-issue-assignments",
    path: "/linear/projects/{projectId}/add-issues.json",
    pathPattern: /^\/linear\/projects\/[^\/]+\/add-issues\.json$/,
    idPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    schema: "discovery/linear/projects/{projectId}/add-issues.json/.schema.json",
    createExample: "discovery/linear/projects/{projectId}/add-issues.json/.create.example.json",
  },
  {
    name: "agent-activities",
    path: "/linear/agent-sessions/{sessionId}/activities",
    pathPattern: /^\/linear\/agent-sessions\/[^\/]+\/activities(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:activity_[A-Za-z0-9_-]+|[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/linear/agent-sessions/{sessionId}/activities/.schema.json",
    createExample: "discovery/linear/agent-sessions/{sessionId}/activities/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
