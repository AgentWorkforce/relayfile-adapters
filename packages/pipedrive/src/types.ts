export const PIPEDRIVE_WEBHOOK_OBJECT_TYPES = [
  'deal',
  'person',
  'organization',
  'activity',
] as const;
export const PIPEDRIVE_WEBHOOK_ACTIONS = ['added', 'created', 'deleted', 'updated'] as const;

export type PipedriveWebhookObjectType = (typeof PIPEDRIVE_WEBHOOK_OBJECT_TYPES)[number];
export type PipedriveWebhookAction = (typeof PIPEDRIVE_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface PipedriveWebhookBasicAuthConfig {
  username: string;
  password: string;
}

export interface PipedriveAdapterConfig {
  apiBaseUrl?: string;
  companyDomain?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookBasicAuth?: PipedriveWebhookBasicAuthConfig;
  webhookTimestampToleranceMs?: number;
}

export interface PipedriveReference {
  id?: number | string;
  name?: string;
  value?: string;
}

export interface PipedriveOwner extends PipedriveReference {
  email?: string;
  active_flag?: boolean;
}

export interface PipedriveOrganization {
  id: number | string;
  name?: string;
  owner_id?: number | string | PipedriveOwner | null;
  address?: string | null;
  cc_email?: string | null;
  active_flag?: boolean;
  add_time?: string;
  update_time?: string;
  visible_to?: string | number;
}

export interface PipedrivePerson {
  id: number | string;
  name?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: Array<{ label?: string; primary?: boolean; value?: string }> | string | null;
  phone?: Array<{ label?: string; primary?: boolean; value?: string }> | string | null;
  owner_id?: number | string | PipedriveOwner | null;
  org_id?: number | string | PipedriveOrganization | PipedriveReference | null;
  add_time?: string;
  update_time?: string;
  visible_to?: string | number;
}

export interface PipedriveDeal {
  id: number | string;
  title?: string;
  value?: number | string | null;
  currency?: string | null;
  status?: 'deleted' | 'lost' | 'open' | 'won' | string;
  stage_id?: number | string | PipedriveReference | null;
  pipeline_id?: number | string | PipedriveReference | null;
  person_id?: number | string | PipedrivePerson | PipedriveReference | null;
  org_id?: number | string | PipedriveOrganization | PipedriveReference | null;
  user_id?: number | string | PipedriveOwner | null;
  owner_name?: string | null;
  expected_close_date?: string | null;
  close_time?: string | null;
  won_time?: string | null;
  lost_time?: string | null;
  add_time?: string;
  update_time?: string;
  probability?: number | string | null;
  label?: string | null;
}

export interface PipedriveActivity {
  id: number | string;
  subject?: string;
  type?: string;
  done?: boolean | number;
  due_date?: string | null;
  due_time?: string | null;
  duration?: string | null;
  note?: string | null;
  deal_id?: number | string | PipedriveDeal | PipedriveReference | null;
  person_id?: number | string | PipedrivePerson | PipedriveReference | null;
  org_id?: number | string | PipedriveOrganization | PipedriveReference | null;
  user_id?: number | string | PipedriveOwner | null;
  add_time?: string;
  update_time?: string;
}

export interface PipedriveWebhookMeta {
  action?: string;
  change_source?: string;
  company_id?: number | string;
  correlation_id?: string;
  entity?: string;
  host?: string;
  id?: number | string;
  is_bulk_update?: boolean;
  object?: string;
  timestamp?: number | string;
  type?: string;
  user_id?: number | string;
  v?: number | string;
}

export interface PipedriveWebhookBase<TData> {
  action?: PipedriveWebhookAction | string;
  current?: TData;
  data?: TData;
  event?: string;
  meta?: PipedriveWebhookMeta;
  object?: PipedriveWebhookObjectType | string;
  previous?: Partial<TData>;
  timestamp?: number | string;
}

export type PipedriveDealWebhookPayload = PipedriveWebhookBase<PipedriveDeal>;
export type PipedrivePersonWebhookPayload = PipedriveWebhookBase<PipedrivePerson>;
export type PipedriveOrganizationWebhookPayload = PipedriveWebhookBase<PipedriveOrganization>;
export type PipedriveActivityWebhookPayload = PipedriveWebhookBase<PipedriveActivity>;

export type PipedrivePayloadRecord = Record<string, JsonValue | undefined>;

export type PipedriveWebhookPayload =
  | PipedriveActivityWebhookPayload
  | PipedriveDealWebhookPayload
  | PipedriveOrganizationWebhookPayload
  | PipedrivePersonWebhookPayload
  | PipedriveWebhookBase<PipedrivePayloadRecord>;

