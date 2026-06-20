import {
  IndexFileReconciler,
  runEmitBatch,
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import {
  telegramBotConfigPath,
  telegramByDataCallbackAliasPath,
  telegramByTitleChatAliasPath,
  telegramByUserMessageAliasPath,
  telegramByUsernameChatAliasPath,
  telegramCallbackQueriesIndexPath,
  telegramCallbackQueryPath,
  telegramChatMessagesIndexPath,
  telegramChatMetadataPath,
  telegramChatsIndexPath,
  telegramInlineQueriesIndexPath,
  telegramInlineQueryPath,
  telegramMessagePath,
  parseTelegramMessageObjectId,
  parseTelegramReactionObjectId,
  parseTelegramThreadMessageObjectId,
  telegramReactionPath,
  telegramRootIndexPath,
  telegramThreadMessagePath,
  telegramUpdatePath,
  telegramUpdatesIndexPath,
} from './path-mapper.js';
import { slugifyAlias } from './alias-slug.js';
import type {
  TelegramBotConfigRecord,
  TelegramCallbackQueryRecord,
  TelegramChatId,
  TelegramChatRecord,
  TelegramInlineQueryRecord,
  TelegramMessageRecord,
  TelegramReactionRecord,
  TelegramUpdateRecord,
} from './types.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export type TelegramDeletable<T extends { id: string }> = T | { id: string; _deleted: true };

export interface TelegramEmitAuxiliaryFilesInput {
  workspaceId: string;
  botConfigs?: readonly TelegramDeletable<TelegramBotConfigRecord>[];
  chats?: readonly TelegramDeletable<TelegramChatRecord>[];
  messages?: readonly TelegramDeletable<TelegramMessageRecord>[];
  callbackQueries?: readonly TelegramDeletable<TelegramCallbackQueryRecord>[];
  inlineQueries?: readonly TelegramDeletable<TelegramInlineQueryRecord>[];
  reactions?: readonly TelegramDeletable<TelegramReactionRecord>[];
  updates?: readonly TelegramDeletable<TelegramUpdateRecord>[];
  connectionId?: string;
}

export async function emitTelegramAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: TelegramEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  await writeRootIndex(client, input.workspaceId, aggregate);

  const chatTitleById = new Map<string, string>();
  for (const chat of input.chats ?? []) {
    if (isDelete(chat)) continue;
    const title = readChatTitle(chat);
    if (title) chatTitleById.set(String(chat.id), title);
  }
  for (const message of input.messages ?? []) {
    if (isDelete(message)) continue;
    const title = message.chatTitle ?? readChatTitle(message.chat);
    if (title) chatTitleById.set(String(message.chatId), title);
  }

  if (input.botConfigs?.length) {
    accumulate(
      aggregate,
      await runEmitBatch(client, input.workspaceId, input.botConfigs, (record) =>
        isDelete(record) ? { deletes: [{ path: telegramBotConfigPath() }] } : planBotConfig(record, input.connectionId),
      ),
    );
  }

  if (input.chats?.length) {
    accumulate(
      aggregate,
      await emitChats(client, input.workspaceId, input.chats, input.connectionId),
    );
  }

  if (input.messages?.length) {
    accumulate(
      aggregate,
      await emitMessages(client, input.workspaceId, input.messages, input.connectionId, chatTitleById),
    );
  }

  if (input.callbackQueries?.length) {
    accumulate(
      aggregate,
      await emitCallbackQueries(client, input.workspaceId, input.callbackQueries, input.connectionId),
    );
  }

  if (input.inlineQueries?.length) {
    accumulate(
      aggregate,
      await emitInlineQueries(client, input.workspaceId, input.inlineQueries, input.connectionId),
    );
  }

  if (input.reactions?.length) {
    accumulate(
      aggregate,
      await runEmitBatch(client, input.workspaceId, input.reactions, (record) =>
        isDelete(record) ? planReactionDelete(record.id, chatTitleById) : planReaction(record, input.connectionId, chatTitleById),
      ),
    );
  }

  if (input.updates?.length) {
    accumulate(
      aggregate,
      await emitUpdates(client, input.workspaceId, input.updates, input.connectionId),
    );
  }

  return aggregate;
}

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const path = telegramRootIndexPath();
  const content = json([
    { name: 'bot', path: '/telegram/bot' },
    { name: 'chats', path: '/telegram/chats' },
    { name: 'callback-queries', path: '/telegram/callback-queries' },
    { name: 'inline-queries', path: '/telegram/inline-queries' },
    { name: 'updates', path: '/telegram/updates' },
  ]);
  try {
    await client.writeFile({ workspaceId, path, content, contentType: JSON_CONTENT_TYPE });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: stringifyError(error) });
  }
}

