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
    name: "messages",
    path: "/slack/channels/{channelId}/messages",
    pathPattern: /^\/slack\/channels\/[^\/]+\/messages(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+(?:--[A-Za-z0-9_.:-]+)*$/,
    schema: "discovery/slack/channels/{channelId}/messages/.schema.json",
    createExample: "discovery/slack/channels/{channelId}/messages/.create.example.json",
  },
  {
    name: "replies",
    path: "/slack/channels/{channelId}/messages/{messageTs}/replies",
    pathPattern: /^\/slack\/channels\/[^\/]+\/messages\/[^\/]+\/replies(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+(?:--[A-Za-z0-9_.:-]+)*$/,
    schema: "discovery/slack/channels/{channelId}/messages/{messageTs}/replies/.schema.json",
    createExample: "discovery/slack/channels/{channelId}/messages/{messageTs}/replies/.create.example.json",
  },
  {
    name: "reactions",
    path: "/slack/channels/{channelId}/messages/{messageTs}/reactions",
    pathPattern: /^\/slack\/channels\/[^\/]+\/messages\/[^\/]+\/reactions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+(?:--[A-Za-z0-9_.:-]+)*$/,
    schema: "discovery/slack/channels/{channelId}/messages/{messageTs}/reactions/.schema.json",
    createExample: "discovery/slack/channels/{channelId}/messages/{messageTs}/reactions/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
