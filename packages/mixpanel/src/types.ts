export const MIXPANEL_WEBHOOK_OBJECT_TYPES = [
  'event',
  'profile',
  'cohort',
] as const;

export const MIXPANEL_WEBHOOK_ACTIONS = [
  'create',
  'delete',
  'merge',
  'update',
] as const;

export type MixpanelWebhookObjectType = (typeof MIXPANEL_WEBHOOK_OBJECT_TYPES)[number];
export type MixpanelWebhookAction = (typeof MIXPANEL_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface MixpanelAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  projectId?: string;
  provider?: string;
  providerConfigKey?: string;
  serviceAccountSecret?: string;
  serviceAccountUser?: string;
  token?: string;
  webhookPass?: string;
  webhookTimestampToleranceMs?: number;
  webhookUser?: string;
}

export interface MixpanelWritebackRequest {
  action:
    | 'delete_profile'
    | 'import_event'
    | 'set_profile'
    | 'track_event'
    | 'update_cohort';
  body: Record<string, unknown>;
  endpoint:
    | '/api/2.0/cohorts/update'
    | '/engage'
    | '/import'
    | '/track';
  method: 'POST';
  query?: Record<string, string>;
}

export interface MixpanelReadRequest {
  endpoint:
    | '/api/2.0/cohorts/list'
    | '/api/2.0/cohorts/members'
    | '/api/2.0/events/names'
    | '/api/2.0/engage'
    | '/api/2.0/segmentation';
  method: 'GET';
  query: Record<string, string>;
}

export interface MixpanelEventProperties {
  $insert_id?: string;
  distinct_id?: string;
  ip?: string;
  mp_country_code?: string;
  mp_lib?: string;
  time?: number | string;
  token?: string;
  [key: string]: JsonValue | undefined;
}

export interface MixpanelEvent {
  event: string;
  id?: string;
  insertId?: string;
  insert_id?: string;
  name?: string;
  properties?: MixpanelEventProperties;
  project_id?: string | number;
  timestamp?: number | string;
  type?: 'event' | string;
}

export interface MixpanelProfileProperties {
  $city?: string;
  $country_code?: string;
  $created?: string;
  $email?: string;
  $first_name?: string;
  $last_name?: string;
  $name?: string;
  $phone?: string;
  $region?: string;
  [key: string]: JsonValue | undefined;
}

export interface MixpanelProfile {
  $distinct_id?: string;
  $ip?: string;
  $properties?: MixpanelProfileProperties;
  $set?: MixpanelProfileProperties;
  distinct_id?: string;
  id?: string;
  labels?: string[];
  properties?: MixpanelProfileProperties;
  type?: 'profile' | string;
}

export interface MixpanelCohort {
  count?: number;
  created?: string;
  created_at?: string;
  description?: string | null;
  id: number | string;
  is_visible?: boolean;
  member_ids?: string[];
  name?: string;
  project_id?: number | string;
  type?: 'cohort' | string;
  updated?: string;
  updated_at?: string;
}

export interface MixpanelWebhookBase<TData> {
  action: MixpanelWebhookAction | string;
  data: TData;
  event?: string;
  eventType?: string;
  event_type?: string;
  id?: string;
  objectId?: string;
  object_id?: string;
  projectId?: string;
  project_id?: string | number;
  timestamp?: number | string;
  type: MixpanelWebhookObjectType | string;
}

export type MixpanelEventWebhookPayload = MixpanelWebhookBase<MixpanelEvent>;
export type MixpanelProfileWebhookPayload = MixpanelWebhookBase<MixpanelProfile>;
export type MixpanelCohortWebhookPayload = MixpanelWebhookBase<MixpanelCohort>;

export type MixpanelWebhookPayload =
  | MixpanelCohortWebhookPayload
  | MixpanelEventWebhookPayload
  | MixpanelProfileWebhookPayload;
