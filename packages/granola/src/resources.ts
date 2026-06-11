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
    name: "notes",
    path: "/granola/notes",
    pathPattern: /^\/granola\/notes(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^not_[A-Za-z0-9]{14}$/,
    schema: "discovery/granola/notes/.schema.json",
    createExample: "discovery/granola/notes/.create.example.json",
  },
  {
    name: "folders",
    path: "/granola/folders",
    pathPattern: /^\/granola\/folders(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^fol_[A-Za-z0-9]{14}$/,
    schema: "discovery/granola/folders/.schema.json",
    createExample: "discovery/granola/folders/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
