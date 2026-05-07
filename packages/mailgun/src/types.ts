export const MAILGUN_WEBHOOK_OBJECT_TYPES = [
  'message',
  'event',
  'list',
] as const;

export const MAILGUN_WEBHOOK_ACTIONS = [
  'accepted',
  'clicked',
  'complained',
  'created',
  'delivered',
  'failed',
  'opened',
  'permanent_fail',
  'stored',
  'unsubscribed',
  'updated',
] as const;

export type MailgunWebhookObjectType = (typeof MAILGUN_WEBHOOK_OBJECT_TYPES)[number];
export type MailgunWebhookAction = (typeof MAILGUN_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface MailgunAdapterConfig {
  apiKey?: string;
  apiUrl?: string;
  connectionId?: string;
  defaultDomain?: string;
  provider?: string;
  providerConfigKey?: string;
  signingKey?: string;
  timestampToleranceSeconds?: number;
}

export interface MailgunSignaturePayload {
  timestamp: string;
  token: string;
  signature: string;
}

export interface MailgunMessageRecipient {
  email?: string;
  name?: string;
  type?: 'bcc' | 'cc' | 'to' | string;
}

export interface MailgunMessagePayload {
  id: string;
  domain?: string;
  messageId?: string;
  message_id?: string;
  subject?: string;
  from?: string;
  sender?: string;
  to?: string | string[] | MailgunMessageRecipient[];
  cc?: string | string[] | MailgunMessageRecipient[];
  bcc?: string | string[] | MailgunMessageRecipient[];
  recipient?: string;
  recipients?: string[];
  tags?: string[];
  campaigns?: string[];
  userVariables?: Record<string, unknown>;
  user_variables?: Record<string, unknown>;
  storage?: {
    key?: string;
    url?: string;
  };
  url?: string;
  size?: number;
  createdAt?: string;
  created_at?: string;
  timestamp?: number | string;
}

export interface MailgunEventPayload {
  id: string;
  domain?: string;
  event: string;
  severity?: string;
  reason?: string;
  deliveryStatus?: {
    code?: number;
    description?: string;
    message?: string;
  };
  delivery_status?: {
    code?: number;
    description?: string;
    message?: string;
  };
  envelope?: {
    sender?: string;
    targets?: string;
    transport?: string;
  };
  flags?: Record<string, boolean>;
  geolocation?: {
    city?: string;
    country?: string;
    region?: string;
  };
  message?: Partial<MailgunMessagePayload> & Record<string, unknown>;
  recipient?: string;
  tags?: string[];
  timestamp?: number | string;
  url?: string;
}

export interface MailgunListPayload {
  id?: string;
  address: string;
  accessLevel?: string;
  access_level?: string;
  createdAt?: string;
  created_at?: string;
  description?: string;
  membersCount?: number;
  members_count?: number;
  name?: string;
  replyPreference?: string;
  reply_preference?: string;
  domain?: string;
  url?: string;
}

export interface MailgunWebhookBase<TData extends Record<string, unknown>> {
  signature?: MailgunSignaturePayload;
  event?: string;
  timestamp?: number | string;
  domain?: string;
  recipient?: string;
  message?: Record<string, unknown>;
  'event-data'?: TData;
  eventData?: TData;
  data?: TData;
  metadata?: Record<string, unknown>;
  connectionId?: string;
  connection_id?: string;
  provider?: string;
  providerConfigKey?: string;
  provider_config_key?: string;
}

export type MailgunMessageWebhookPayload = MailgunWebhookBase<MailgunMessagePayload & Record<string, unknown>>;
export type MailgunEventWebhookPayload = MailgunWebhookBase<MailgunEventPayload & Record<string, unknown>>;
export type MailgunListWebhookPayload = MailgunWebhookBase<MailgunListPayload & Record<string, unknown>>;

export type MailgunWebhookPayload =
  | MailgunMessageWebhookPayload
  | MailgunEventWebhookPayload
  | MailgunListWebhookPayload;

export interface MailgunApiRequest {
  endpoint: string;
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  query?: Record<string, string>;
}

export interface MailgunWritebackRequest {
  action:
    | 'create_list'
    | 'send_message'
    | 'update_list'
    | 'upsert_list_member';
  method: 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  body: Record<string, unknown>;
}
