export const CALENDLY_WEBHOOK_OBJECT_TYPES = [
  'scheduled_event',
  'invitee',
  'event_type',
] as const;

export const CALENDLY_WEBHOOK_ACTIONS = [
  'created',
  'updated',
  'canceled',
  'deleted',
] as const;

export type CalendlyWebhookObjectType = (typeof CALENDLY_WEBHOOK_OBJECT_TYPES)[number];
export type CalendlyWebhookAction = (typeof CALENDLY_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface CalendlyAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
  webhookToleranceMs?: number;
}

export interface CalendlyUriReference {
  uri: string;
  name?: string;
}

export interface CalendlyUserReference extends CalendlyUriReference {
  email?: string;
}

export interface CalendlyLocation {
  type?: string;
  location?: string | null;
  join_url?: string | null;
  status?: string;
  additional_info?: string | null;
}

export interface CalendlyQuestionAndAnswer {
  answer?: string;
  position?: number;
  question?: string;
}

export interface CalendlyTracking {
  utm_campaign?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  salesforce_uuid?: string | null;
}

export interface CalendlyScheduledEvent {
  uri: string;
  uuid?: string;
  name?: string;
  status?: 'active' | 'canceled' | string;
  start_time?: string;
  end_time?: string;
  created_at?: string;
  updated_at?: string;
  event_type?: string | CalendlyEventType | CalendlyUriReference;
  event_memberships?: CalendlyUserReference[];
  event_guests?: CalendlyInvitee[];
  invitees_counter?: {
    total?: number;
    active?: number;
    limit?: number;
  };
  location?: CalendlyLocation | null;
  calendar_event?: {
    kind?: string;
    external_id?: string;
  } | null;
  cancellation?: {
    canceled_by?: string;
    reason?: string | null;
    canceler_type?: string;
    created_at?: string;
  } | null;
}

export interface CalendlyInvitee {
  uri: string;
  uuid?: string;
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string;
  status?: 'active' | 'canceled' | string;
  timezone?: string;
  created_at?: string;
  updated_at?: string;
  canceled?: boolean;
  rescheduled?: boolean;
  old_invitee?: string | null;
  new_invitee?: string | null;
  cancel_url?: string;
  reschedule_url?: string;
  event?: string | CalendlyScheduledEvent | CalendlyUriReference;
  payment?: {
    external_id?: string;
    provider?: string;
    amount?: number;
    currency?: string;
    terms?: string;
    successful?: boolean;
  } | null;
  questions_and_answers?: CalendlyQuestionAndAnswer[];
  tracking?: CalendlyTracking;
  text_reminder_number?: string | null;
  routing_form_submission?: string | null;
}

export interface CalendlyEventType {
  uri: string;
  uuid?: string;
  name?: string;
  slug?: string;
  active?: boolean;
  color?: string;
  duration?: number;
  kind?: string;
  pooling_type?: string | null;
  type?: string;
  scheduling_url?: string;
  internal_note?: string | null;
  description_plain?: string | null;
  description_html?: string | null;
  created_at?: string;
  updated_at?: string;
  profile?: {
    type?: string;
    name?: string;
    owner?: string;
  };
}

export interface CalendlyWebhookPayload {
  event: string;
  created_at?: string;
  payload: CalendlyScheduledEvent | CalendlyInvitee | CalendlyEventType | Record<string, unknown>;
}

export interface CalendlyRestRequest {
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface CalendlyWritebackRequest extends CalendlyRestRequest {
  action:
    | 'cancel_invitee'
    | 'cancel_scheduled_event'
    | 'create_event_type'
    | 'create_scheduled_event'
    | 'update_event_type'
    | 'update_invitee'
    | 'update_scheduled_event';
  method: 'PATCH' | 'POST' | 'PUT';
}
