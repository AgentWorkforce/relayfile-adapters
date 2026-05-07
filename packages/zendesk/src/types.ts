export const ZENDESK_WEBHOOK_OBJECT_TYPES = [
  'ticket',
  'user',
  'organization',
] as const;

export const ZENDESK_WEBHOOK_ACTIONS = [
  'created',
  'deleted',
  'updated',
] as const;

export type ZendeskWebhookObjectType = (typeof ZENDESK_WEBHOOK_OBJECT_TYPES)[number];
export type ZendeskWebhookAction = (typeof ZENDESK_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface ZendeskAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
}

export interface ZendeskWritebackRequest {
  action:
    | 'add_ticket_comment'
    | 'create_ticket'
    | 'create_user'
    | 'update_organization'
    | 'update_ticket'
    | 'update_user';
  method: 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  body: Record<string, unknown>;
}

export interface ZendeskUserReference {
  id: number | string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface ZendeskOrganizationReference {
  id: number | string;
  name?: string | null;
  domain_names?: string[];
}

export interface ZendeskTicketComment {
  id?: number | string;
  author_id?: number | string | null;
  body?: string | null;
  html_body?: string | null;
  public?: boolean;
  created_at?: string | null;
}

export interface ZendeskTicket {
  id: number | string;
  url?: string | null;
  external_id?: string | null;
  type?: string | null;
  subject?: string | null;
  raw_subject?: string | null;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  recipient?: string | null;
  requester_id?: number | string | null;
  submitter_id?: number | string | null;
  assignee_id?: number | string | null;
  organization_id?: number | string | null;
  group_id?: number | string | null;
  brand_id?: number | string | null;
  forum_topic_id?: number | string | null;
  problem_id?: number | string | null;
  has_incidents?: boolean;
  is_public?: boolean;
  due_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  tags?: string[];
  via?: {
    channel?: string | null;
    source?: Record<string, unknown> | null;
  } | null;
  custom_fields?: Array<{
    id: number | string;
    value?: JsonValue;
  }>;
  fields?: Array<{
    id: number | string;
    value?: JsonValue;
  }>;
  requester?: ZendeskUserReference | null;
  submitter?: ZendeskUserReference | null;
  assignee?: ZendeskUserReference | null;
  organization?: ZendeskOrganizationReference | null;
  comments?: ZendeskTicketComment[];
}

export interface ZendeskUser {
  id: number | string;
  url?: string | null;
  name?: string | null;
  email?: string | null;
  external_id?: string | null;
  alias?: string | null;
  role?: string | null;
  active?: boolean;
  verified?: boolean;
  suspended?: boolean;
  locale?: string | null;
  locale_id?: number | string | null;
  time_zone?: string | null;
  phone?: string | null;
  shared_phone_number?: boolean;
  organization_id?: number | string | null;
  default_group_id?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  tags?: string[];
  user_fields?: Record<string, JsonValue | undefined>;
  details?: string | null;
  notes?: string | null;
  organization?: ZendeskOrganizationReference | null;
}

export interface ZendeskOrganization {
  id: number | string;
  url?: string | null;
  name?: string | null;
  external_id?: string | null;
  shared_tickets?: boolean;
  shared_comments?: boolean;
  domain_names?: string[];
  group_id?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  tags?: string[];
  organization_fields?: Record<string, JsonValue | undefined>;
  details?: string | null;
  notes?: string | null;
}

export interface ZendeskWebhookBase<TData> {
  action?: ZendeskWebhookAction | string;
  event_type?: string;
  type?: ZendeskWebhookObjectType | string;
  created_at?: string;
  account_id?: string;
  subdomain?: string;
  data?: TData;
  ticket?: ZendeskTicket;
  user?: ZendeskUser;
  organization?: ZendeskOrganization;
  previous?: Partial<TData>;
  metadata?: Record<string, unknown>;
}

export type ZendeskTicketWebhookPayload = ZendeskWebhookBase<ZendeskTicket>;
export type ZendeskUserWebhookPayload = ZendeskWebhookBase<ZendeskUser>;
export type ZendeskOrganizationWebhookPayload = ZendeskWebhookBase<ZendeskOrganization>;

export type ZendeskPayloadRecord = Record<string, JsonValue | undefined>;

export type ZendeskWebhookPayload =
  | ZendeskOrganizationWebhookPayload
  | ZendeskTicketWebhookPayload
  | ZendeskUserWebhookPayload
  | ZendeskWebhookBase<ZendeskPayloadRecord>;
