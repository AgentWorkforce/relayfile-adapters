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
    name: "comments",
    path: "/zendesk/tickets/{ticketId}/comments",
    pathPattern: /^\/zendesk\/tickets\/[^\/]+\/comments(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/zendesk/tickets/{ticketId}/comments/.schema.json",
    createExample: "discovery/zendesk/tickets/{ticketId}/comments/.create.example.json",
  },
  {
    name: "tickets",
    path: "/zendesk/tickets",
    pathPattern: /^\/zendesk\/tickets(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/zendesk/tickets/.schema.json",
    createExample: "discovery/zendesk/tickets/.create.example.json",
  },
  {
    name: "users",
    path: "/zendesk/users",
    pathPattern: /^\/zendesk\/users(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/zendesk/users/.schema.json",
    createExample: "discovery/zendesk/users/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
