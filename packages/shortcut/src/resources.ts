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
    name: "categories",
    path: "/shortcut/categories",
    pathPattern: /^\/shortcut\/categories(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/categories/.schema.json",
    createExample: "discovery/shortcut/categories/.create.example.json",
  },
  {
    name: "custom-fields",
    path: "/shortcut/custom-fields",
    pathPattern: /^\/shortcut\/custom-fields(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/custom-fields/.schema.json",
    operations: ["update","delete"],
  },
  {
    name: "epics",
    path: "/shortcut/epics",
    pathPattern: /^\/shortcut\/epics(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/epics/.schema.json",
    createExample: "discovery/shortcut/epics/.create.example.json",
  },
  {
    name: "groups",
    path: "/shortcut/groups",
    pathPattern: /^\/shortcut\/groups(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/groups/.schema.json",
    createExample: "discovery/shortcut/groups/.create.example.json",
  },
  {
    name: "iterations",
    path: "/shortcut/iterations",
    pathPattern: /^\/shortcut\/iterations(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/iterations/.schema.json",
    createExample: "discovery/shortcut/iterations/.create.example.json",
  },
  {
    name: "labels",
    path: "/shortcut/labels",
    pathPattern: /^\/shortcut\/labels(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/labels/.schema.json",
    createExample: "discovery/shortcut/labels/.create.example.json",
  },
  {
    name: "members",
    path: "/shortcut/members",
    pathPattern: /^\/shortcut\/members(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/members/.schema.json",
    operations: [],
  },
  {
    name: "milestones",
    path: "/shortcut/milestones",
    pathPattern: /^\/shortcut\/milestones(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/milestones/.schema.json",
    createExample: "discovery/shortcut/milestones/.create.example.json",
  },
  {
    name: "projects",
    path: "/shortcut/projects",
    pathPattern: /^\/shortcut\/projects(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/projects/.schema.json",
    createExample: "discovery/shortcut/projects/.create.example.json",
  },
  {
    name: "stories",
    path: "/shortcut/stories",
    pathPattern: /^\/shortcut\/stories(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/stories/.schema.json",
    createExample: "discovery/shortcut/stories/.create.example.json",
  },
  {
    name: "workflows",
    path: "/shortcut/workflows",
    pathPattern: /^\/shortcut\/workflows(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!_index$)(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[A-Za-z0-9_.~-]+__(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}))$/i,
    schema: "discovery/shortcut/workflows/.schema.json",
    createExample: "discovery/shortcut/workflows/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
