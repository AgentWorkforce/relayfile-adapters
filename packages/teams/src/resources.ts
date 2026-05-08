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
    path: "/teams/{teamId}/channels/{channelId}/messages",
    pathPattern: /^\/teams\/[^\/]+\/channels\/[^\/]+\/messages(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.=!-]+$/,
    schema: "discovery/teams/{teamId}/channels/{channelId}/messages/.schema.json",
    createExample: "discovery/teams/{teamId}/channels/{channelId}/messages/.create.example.json",
  },
  {
    name: "replies",
    path: "/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies",
    pathPattern: /^\/teams\/[^\/]+\/channels\/[^\/]+\/messages\/[^\/]+\/replies(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.=!-]+$/,
    schema: "discovery/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/.schema.json",
    createExample: "discovery/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/.create.example.json",
  },
  {
    name: "messages",
    path: "/teams/chats/{chatId}/messages",
    pathPattern: /^\/teams\/chats\/[^\/]+\/messages(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.=!-]+$/,
    schema: "discovery/teams/chats/{chatId}/messages/.schema.json",
    createExample: "discovery/teams/chats/{chatId}/messages/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
