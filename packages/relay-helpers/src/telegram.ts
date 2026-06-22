import type { IntegrationClientOptions, WritebackReceipt } from '@relayfile/adapter-core/vfs-client';
import { providerClient, type ProviderClient } from './provider-client.js';
import { withProcessWritebackIdempotency } from './writeback-idempotency.js';

export type TelegramChatId = string | number;
export type TelegramMessageId = string | number;
export type TelegramParseMode = 'Markdown' | 'MarkdownV2' | 'HTML';

export interface TelegramSendMessageOptions {
  replyToMessageId?: TelegramMessageId;
  threadId?: TelegramMessageId;
  parseMode?: TelegramParseMode;
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
  replyMarkup?: Record<string, unknown>;
  businessConnectionId?: string;
}

export interface TelegramEditMessageOptions {
  parseMode?: TelegramParseMode;
  disableWebPagePreview?: boolean;
  replyMarkup?: Record<string, unknown>;
  businessConnectionId?: string;
}

export interface TelegramMessageResult {
  ok: boolean;
  chatId: TelegramChatId;
  messageId: string;
  ref: string;
}

export interface TelegramReactionResult {
  ok: boolean;
  chatId: TelegramChatId;
  messageId: string;
}

function receiptValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/**
 * The delivered Telegram message id off a writeback receipt.
 *
 * Kept as `telegramReceiptTs` to mirror `slackReceiptTs` for callers moving
 * between Slack and Telegram helpers.
 */
export function telegramReceiptTs(
  receipt:
    | (WritebackReceipt & {
        ok?: unknown;
        messageId?: unknown;
        message_id?: unknown;
      })
    | undefined
): string {
  if (!receipt) return '';
  return (
    receiptValue(receipt.externalId) ??
    receiptValue(receipt.messageId) ??
    receiptValue(receipt.message_id) ??
    receiptValue(receipt.id) ??
    ''
  );
}

export const telegramReceiptMessageId = telegramReceiptTs;

function receiptOk(receipt: WritebackReceipt | undefined, messageId: string): boolean {
  if (!receipt) return false;
  return typeof receipt.ok === 'boolean' ? receipt.ok : messageId.length > 0;
}

function sendBody(text: string, opts: TelegramSendMessageOptions): Record<string, unknown> {
  return {
    text,
    ...(opts.replyToMessageId !== undefined ? { reply_to_message_id: opts.replyToMessageId } : {}),
    ...(opts.threadId !== undefined ? { message_thread_id: opts.threadId } : {}),
    ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
    ...(opts.disableWebPagePreview !== undefined ? { disable_web_page_preview: opts.disableWebPagePreview } : {}),
    ...(opts.disableNotification !== undefined ? { disable_notification: opts.disableNotification } : {}),
    ...(opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
    ...(opts.businessConnectionId ? { business_connection_id: opts.businessConnectionId } : {}),
  };
}

function editBody(text: string, opts: TelegramEditMessageOptions): Record<string, unknown> {
  return {
    text,
    ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
    ...(opts.disableWebPagePreview !== undefined ? { disable_web_page_preview: opts.disableWebPagePreview } : {}),
    ...(opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
    ...(opts.businessConnectionId ? { business_connection_id: opts.businessConnectionId } : {}),
  };
}

function withIdempotency(body: Record<string, unknown>): Record<string, unknown> {
  return withProcessWritebackIdempotency(body);
}

export interface TelegramClient extends ProviderClient<'telegram'> {
  /** Send a message to a chat. */
  sendMessage(
    chatId: TelegramChatId,
    text: string,
    opts?: TelegramSendMessageOptions
  ): Promise<TelegramMessageResult>;
  /** Edit a delivered message. */
  editMessage(
    chatId: TelegramChatId,
    messageId: TelegramMessageId,
    text: string,
    opts?: TelegramEditMessageOptions
  ): Promise<TelegramMessageResult>;
  /** Set an emoji reaction on a message. */
  react(chatId: TelegramChatId, messageId: TelegramMessageId, emoji: string): Promise<TelegramReactionResult>;
}

/**
 * Ergonomic Telegram client over the writeback-path catalog, plus the uniform
 * resource-keyed access (`.messages`, `.reactions`, `.callback-queries`, ...).
 */
export function telegramClient(opts: IntegrationClientOptions = {}): TelegramClient {
  const base = providerClient('telegram', opts);
  return Object.assign(base, {
    async sendMessage(chatId: TelegramChatId, text: string, opts: TelegramSendMessageOptions = {}) {
      const result = await base.messages.write({ chatId }, withIdempotency(sendBody(text, opts)));
      const messageId = telegramReceiptTs(result.receipt);
      return { ok: receiptOk(result.receipt, messageId), chatId, messageId, ref: result.path };
    },
    async editMessage(
      chatId: TelegramChatId,
      messageId: TelegramMessageId,
      text: string,
      opts: TelegramEditMessageOptions = {}
    ) {
      const result = await base.messages.write({ chatId, messageId }, editBody(text, opts));
      const receiptMessageId = telegramReceiptTs(result.receipt) || String(messageId);
      return {
        ok: result.receipt ? receiptOk(result.receipt, receiptMessageId) : true,
        chatId,
        messageId: receiptMessageId,
        ref: result.path,
      };
    },
    async react(chatId: TelegramChatId, messageId: TelegramMessageId, emoji: string) {
      await base.reactions.write(
        { chatId, messageId },
        { reaction: [{ type: 'emoji', emoji }] }
      );
      return { ok: true, chatId, messageId: String(messageId) };
    },
  }) as TelegramClient;
}
