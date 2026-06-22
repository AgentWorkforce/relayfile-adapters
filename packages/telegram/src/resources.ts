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
    path: "/telegram/chats/{chatId}/messages",
    pathPattern: /^\/telegram\/chats\/[^\/]+\/messages(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/telegram/chats/{chatId}/messages/.schema.json",
    createExample: "discovery/telegram/chats/{chatId}/messages/.create.example.json",
  },
  {
    name: "messages",
    path: "/telegram/chats/{chatId}/messages/{messageId}.json",
    pathPattern: /^\/telegram\/chats\/[^\/]+\/messages\/[^\/]+\.json$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/telegram/chats/{chatId}/messages/.schema.json",
    createExample: "discovery/telegram/chats/{chatId}/messages/.create.example.json",
  },
  {
    name: "reactions",
    path: "/telegram/chats/{chatId}/messages/{messageId}/reactions",
    pathPattern: /^\/telegram\/chats\/[^\/]+\/messages\/[^\/]+\/reactions(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/telegram/chats/{chatId}/messages/{messageId}/reactions/.schema.json",
    createExample: "discovery/telegram/chats/{chatId}/messages/{messageId}/reactions/.create.example.json",
  },
  {
    name: "callback-queries",
    path: "/telegram/callback-queries",
    pathPattern: /^\/telegram\/callback-queries(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/telegram/callback-queries/.schema.json",
    createExample: "discovery/telegram/callback-queries/.create.example.json",
  },
  {
    name: "inline-queries",
    path: "/telegram/inline-queries",
    pathPattern: /^\/telegram\/inline-queries(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/telegram/inline-queries/.schema.json",
    createExample: "discovery/telegram/inline-queries/.create.example.json",
  },
  {
    name: "commands",
    path: "/telegram/bot/commands",
    pathPattern: /^\/telegram\/bot\/commands(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/telegram/bot/commands/.schema.json",
    createExample: "discovery/telegram/bot/commands/.create.example.json",
  },
  {
    name: "menu-button",
    path: "/telegram/bot/menu-button",
    pathPattern: /^\/telegram\/bot\/menu-button(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[A-Za-z0-9_.:-]+$/,
    schema: "discovery/telegram/bot/menu-button/.schema.json",
    createExample: "discovery/telegram/bot/menu-button/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
