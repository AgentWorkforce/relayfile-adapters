export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
}

const CREATE_ONLY_PATTERN = /^$/;

export const resources = [
  {
    name: "comments",
    path: "/jira/issues/{issueIdOrKey}/comments",
    pathPattern: /^\/jira\/issues\/[^\/]+\/comments(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?\d+$/,
    schema: "discovery/jira/issues/{issueIdOrKey}/comments/.schema.json",
    createExample: "discovery/jira/issues/{issueIdOrKey}/comments/.create.example.json",
  },
  {
    name: "transitions",
    path: "/jira/issues/{issueIdOrKey}/transitions",
    pathPattern: /^\/jira\/issues\/[^\/]+\/transitions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: CREATE_ONLY_PATTERN,
    schema: "discovery/jira/issues/{issueIdOrKey}/transitions/.schema.json",
    createExample: "discovery/jira/issues/{issueIdOrKey}/transitions/.create.example.json",
  },
  {
    name: "issues",
    path: "/jira/issues",
    pathPattern: /^\/jira\/issues(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--(?:[A-Z][A-Z0-9]+(?:-\d+)?|\d+)|[A-Z][A-Z0-9]+-\d+|\d+)$/,
    schema: "discovery/jira/issues/.schema.json",
    createExample: "discovery/jira/issues/.create.example.json",
  },
  {
    name: "projects",
    path: "/jira/projects",
    pathPattern: /^\/jira\/projects(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--(?:[A-Z][A-Z0-9]+(?:-\d+)?|\d+)|[A-Z][A-Z0-9]+-\d+|\d+)$/,
    schema: "discovery/jira/projects/.schema.json",
    createExample: "discovery/jira/projects/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
