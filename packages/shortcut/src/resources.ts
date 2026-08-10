export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
}

const ID = /^[A-Za-z0-9_.~-]+$/;

export const resources = [
  {
    name: "stories",
    path: "/shortcut/stories",
    pathPattern: /^\/shortcut\/stories(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: ID,
    schema: "discovery/shortcut/stories/.schema.json",
    createExample: "discovery/shortcut/stories/.create.example.json",
  },
  {
    name: "epics",
    path: "/shortcut/epics",
    pathPattern: /^\/shortcut\/epics(?:\/[^/]+(?:\.json)?)?$/,
    idPattern: ID,
    schema: "discovery/shortcut/epics/.schema.json",
    createExample: "discovery/shortcut/epics/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalized = path.endsWith(".json") ? path : path.replace(/\/$/u, "");
  return resources.find((resource) => resource.pathPattern.test(normalized));
}
