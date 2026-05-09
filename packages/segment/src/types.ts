export const SEGMENT_WEBHOOK_OBJECT_TYPES = [
  'identify',
  'track',
  'page',
  'group',
] as const;

export type SegmentWebhookObjectType = (typeof SEGMENT_WEBHOOK_OBJECT_TYPES)[number];
export type SegmentWebhookAction = 'create' | 'update' | 'upsert';

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface SegmentAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
  sourceSecrets?: Record<string, string>;
  timestampToleranceSeconds?: number;
}

export interface SegmentContextLibrary {
  name?: string;
  version?: string;
}

export interface SegmentContextPage {
  path?: string;
  referrer?: string;
  search?: string;
  title?: string;
  url?: string;
}

export interface SegmentContextCampaign {
  name?: string;
  source?: string;
  medium?: string;
  term?: string;
  content?: string;
}

export interface SegmentContext {
  active?: boolean;
  app?: Record<string, unknown>;
  campaign?: SegmentContextCampaign;
  device?: Record<string, unknown>;
  ip?: string;
  library?: SegmentContextLibrary;
  locale?: string;
  network?: Record<string, unknown>;
  os?: Record<string, unknown>;
  page?: SegmentContextPage;
  screen?: Record<string, unknown>;
  timezone?: string;
  traits?: Record<string, unknown>;
  userAgent?: string;
  user_agent?: string;
  [key: string]: unknown;
}

export interface SegmentIntegrationSettings {
  All?: boolean;
  [destination: string]: boolean | Record<string, unknown> | undefined;
}

export interface SegmentWebhookBase {
  type: SegmentWebhookObjectType | string;
  messageId?: string;
  message_id?: string;
  anonymousId?: string;
  anonymous_id?: string;
  userId?: string;
  user_id?: string;
  groupId?: string;
  group_id?: string;
  writeKey?: string;
  write_key?: string;
  sentAt?: string;
  sent_at?: string;
  receivedAt?: string;
  received_at?: string;
  timestamp?: string;
  originalTimestamp?: string;
  original_timestamp?: string;
  context?: SegmentContext;
  integrations?: SegmentIntegrationSettings;
  properties?: Record<string, unknown>;
}

export interface SegmentIdentifyPayload extends SegmentWebhookBase {
  type: 'identify' | string;
  traits?: Record<string, unknown>;
}

export interface SegmentTrackPayload extends SegmentWebhookBase {
  type: 'track' | string;
  event?: string;
  properties?: Record<string, unknown>;
}

export interface SegmentPagePayload extends SegmentWebhookBase {
  type: 'page' | string;
  name?: string;
  category?: string;
  properties?: Record<string, unknown>;
}

export interface SegmentGroupPayload extends SegmentWebhookBase {
  type: 'group' | string;
  traits?: Record<string, unknown>;
}

export type SegmentWebhookPayload =
  | SegmentIdentifyPayload
  | SegmentTrackPayload
  | SegmentPagePayload
  | SegmentGroupPayload
  | SegmentWebhookBase;

export interface SegmentReadRequest {
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export interface SegmentWritebackRequest {
  action:
    | 'identify'
    | 'track'
    | 'page'
    | 'group'
    | 'batch';
  method: 'POST';
  endpoint: '/v1/identify' | '/v1/track' | '/v1/page' | '/v1/group' | '/v1/batch';
  body: Record<string, unknown>;
}