async function emitChats(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly TelegramDeletable<TelegramChatRecord>[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const collidingTitleSlugs = computeCollidingTitleSlugs(records);
  const index = new IndexFileReconciler<TelegramIndexRow>({
    client,
    workspaceId,
    path: telegramChatsIndexPath(),
    builder: (rows) => ({
      path: telegramChatsIndexPath(),
      content: json([...rows].sort(compareRows)),
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const result = await runEmitBatch(client, workspaceId, records, (record) => {
    if (isDelete(record)) {
      index.remove(String(record.id));
      return { deletes: [{ path: telegramChatMetadataPath(record.id) }] };
    }
    const title = readChatTitle(record);
    const canonicalPath = telegramChatMetadataPath(record.id, title);
    const content = renderContent('chat', String(record.id), record, connectionId);
    const writes: EmitWrite[] = [
      { path: canonicalPath, content, contentType: JSON_CONTENT_TYPE },
    ];
    if (title) {
      writes.push({
        path: telegramByTitleChatAliasPath(title, record.id, collidingTitleSlugs.has(slugifyAlias(title))),
        content: pointerContent({ id: String(record.id), title, canonicalPath }),
        contentType: JSON_CONTENT_TYPE,
      });
    }
    if (record.username) {
      writes.push({
        path: telegramByUsernameChatAliasPath(record.username, record.id),
        content: pointerContent({ id: String(record.id), username: record.username, canonicalPath }),
        contentType: JSON_CONTENT_TYPE,
      });
    }
    index.upsert({
      id: String(record.id),
      title: title ?? '',
      updated: readUpdated(record),
      canonicalPath,
      ...(record.type ? { type: record.type } : {}),
      ...(record.username ? { username: record.username } : {}),
    });
    return { writes };
  });

  const indexResult = await index.flush();
  result.written += indexResult.written;
  result.errors.push(...indexResult.errors);
  return result;
}

async function emitMessages(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly TelegramDeletable<TelegramMessageRecord>[],
  connectionId: string | undefined,
  chatTitleById: ReadonlyMap<string, string>,
): Promise<EmitAuxiliaryFilesResult> {
  const indexByChat = new Map<string, IndexFileReconciler<TelegramIndexRow>>();
  const getIndex = (chatId: TelegramChatId, title?: string) => {
    const key = String(chatId);
    let index = indexByChat.get(key);
    if (!index) {
      const path = telegramChatMessagesIndexPath(chatId, title);
      index = new IndexFileReconciler<TelegramIndexRow>({
        client,
        workspaceId,
        path,
        builder: (rows) => ({
          path,
          content: json([...rows].sort(compareRows)),
          contentType: JSON_CONTENT_TYPE,
        }),
      });
      indexByChat.set(key, index);
    }
    return index;
  };

  const result = await runEmitBatch(client, workspaceId, records, (record) => {
    if (isDelete(record)) return planMessageDelete(record.id, chatTitleById, getIndex);
    const chatTitle = record.chatTitle ?? chatTitleById.get(String(record.chatId));
    const canonicalPath = record.messageThreadId === undefined
      ? telegramMessagePath(record.chatId, record.messageId, chatTitle)
      : telegramThreadMessagePath(record.chatId, record.messageThreadId, record.messageId, chatTitle);
    const writes: EmitWrite[] = [
      {
        path: canonicalPath,
        content: renderContent('message', String(record.id), record, connectionId),
        contentType: JSON_CONTENT_TYPE,
      },
    ];
    if (record.fromUserId !== undefined) {
      writes.push({
        path: telegramByUserMessageAliasPath(record.fromUserId, record.chatId, record.messageId),
        content: pointerContent({
          id: String(record.id),
          chatId: String(record.chatId),
          messageId: String(record.messageId),
          fromUserId: String(record.fromUserId),
          canonicalPath,
        }),
        contentType: JSON_CONTENT_TYPE,
      });
    }
    getIndex(record.chatId, chatTitle).upsert({
      id: String(record.messageId),
      title: readMessageTitle(record),
      updated: readUpdated(record),
      canonicalPath,
      ...(record.fromUserId !== undefined ? { fromUserId: String(record.fromUserId) } : {}),
    });
    return { writes };
  });

  for (const index of indexByChat.values()) {
    const indexResult = await index.flush();
    result.written += indexResult.written;
    result.errors.push(...indexResult.errors);
  }
  return result;
}

async function emitCallbackQueries(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly TelegramDeletable<TelegramCallbackQueryRecord>[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const index = new IndexFileReconciler<TelegramIndexRow>({
    client,
    workspaceId,
    path: telegramCallbackQueriesIndexPath(),
    builder: (rows) => ({ path: telegramCallbackQueriesIndexPath(), content: json([...rows].sort(compareRows)), contentType: JSON_CONTENT_TYPE }),
  });
  const result = await runEmitBatch(client, workspaceId, records, (record) => {
    if (isDelete(record)) {
      index.remove(String(record.id));
      return { deletes: [{ path: telegramCallbackQueryPath(record.id) }] };
    }
    const canonicalPath = telegramCallbackQueryPath(record.id);
    const writes: EmitWrite[] = [
      { path: canonicalPath, content: renderContent('callback_query', record.id, record, connectionId), contentType: JSON_CONTENT_TYPE },
    ];
    if (record.data) {
      writes.push({
        path: telegramByDataCallbackAliasPath(record.data, record.id),
        content: pointerContent({ id: record.id, data: record.data, canonicalPath }),
        contentType: JSON_CONTENT_TYPE,
      });
    }
    index.upsert({
      id: record.id,
      title: record.data ?? record.id,
      updated: readUpdated(record),
      canonicalPath,
    });
    return { writes };
  });
  const indexResult = await index.flush();
  result.written += indexResult.written;
  result.errors.push(...indexResult.errors);
  return result;
}

async function emitInlineQueries(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly TelegramDeletable<TelegramInlineQueryRecord>[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const index = new IndexFileReconciler<TelegramIndexRow>({
    client,
    workspaceId,
    path: telegramInlineQueriesIndexPath(),
    builder: (rows) => ({ path: telegramInlineQueriesIndexPath(), content: json([...rows].sort(compareRows)), contentType: JSON_CONTENT_TYPE }),
  });
  const result = await runEmitBatch(client, workspaceId, records, (record) => {
    if (isDelete(record)) {
      index.remove(String(record.id));
      return { deletes: [{ path: telegramInlineQueryPath(record.id) }] };
    }
    const canonicalPath = telegramInlineQueryPath(record.id);
    index.upsert({
      id: record.id,
      title: record.query ?? record.id,
      updated: readUpdated(record),
      canonicalPath,
    });
    return {
      writes: [
        { path: canonicalPath, content: renderContent('inline_query', record.id, record, connectionId), contentType: JSON_CONTENT_TYPE },
      ],
    };
  });
  const indexResult = await index.flush();
  result.written += indexResult.written;
  result.errors.push(...indexResult.errors);
  return result;
}

async function emitUpdates(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly TelegramDeletable<TelegramUpdateRecord>[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const index = new IndexFileReconciler<TelegramIndexRow>({
    client,
    workspaceId,
    path: telegramUpdatesIndexPath(),
    builder: (rows) => ({ path: telegramUpdatesIndexPath(), content: json([...rows].sort(compareRows)), contentType: JSON_CONTENT_TYPE }),
  });
  const result = await runEmitBatch(client, workspaceId, records, (record) => {
    if (isDelete(record)) {
      index.remove(String(record.id));
      return { deletes: [{ path: telegramUpdatePath(record.id) }] };
    }
    const canonicalPath = telegramUpdatePath(record.updateId);
    index.upsert({
      id: String(record.updateId),
      title: record.eventType,
      updated: readUpdated(record),
      canonicalPath,
    });
    return {
      writes: [
        { path: canonicalPath, content: renderContent('update', String(record.updateId), record, connectionId), contentType: JSON_CONTENT_TYPE },
      ],
    };
  });
  const indexResult = await index.flush();
  result.written += indexResult.written;
  result.errors.push(...indexResult.errors);
  return result;
}

function planBotConfig(record: TelegramBotConfigRecord, connectionId: string | undefined): EmitPlan {
  return {
    writes: [
      {
        path: telegramBotConfigPath(),
        content: renderContent('bot_config', record.id, record, connectionId),
        contentType: JSON_CONTENT_TYPE,
      },
    ],
  };
}

function planReaction(
  record: TelegramReactionRecord,
  connectionId: string | undefined,
  chatTitleById: ReadonlyMap<string, string>,
): EmitPlan {
  const path = telegramReactionPath(
    record.chatId,
    record.messageId,
    record.updateId ?? record.id,
    chatTitleById.get(String(record.chatId)),
  );
  return {
    writes: [
      { path, content: renderContent('reaction', record.id, record, connectionId), contentType: JSON_CONTENT_TYPE },
    ],
  };
}

function planReactionDelete(
  id: string,
  chatTitleById: ReadonlyMap<string, string>,
): EmitPlan {
  const parsed = parseTelegramReactionObjectId(id);
  if (!parsed) {
    return { deletes: [] };
  }

  return {
    deletes: [
      {
        path: telegramReactionPath(
          parsed.chatId,
          parsed.messageId,
          parsed.updateId,
          chatTitleById.get(String(parsed.chatId)),
        ),
      },
    ],
  };
}

function planMessageDelete(
  id: string,
  chatTitleById: ReadonlyMap<string, string>,
  getIndex: (chatId: TelegramChatId, title?: string) => IndexFileReconciler<TelegramIndexRow>,
): EmitPlan {
  const thread = parseTelegramThreadMessageObjectId(id);
  if (thread) {
    const chatTitle = chatTitleById.get(String(thread.chatId));
    getIndex(thread.chatId, chatTitle).remove(thread.messageId);
    return {
      deletes: [
        {
          path: telegramThreadMessagePath(thread.chatId, thread.threadId, thread.messageId, chatTitle),
        },
      ],
    };
  }

  const message = parseTelegramMessageObjectId(id);
  if (!message) return { deletes: [] };

  const chatTitle = chatTitleById.get(String(message.chatId));
  getIndex(message.chatId, chatTitle).remove(message.messageId);
  return {
    deletes: [
      {
        path: telegramMessagePath(message.chatId, message.messageId, chatTitle),
      },
    ],
  };
}

interface TelegramIndexRow {
  id: string;
  title: string;
  updated: string;
  canonicalPath?: string;
  [key: string]: unknown;
}

function renderContent(
  objectType: string,
  id: string,
  record: Record<string, unknown>,
  connectionId: string | undefined,
): string {
  return json({
    provider: 'telegram',
    objectType,
    id,
    ...(connectionId ? { connectionId } : {}),
    record,
  });
}

function pointerContent(pointer: Record<string, unknown>): string {
  return json(pointer);
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function isDelete(record: unknown): record is { id: string; _deleted: true } {
  return Boolean(
    record
      && typeof record === 'object'
      && !Array.isArray(record)
      && (record as { _deleted?: unknown })._deleted === true
      && typeof (record as { id?: unknown }).id === 'string',
  );
}

function readChatTitle(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined;
  for (const key of ['title', 'username', 'first_name', 'name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readMessageTitle(record: TelegramMessageRecord): string {
  const text = record.text ?? record.caption;
  if (!text) return String(record.messageId);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function readUpdated(record: Record<string, unknown>): string {
  for (const key of ['updated', 'updated_at', 'edit_date', 'date']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  }
  return new Date(0).toISOString();
}

function compareRows(left: TelegramIndexRow, right: TelegramIndexRow): number {
  if (left.updated !== right.updated) return right.updated.localeCompare(left.updated);
  return left.id.localeCompare(right.id);
}

function computeCollidingTitleSlugs(
  records: readonly TelegramDeletable<TelegramChatRecord>[],
): ReadonlySet<string> {
  const slugToIds = new Map<string, Set<string>>();
  for (const record of records) {
    if (isDelete(record)) continue;
    const title = readChatTitle(record);
    if (!title) continue;
    const slug = slugifyAlias(title);
    if (slug === 'untitled') continue;
    let ids = slugToIds.get(slug);
    if (!ids) {
      ids = new Set();
      slugToIds.set(slug, ids);
    }
    ids.add(String(record.id));
  }
  const colliding = new Set<string>();
  for (const [slug, ids] of slugToIds) {
    if (ids.size > 1) colliding.add(slug);
  }
  return colliding;
}

function accumulate(target: EmitAuxiliaryFilesResult, source: EmitAuxiliaryFilesResult): void {
  target.written += source.written;
  target.deleted += source.deleted;
  target.errors.push(...source.errors);
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
