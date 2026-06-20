export type TelegramChatId = string | number;

export interface TelegramUser {
  id?: TelegramChatId;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  [key: string]: unknown;
}

export interface TelegramChat {
  id?: TelegramChatId;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  [key: string]: unknown;
}

export interface TelegramMessageRecord {
  id: string;
  updateId?: number;
  messageId: TelegramChatId;
  chatId: TelegramChatId;
  chatTitle?: string;
  messageThreadId?: TelegramChatId;
  fromUserId?: TelegramChatId;
  fromUsername?: string;
  text?: string;
  caption?: string;
  date?: number;
  updated?: string;
  eventType?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TelegramChatRecord {
  id: string;
  title?: string;
  type?: string;
  username?: string;
  updated?: string;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TelegramCallbackQueryRecord {
  id: string;
  updateId?: number;
  chatId?: TelegramChatId;
  messageId?: TelegramChatId;
  fromUserId?: TelegramChatId;
  data?: string;
  updated?: string;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TelegramInlineQueryRecord {
  id: string;
  updateId?: number;
  fromUserId?: TelegramChatId;
  query?: string;
  offset?: string;
  updated?: string;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TelegramReactionRecord {
  id: string;
  updateId?: number;
  chatId: TelegramChatId;
  messageId: TelegramChatId;
  userId?: TelegramChatId;
  actorChatId?: TelegramChatId;
  updated?: string;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TelegramUpdateRecord {
  id: string;
  updateId: number;
  eventType: string;
  updated?: string;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TelegramBotConfigRecord {
  id: string;
  title?: string;
  updated?: string;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export type TelegramEmitRecord =
  | TelegramBotConfigRecord
  | TelegramCallbackQueryRecord
  | TelegramChatRecord
  | TelegramInlineQueryRecord
  | TelegramMessageRecord
  | TelegramReactionRecord
  | TelegramUpdateRecord
  | { id: string; _deleted: true; [key: string]: unknown };
