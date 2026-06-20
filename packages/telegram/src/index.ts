export * from './adapter.js';
export * from './digest.js';
export * from './emit-auxiliary-files.js';
export * from './layout-prompt.js';
export * from './path-mapper.js';
export * from './resources.js';
export * from './types.js';

import {
  literalModelNormalizer,
  modelBucket,
} from '@relayfile/adapter-core/sync-bucketing';

export {
  literalModelNormalizer,
  modelBucket,
  type SyncRecordBucketing,
} from '@relayfile/adapter-core/sync-bucketing';

export const syncRecordBucketing = modelBucket({
  normalizeModel: literalModelNormalizer({
    TelegramBotConfig: 'bot-config',
    botconfig: 'bot-config',
    'bot-config': 'bot-config',
    TelegramChat: 'chat',
    chat: 'chat',
    TelegramMessage: 'message',
    message: 'message',
    TelegramCallbackQuery: 'callback-query',
    CallbackQuery: 'callback-query',
    callbackquery: 'callback-query',
    'callback-query': 'callback-query',
    TelegramInlineQuery: 'inline-query',
    InlineQuery: 'inline-query',
    inlinequery: 'inline-query',
    'inline-query': 'inline-query',
    TelegramReaction: 'reaction',
    reaction: 'reaction',
    TelegramUpdate: 'update',
    update: 'update',
  }),
  buckets: {
    'bot-config': 'botConfigs',
    chat: 'chats',
    message: 'messages',
    'callback-query': 'callbackQueries',
    'inline-query': 'inlineQueries',
    reaction: 'reactions',
    update: 'updates',
  },
});
