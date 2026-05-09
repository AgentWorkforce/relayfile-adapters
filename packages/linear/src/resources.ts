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
    idPattern: /^(?:(?:[A-Za-z0-9_.~-]+--)?[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/linear/issues/.schema.json",
    createExample: "discovery/linear/issues/.create.example.json",
  },
  {
    name: "comments",
    path: "/linear/issues/{issueId}/comments",
    pathPattern: /^\/linear\/issues\/[^\/]+\/comments(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:(?:[A-Za-z0-9_.~-]+--)?[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/linear/issues/{issueId}/comments/.schema.json",
    createExample: "discovery/linear/issues/{issueId}/comments/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
