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
    name: "events",
    path: "/google-calendar/calendars/{calendarId}/events",
    pathPattern: /^\/google-calendar\/calendars\/[^\/]+\/events(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[a-v0-9]{5,1024}$/,
    schema: "discovery/google-calendar/calendars/{calendarId}/events/.schema.json",
    createExample: "discovery/google-calendar/calendars/{calendarId}/events/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
