export const INTERCOM_WEBHOOK_OBJECT_TYPES = [
  'conversation',
  'contact',
  'company',
] as const;

export const INTERCOM_WEBHOOK_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'closed',
  'reopened',
  'archived',
  'assigned',
] as const;

export type IntercomWebhookObjectType = (typeof INTERCOM_WEBHOOK_OBJECT_TYPES)[number];
export type IntercomWebhookAction = (typeof INTERCOM_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface IntercomAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
  webhookTimestampToleranceMs?: number;
}

export interface IntercomWritebackRequest {
  action:
    | 'create_company'
    | 'create_contact'
    | 'create_conversation'
    | 'delete_company'
    | 'delete_contact'
    | 'delete_conversation'
    | 'reply_conversation'
    | 'update_company'
    | 'update_contact'
    | 'update_conversation';
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  body?: Record<string, unknown>;
}

export interface IntercomReadRequest {
  action:
    | 'get_company'
    | 'get_contact'
    | 'get_conversation'
    | 'list_companies'
    | 'list_contacts'
    | 'list_conversations';
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export interface IntercomReference {
  id?: string;
  type?: string;
  name?: string;
  email?: string;
}

export interface IntercomTag {
  id?: string;
  name?: string;
}

export interface IntercomSocialProfile {
  type?: string;
  name?: string;
  url?: string;
  username?: string;
}

export interface IntercomAdmin {
  id?: string;
  name?: string;
  email?: string;
  type?: string;
}

export interface IntercomTeam {
  id?: string;
  name?: string;
  type?: string;
}

export interface IntercomContact {
  id: string;
  type?: 'contact' | 'user' | string;
  external_id?: string | null;
  role?: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  owner_id?: number | string | null;
  has_hard_bounced?: boolean;
  marked_email_as_spam?: boolean;
  unsubscribed_from_emails?: boolean;
  created_at?: number | string;
  updated_at?: number | string;
  signed_up_at?: number | string | null;
  last_seen_at?: number | string | null;
  last_replied_at?: number | string | null;
  last_contacted_at?: number | string | null;
  browser?: string | null;
  browser_version?: string | null;
  browser_language?: string | null;
  os?: string | null;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    country_code?: string;
  } | null;
  social_profiles?: {
    data?: IntercomSocialProfile[];
  } | IntercomSocialProfile[];
  tags?: {
    data?: IntercomTag[];
  } | IntercomTag[];
  companies?: {
    data?: IntercomCompanyReference[];
  } | IntercomCompanyReference[];
  custom_attributes?: Record<string, JsonValue | undefined>;
}

export interface IntercomCompanyReference {
  id?: string;
  company_id?: string;
  name?: string;
  type?: string;
}

export interface IntercomCompany {
  id: string;
  type?: 'company' | string;
  company_id?: string;
  name?: string | null;
  app_id?: string;
  remote_created_at?: number | string | null;
  created_at?: number | string;
  updated_at?: number | string;
  last_request_at?: number | string | null;
  monthly_spend?: number;
  session_count?: number;
  user_count?: number;
  size?: number | null;
  industry?: string | null;
  website?: string | null;
  plan?: string | null;
  tags?: {
    data?: IntercomTag[];
  } | IntercomTag[];
  custom_attributes?: Record<string, JsonValue | undefined>;
}

export interface IntercomConversationPart {
  id?: string;
  type?: string;
  part_type?: string;
  body?: string | null;
  created_at?: number | string;
  updated_at?: number | string;
  notified_at?: number | string;
  author?: IntercomReference | null;
  assigned_to?: IntercomReference | null;
  attachments?: Array<{
    name?: string;
    url?: string;
    content_type?: string;
  }>;
}

export interface IntercomConversation {
  id: string;
  type?: 'conversation' | string;
  title?: string | null;
  state?: string;
  open?: boolean;
  read?: boolean;
  priority?: string;
  snoozed_until?: number | string | null;
  created_at?: number | string;
  updated_at?: number | string;
  waiting_since?: number | string | null;
  source?: {
    id?: string;
    type?: string;
    delivered_as?: string;
    subject?: string | null;
    body?: string | null;
    author?: IntercomReference | null;
    url?: string | null;
  } | null;
  user?: IntercomContact | IntercomReference | null;
  contact?: IntercomContact | IntercomReference | null;
  contacts?: {
    data?: Array<IntercomContact | IntercomReference>;
  } | Array<IntercomContact | IntercomReference>;
  teammates?: {
    admins?: IntercomAdmin[];
  };
  assignee?: IntercomAdmin | IntercomReference | null;
  team_assignee?: IntercomTeam | IntercomReference | null;
  tags?: {
    data?: IntercomTag[];
  } | IntercomTag[];
  conversation_parts?: {
    data?: IntercomConversationPart[];
    total_count?: number;
  } | IntercomConversationPart[];
  custom_attributes?: Record<string, JsonValue | undefined>;
}

export interface IntercomNotificationData<TItem> {
  type?: string;
  item?: TItem;
}

export interface IntercomWebhookPayload<TItem = IntercomConversation | IntercomContact | IntercomCompany> {
  type?: string;
  topic?: string;
  app_id?: string;
  id?: string;
  created_at?: number | string;
  delivery_attempts?: number;
  data?: IntercomNotificationData<TItem> | TItem;
  item?: TItem;
  object_type?: string;
  objectType?: string;
  event_type?: string;
  eventType?: string;
  action?: string;
  metadata?: Record<string, JsonValue | undefined>;
}

export type IntercomPayloadRecord = Record<string, JsonValue | undefined>;
