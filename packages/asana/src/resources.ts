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
    name: "tasks",
    path: "/asana/tasks",
    pathPattern: /^\/asana\/tasks(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/asana/tasks/.schema.json",
    createExample: "discovery/asana/tasks/.create.example.json",
  },
  {
    name: "projects",
    path: "/asana/projects",
    pathPattern: /^\/asana\/projects(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/asana/projects/.schema.json",
    createExample: "discovery/asana/projects/.create.example.json",
  },
  {
    name: "sections",
    path: "/asana/sections",
    pathPattern: /^\/asana\/sections(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/asana/sections/.schema.json",
    createExample: "discovery/asana/sections/.create.example.json",
  },
  {
    name: "sections",
    path: "/asana/projects/{projectId}/sections",
    pathPattern: /^\/asana\/projects\/[^\/]+\/sections(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/asana/projects/{projectId}/sections/.schema.json",
    createExample: "discovery/asana/projects/{projectId}/sections/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
