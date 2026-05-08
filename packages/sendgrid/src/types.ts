export const SENDGRID_WEBHOOK_OBJECT_TYPES = ['mail', 'event', 'contact'] as const;
export const SENDGRID_WEBHOOK_ACTIONS = [
  'bounce',
  'click',
  'create',
  'deferred',
  'delete',
  'delivered',
  'dropped',
  'group_resubscribe',
  'group_unsubscribe',
  'open',
  'processed',
  'spamreport',
  'unsubscribe',
  'update',
] as const;

export type SendGridWebhookObjectType = (typeof SENDGRID_WEBHOOK_OBJECT_TYPES)[number];
export type SendGridWebhookAction = (typeof SENDGRID_WEBHOOK_ACTIONS)[number] | string;

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface SendGridAdapterConfig {
  apiUrl?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookPublicKey?: string | Buffer;
  webhookTimestampToleranceMs?: number;
  webhookFingerprintSecret?: string;
}

export interface SendGridMailAddress {
  email: string;
  name?: string;
}

export interface SendGridMailPersonalization {
  to?: SendGridMailAddress[];
  cc?: SendGridMailAddress[];
  bcc?: SendGridMailAddress[];
  subject?: string;
  headers?: Record<string, string>;
  substitutions?: Record<string, string>;
  dynamic_template_data?: Record<string, JsonValue | undefined>;
  custom_args?: Record<string, string>;
  send_at?: number;
}

export interface SendGridMail {
  id?: string;
  message_id?: string;
  batch_id?: string;
  asm?: {
    group_id?: number;
    groups_to_display?: number[];
  };
  categories?: string[];
  content?: Array<{
    type?: string;
    value?: string;
  }>;
  custom_args?: Record<string, string>;
  from?: SendGridMailAddress;
  headers?: Record<string, string>;
  mail_settings?: Record<string, JsonValue | undefined>;
  personalizations?: SendGridMailPersonalization[];
  reply_to?: SendGridMailAddress;
  send_at?: number;
  subject?: string;
  template_id?: string;
  tracking_settings?: Record<string, JsonValue | undefined>;
  created_at?: string;
  updated_at?: string;
}

export interface SendGridEvent {
  sg_event_id?: string;
  sg_message_id?: string;
  smtp_id?: string;
  'smtp-id'?: string;
  email?: string;
  event?: string;
  timestamp?: number;
  category?: string[] | string;
  reason?: string;
  status?: string;
  response?: string;
  attempt?: string;
  type?: string;
  url?: string;
  useragent?: string;
  ip?: string;
  asm_group_id?: number;
  marketing_campaign_id?: number;
  marketing_campaign_name?: string;
  send_at?: number;
  tls?: boolean;
  cert_err?: boolean;
  bounce_classification?: string;
  url_offset?: {
    index?: number;
    type?: string;
  };
  [key: string]: JsonValue | JsonValue[] | Record<string, unknown> | undefined;
}

export interface SendGridContact {
  id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  alternate_emails?: string[];
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  state_province_region?: string;
  postal_code?: string;
  country?: string;
  phone_number?: string;
  whatsapp?: string;
  line?: string;
  facebook?: string;
  unique_name?: string;
  custom_fields?: Record<string, JsonValue | undefined>;
  list_ids?: string[];
  created_at?: string;
  updated_at?: string;
}

export type SendGridWebhookPayloadRecord = Record<string, JsonValue | JsonValue[] | undefined>;

export interface SendGridWebhookBase<TData> {
  action?: SendGridWebhookAction;
  type?: SendGridWebhookObjectType | string;
  event?: string;
  createdAt?: string;
  created_at?: string;
  timestamp?: number;
  data?: TData;
  contact?: SendGridContact;
  mail?: SendGridMail;
  events?: SendGridEvent[];
  metadata?: Record<string, JsonValue | undefined>;
}

export type SendGridMailWebhookPayload = SendGridWebhookBase<SendGridMail> & SendGridMail;
export type SendGridEventWebhookPayload = SendGridWebhookBase<SendGridEvent> & SendGridEvent;
export type SendGridContactWebhookPayload = SendGridWebhookBase<SendGridContact> & SendGridContact;

export type SendGridWebhookPayload =
  | SendGridContactWebhookPayload
  | SendGridEventWebhookPayload
  | SendGridMailWebhookPayload
  | SendGridWebhookBase<SendGridWebhookPayloadRecord>
  | SendGridEvent[];
