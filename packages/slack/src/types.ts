export interface SlackAdapterConfig {
  signingSecret: string;
  botToken?: string;
  appToken?: string;
  apiBaseUrl?: string;
  filesRoot?: string;
  connectionId?: string;
  includeBotMessages?: boolean;
  normalizeThreads?: boolean;
}

export const SLACK_CHANNEL_TYPES = ['app_home', 'channel', 'group', 'im', 'mpim'] as const;
export const SLACK_ENVELOPE_EVENT_TYPES = [
  'app_rate_limited',
  'event_callback',
  'url_verification',
] as const;
export const SLACK_MESSAGE_SUBTYPES = [
  'bot_message',
  'channel_join',
  'channel_leave',
  'file_share',
  'me_message',
  'message_changed',
  'message_deleted',
  'thread_broadcast',
] as const;
export const SLACK_REACTION_ITEM_TYPES = ['file', 'file_comment', 'message'] as const;
export const SLACK_CHANNEL_EVENT_TYPES = [
  'channel_archive',
  'channel_created',
  'channel_rename',
  'channel_unarchive',
  'member_joined_channel',
  'member_left_channel',
] as const;

export type SlackChannelType = (typeof SLACK_CHANNEL_TYPES)[number];
export type SlackEnvelopeEventType = (typeof SLACK_ENVELOPE_EVENT_TYPES)[number];
export type SlackMessageSubtype = (typeof SLACK_MESSAGE_SUBTYPES)[number];
export type SlackReactionItemType = (typeof SLACK_REACTION_ITEM_TYPES)[number];
export type SlackChannelEventType = (typeof SLACK_CHANNEL_EVENT_TYPES)[number];
export type SlackEventType =
  | SlackChannelEventType
  | 'message'
  | 'reaction_added'
  | 'reaction_removed';

export interface SlackAuthorization {
  enterprise_id?: string | null;
  is_bot?: boolean;
  is_enterprise_install?: boolean;
  team_id?: string | null;
  user_id?: string;
}

export interface SlackAttachment {
  fallback?: string;
  footer?: string;
  id?: number;
  pretext?: string;
  text?: string;
  title?: string;
  title_link?: string;
}

export interface SlackBlock {
  type: string;
  block_id?: string;
  [key: string]: unknown;
}

export interface SlackFile {
  id: string;
  mimetype?: string;
  mode?: string;
  name?: string;
  title?: string;
  url_private?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  created?: number;
  creator?: string;
  is_archived?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
}

export interface SlackEventBase {
  type: SlackEventType;
  event_ts?: string;
  ts?: string;
  user?: string;
}

export interface SlackMessageEvent extends SlackEventBase {
  type: 'message';
  channel: string;
  channel_type?: SlackChannelType;
  attachments?: SlackAttachment[];
  blocks?: SlackBlock[];
  bot_id?: string;
  files?: SlackFile[];
  subtype?: SlackMessageSubtype;
  text?: string;
  thread_ts?: string;
  ts: string;
}

export interface SlackReactionItem {
  type: SlackReactionItemType;
  channel?: string;
  file?: string;
  file_comment?: string;
  ts?: string;
}

export interface SlackReactionAddedEvent extends SlackEventBase {
  type: 'reaction_added';
  event_ts: string;
  item: SlackReactionItem;
  item_user?: string;
  reaction: string;
  user: string;
}

export interface SlackReactionRemovedEvent extends SlackEventBase {
  type: 'reaction_removed';
  event_ts: string;
  item: SlackReactionItem;
  item_user?: string;
  reaction: string;
  user: string;
}

export interface SlackChannelCreatedEvent extends SlackEventBase {
  type: 'channel_created';
  channel: SlackChannel;
  event_ts: string;
}

export interface SlackChannelRenameEvent extends SlackEventBase {
  type: 'channel_rename';
  channel: Pick<SlackChannel, 'created' | 'id' | 'name'>;
  event_ts: string;
}

export interface SlackChannelArchiveEvent extends SlackEventBase {
  type: 'channel_archive';
  channel: string;
  event_ts: string;
  user?: string;
}

export interface SlackChannelUnarchiveEvent extends SlackEventBase {
  type: 'channel_unarchive';
  channel: string;
  event_ts: string;
  user?: string;
}

export interface SlackMemberJoinedChannelEvent extends SlackEventBase {
  type: 'member_joined_channel';
  channel: string;
  channel_type?: SlackChannelType;
  event_ts: string;
  inviter?: string;
  team?: string;
  user: string;
}

export interface SlackMemberLeftChannelEvent extends SlackEventBase {
  type: 'member_left_channel';
  channel: string;
  channel_type?: SlackChannelType;
  event_ts: string;
  team?: string;
  user: string;
}

export type SlackChannelEvent =
  | SlackChannelArchiveEvent
  | SlackChannelCreatedEvent
  | SlackChannelRenameEvent
  | SlackChannelUnarchiveEvent
  | SlackMemberJoinedChannelEvent
  | SlackMemberLeftChannelEvent;

export type SlackEvent =
  | SlackChannelEvent
  | SlackMessageEvent
  | SlackReactionAddedEvent
  | SlackReactionRemovedEvent;

export interface SlackEnvelopeBase {
  api_app_id?: string;
  authorizations?: SlackAuthorization[];
  context_enterprise_id?: string | null;
  context_team_id?: string;
  event_context?: string;
  team_id?: string;
  token?: string;
  type: SlackEnvelopeEventType;
}

export interface SlackAppRateLimitedEnvelope extends SlackEnvelopeBase {
  type: 'app_rate_limited';
  minute_rate_limited: number;
  team_id: string;
}

export interface SlackEventCallbackEnvelope extends SlackEnvelopeBase {
  type: 'event_callback';
  event: SlackEvent;
  event_id: string;
  event_time: number;
  is_ext_shared_channel?: boolean;
}

export interface SlackUrlVerificationEnvelope extends SlackEnvelopeBase {
  type: 'url_verification';
  challenge: string;
}

export type SlackEnvelope =
  | SlackAppRateLimitedEnvelope
  | SlackEventCallbackEnvelope
  | SlackUrlVerificationEnvelope;
