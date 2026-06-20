import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';

const TELEGRAM_ROOT = '/telegram';

export type TelegramPathObjectType =
  | 'bot_config'
  | 'callback_query'
  | 'chat'
  | 'inline_query'
  | 'message'
  | 'reaction'
  | 'update';

export interface TelegramMessageReference {
  chatId: string;
  messageId: string;
}

export interface TelegramThreadMessageReference extends TelegramMessageReference {
  threadId: string;
}

export interface TelegramReactionReference extends TelegramMessageReference {
  updateId: string;
}

function normalizeSegment(value: string | number | undefined, fallback = 'unknown'): string {
  const raw = value === undefined ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^A-Za-z0-9._+=@-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

function joinPath(...segments: string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .map((segment, index) => {
      if (index === 0) return segment.replace(/\/+$/g, '') || '/';
      return segment.replace(/^\/+|\/+$/g, '');
    })
    .join('/');
}

export function sanitizeTelegramPathSegment(value: string | number | undefined, fallback = 'unknown'): string {
  return normalizeSegment(value, fallback);
}

export function telegramNameWithId(humanReadable: string | undefined, id: string | number): string {
  const normalizedId = normalizeSegment(id);
  const name = humanReadable?.trim();
  if (!name) return normalizedId;
  const slug = slugifyAlias(name);
  return slug && slug !== 'untitled' ? `${normalizedId}__${slug}` : normalizedId;
}

export function telegramRootIndexPath(): string {
  return joinPath(TELEGRAM_ROOT, '_index.json');
}

export function telegramChatsIndexPath(): string {
  return joinPath(TELEGRAM_ROOT, 'chats', '_index.json');
}

export function telegramCallbackQueriesIndexPath(): string {
  return joinPath(TELEGRAM_ROOT, 'callback-queries', '_index.json');
}

export function telegramInlineQueriesIndexPath(): string {
  return joinPath(TELEGRAM_ROOT, 'inline-queries', '_index.json');
}

export function telegramUpdatesIndexPath(): string {
  return joinPath(TELEGRAM_ROOT, 'updates', '_index.json');
}

export function telegramBotConfigPath(): string {
  return joinPath(TELEGRAM_ROOT, 'bot', 'config.json');
}

export function telegramChatDirectory(chatId: string | number, title?: string): string {
  return joinPath(TELEGRAM_ROOT, 'chats', telegramNameWithId(title, chatId));
}

export function telegramChatMetadataPath(chatId: string | number, title?: string): string {
  return joinPath(telegramChatDirectory(chatId, title), 'meta.json');
}

export function telegramChatMessagesIndexPath(chatId: string | number, title?: string): string {
  return joinPath(telegramChatDirectory(chatId, title), 'messages', '_index.json');
}

export function telegramMessagePath(
  chatId: string | number,
  messageId: string | number,
  chatTitle?: string,
): string {
  return joinPath(
    telegramChatDirectory(chatId, chatTitle),
    'messages',
    normalizeSegment(messageId),
    'meta.json',
  );
}

export function telegramThreadMessagePath(
  chatId: string | number,
  threadId: string | number,
  messageId: string | number,
  chatTitle?: string,
): string {
  return joinPath(
    telegramChatDirectory(chatId, chatTitle),
    'threads',
    normalizeSegment(threadId),
    'messages',
    normalizeSegment(messageId),
    'meta.json',
  );
}

export function telegramReactionPath(
  chatId: string | number,
  messageId: string | number,
  updateId: string | number,
  chatTitle?: string,
): string {
  return joinPath(
    telegramChatDirectory(chatId, chatTitle),
    'messages',
    normalizeSegment(messageId),
    'reactions',
    `${normalizeSegment(updateId)}.json`,
  );
}

export function telegramCallbackQueryPath(callbackQueryId: string): string {
  return joinPath(TELEGRAM_ROOT, 'callback-queries', `${normalizeSegment(callbackQueryId)}.json`);
}

export function telegramInlineQueryPath(inlineQueryId: string): string {
  return joinPath(TELEGRAM_ROOT, 'inline-queries', `${normalizeSegment(inlineQueryId)}.json`);
}

export function telegramUpdatePath(updateId: string | number): string {
  return joinPath(TELEGRAM_ROOT, 'updates', `${normalizeSegment(updateId)}.json`);
}

export function telegramByTitleChatAliasPath(
  title: string,
  chatId: string | number,
  colliding = false,
): string {
  const slug = slugifyAlias(title);
  const suffix = colliding ? `-${aliasCollisionSuffix(String(chatId))}` : '';
  return joinPath(TELEGRAM_ROOT, 'chats', 'by-title', `${slug}${suffix}__${normalizeSegment(chatId)}.json`);
}

export function telegramByUsernameChatAliasPath(username: string, chatId: string | number): string {
  const slug = slugifyAlias(username.replace(/^@/, ''));
  return joinPath(TELEGRAM_ROOT, 'chats', 'by-username', `${slug}__${normalizeSegment(chatId)}.json`);
}

export function telegramByUserMessageAliasPath(
  userId: string | number,
  chatId: string | number,
  messageId: string | number,
): string {
  const slug = slugifyAlias(String(userId));
  const id = `${normalizeSegment(chatId)}__${normalizeSegment(messageId)}`;
  return joinPath(TELEGRAM_ROOT, 'messages', 'by-user', `${slug}__${id}.json`);
}

export function telegramByDataCallbackAliasPath(data: string, callbackQueryId: string): string {
  return joinPath(
    TELEGRAM_ROOT,
    'callback-queries',
    'by-data',
    `${slugifyAlias(data)}__${normalizeSegment(callbackQueryId)}.json`,
  );
}

export function createTelegramMessageObjectId(chatId: string | number, messageId: string | number): string {
  return `${normalizeSegment(chatId)}:${normalizeSegment(messageId)}`;
}

export function createTelegramThreadMessageObjectId(
  chatId: string | number,
  threadId: string | number,
  messageId: string | number,
): string {
  return `${normalizeSegment(chatId)}:${normalizeSegment(threadId)}:${normalizeSegment(messageId)}`;
}

export function createTelegramReactionObjectId(
  chatId: string | number,
  messageId: string | number,
  updateId: string | number,
): string {
  return `${normalizeSegment(chatId)}:${normalizeSegment(messageId)}:${normalizeSegment(updateId)}`;
}

export function parseTelegramMessageObjectId(objectId: string): TelegramMessageReference | null {
  const [chatId, messageId, extra] = objectId.split(':');
  if (!chatId || !messageId || extra) return null;
  return { chatId, messageId };
}

export function parseTelegramThreadMessageObjectId(objectId: string): TelegramThreadMessageReference | null {
  const [chatId, threadId, messageId, extra] = objectId.split(':');
  if (!chatId || !threadId || !messageId || extra) return null;
  return { chatId, threadId, messageId };
}

export function parseTelegramReactionObjectId(objectId: string): TelegramReactionReference | null {
  const [chatId, messageId, updateId, extra] = objectId.split(':');
  if (!chatId || !messageId || !updateId || extra) return null;
  return { chatId, messageId, updateId };
}

export function computeTelegramPath(objectType: string, objectId: string): string {
  switch (objectType as TelegramPathObjectType) {
    case 'bot_config':
      return telegramBotConfigPath();
    case 'chat':
      return telegramChatMetadataPath(objectId);
    case 'message': {
      const parsed = parseTelegramMessageObjectId(objectId);
      if (!parsed) throw new Error(`Invalid Telegram message object id: ${objectId}`);
      return telegramMessagePath(parsed.chatId, parsed.messageId);
    }
    case 'reaction': {
      const parsed = parseTelegramReactionObjectId(objectId);
      if (!parsed) throw new Error(`Invalid Telegram reaction object id: ${objectId}`);
      return telegramReactionPath(parsed.chatId, parsed.messageId, parsed.updateId);
    }
    case 'callback_query':
      return telegramCallbackQueryPath(objectId);
    case 'inline_query':
      return telegramInlineQueryPath(objectId);
    case 'update':
      return telegramUpdatePath(objectId);
    default:
      throw new Error(`Unsupported Telegram object type: ${objectType}`);
  }
}
