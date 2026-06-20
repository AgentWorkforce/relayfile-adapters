import { computeTelegramPath } from './path-mapper.js';

export const TELEGRAM_SUPPORTED_EVENTS = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
  'guest_message',
  'message_reaction',
  'message_reaction_count',
  'inline_query',
  'chosen_inline_result',
  'callback_query',
  'shipping_query',
  'pre_checkout_query',
  'purchased_paid_media',
  'poll',
  'poll_answer',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
  'chat_boost',
  'removed_chat_boost',
  'managed_bot',
] as const;

export class TelegramAdapter {
  readonly name = 'telegram';
  readonly version = '0.1.0';

  supportedEvents(): string[] {
    return [...TELEGRAM_SUPPORTED_EVENTS];
  }

  computePath(objectType: string, objectId: string): string {
    return computeTelegramPath(objectType, objectId);
  }
}
