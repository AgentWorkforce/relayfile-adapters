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
    name: "accounts",
    path: "/salesforce/accounts",
    pathPattern: /^\/salesforce\/accounts(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/,
    schema: "discovery/salesforce/accounts/.schema.json",
    createExample: "discovery/salesforce/accounts/.create.example.json",
  },
  {
    name: "contacts",
    path: "/salesforce/contacts",
    pathPattern: /^\/salesforce\/contacts(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/,
    schema: "discovery/salesforce/contacts/.schema.json",
    createExample: "discovery/salesforce/contacts/.create.example.json",
  },
  {
    name: "opportunities",
    path: "/salesforce/opportunities",
    pathPattern: /^\/salesforce\/opportunities(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/,
    schema: "discovery/salesforce/opportunities/.schema.json",
    createExample: "discovery/salesforce/opportunities/.create.example.json",
  },
  {
    name: "leads",
    path: "/salesforce/leads",
    pathPattern: /^\/salesforce\/leads(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/,
    schema: "discovery/salesforce/leads/.schema.json",
    createExample: "discovery/salesforce/leads/.create.example.json",
  },
  {
    name: "cases",
    path: "/salesforce/cases",
    pathPattern: /^\/salesforce\/cases(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/,
    schema: "discovery/salesforce/cases/.schema.json",
    createExample: "discovery/salesforce/cases/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
