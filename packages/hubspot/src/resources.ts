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
    name: "contacts",
    path: "/hubspot/contacts",
    pathPattern: /^\/hubspot\/contacts(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/hubspot/contacts/.schema.json",
    createExample: "discovery/hubspot/contacts/.create.example.json",
    operations: ["create","update","delete"],
  },
  {
    name: "companies",
    path: "/hubspot/companies",
    pathPattern: /^\/hubspot\/companies(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/hubspot/companies/.schema.json",
    createExample: "discovery/hubspot/companies/.create.example.json",
    operations: ["create","update","delete"],
  },
  {
    name: "deals",
    path: "/hubspot/deals",
    pathPattern: /^\/hubspot\/deals(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/hubspot/deals/.schema.json",
    createExample: "discovery/hubspot/deals/.create.example.json",
    operations: ["create","update","delete"],
  },
  {
    name: "tickets",
    path: "/hubspot/tickets",
    pathPattern: /^\/hubspot\/tickets(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/hubspot/tickets/.schema.json",
    createExample: "discovery/hubspot/tickets/.create.example.json",
    operations: ["create","update","delete"],
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
