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
    name: "mail",
    path: "/sendgrid/mail",
    pathPattern: /^\/sendgrid\/mail(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!(?:new|create|draft|send)(?:[-_\s].*)?$)[A-Za-z0-9_.:-]+$/i,
    schema: "discovery/sendgrid/mail/.schema.json",
    createExample: "discovery/sendgrid/mail/.create.example.json",
  },
  {
    name: "contacts",
    path: "/sendgrid/contacts",
    pathPattern: /^\/sendgrid\/contacts(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?!(?:new|create|draft|send)(?:[-_\s].*)?$)[A-Za-z0-9_.:-]+$/i,
    schema: "discovery/sendgrid/contacts/.schema.json",
    createExample: "discovery/sendgrid/contacts/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
