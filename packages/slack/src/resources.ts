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
    name: "messages",
    path: "/slack/channels/{channelId}/messages",
    pathPattern: /^\/slack\/channels\/[^\/]+\/messages(?:\/[^\/]+(?:\.json|\/meta\.json)?)?$/,
    idPattern: /^(?:meta|(?:[A-Za-z0-9_.:-]+--)?\d{10,}(?:_\d+)?)$/,
    schema: "discovery/slack/channels/{channelId}/messages/.schema.json",
    createExample: "discovery/slack/channels/{channelId}/messages/.create.example.json",
    operations: ["create","update","delete"],
  },
  {
    name: "direct-messages",
    path: "/slack/users/{userId}/messages",
    pathPattern: /^\/slack\/users\/[^\/]+\/messages(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^$/,
    schema: "discovery/slack/users/{userId}/messages/.schema.json",
    createExample: "discovery/slack/users/{userId}/messages/.create.example.json",
    operations: ["create"],
  },
  {
    name: "replies",
    path: "/slack/channels/{channelId}/messages/{messageTs}/replies",
    pathPattern: /^\/slack\/channels\/[^\/]+\/messages\/[^\/]+\/replies(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.:-]+--)?\d{10,}(?:_\d+)?$/,
    schema: "discovery/slack/channels/{channelId}/messages/{messageTs}/replies/.schema.json",
    createExample: "discovery/slack/channels/{channelId}/messages/{messageTs}/replies/.create.example.json",
    operations: ["create","update","delete"],
  },
  {
    name: "reactions",
    path: "/slack/channels/{channelId}/messages/{messageTs}/reactions",
    pathPattern: /^\/slack\/channels\/[^\/]+\/messages\/[^\/]+\/reactions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+(?:--[A-Za-z0-9_.:-]+)*$/,
    schema: "discovery/slack/channels/{channelId}/messages/{messageTs}/reactions/.schema.json",
    createExample: "discovery/slack/channels/{channelId}/messages/{messageTs}/reactions/.create.example.json",
    operations: ["create","delete"],
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
