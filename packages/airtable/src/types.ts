export const AIRTABLE_WEBHOOK_OBJECT_TYPES = [
  'record',
  'table',
  'base',
] as const;

export const AIRTABLE_WEBHOOK_ACTIONS = [
  'create',
  'update',
  'delete',
] as const;

export type AirtableWebhookObjectType = (typeof AIRTABLE_WEBHOOK_OBJECT_TYPES)[number];
export type AirtableWebhookAction = (typeof AIRTABLE_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface AirtableAdapterConfig {
  apiUrl?: string;
  appName?: string;
  baseId?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  tableId?: string;
  webhookSecret?: string;
}

export interface AirtableReference {
  id: string;
  name?: string;
}

export interface AirtableField {
  id: string;
  name: string;
  type?: string;
  description?: string;
  options?: Record<string, unknown>;
}

export interface AirtableView {
  id: string;
  name: string;
  type?: string;
}

export interface AirtableBase {
  id: string;
  name?: string;
  permissionLevel?: string;
  createdTime?: string;
  tables?: AirtableTable[];
  workspace?: AirtableReference | null;
}

export interface AirtableTable {
  id: string;
  name?: string;
  description?: string | null;
  primaryFieldId?: string;
  baseId?: string;
  base?: AirtableReference | null;
  fields?: AirtableField[];
  views?: AirtableView[];
  createdTime?: string;
  updatedTime?: string;
}

export interface AirtableRecord {
  id: string;
  baseId?: string;
  tableId?: string;
  tableName?: string;
  createdTime?: string;
  updatedTime?: string;
  fields?: Record<string, unknown>;
  commentCount?: number;
}

export interface AirtableWebhookBase<TData> {
  action?: AirtableWebhookAction | string;
  base?: AirtableBase | AirtableReference | null;
  base_id?: string;
  baseId?: string;
  createdTime?: string;
  data?: TData;
  eventType?: string;
  event_type?: string;
  object_id?: string;
  objectId?: string;
  object_type?: AirtableWebhookObjectType | string;
  objectType?: AirtableWebhookObjectType | string;
  payload?: Record<string, unknown>;
  record?: AirtableRecord | null;
  table?: AirtableTable | AirtableReference | null;
  table_id?: string;
  tableId?: string;
  timestamp?: number | string;
  type?: AirtableWebhookObjectType | string;
  webhookTimestamp?: number | string;
}

export type AirtableRecordWebhookPayload = AirtableWebhookBase<AirtableRecord>;
export type AirtableTableWebhookPayload = AirtableWebhookBase<AirtableTable>;
export type AirtableBaseWebhookPayload = AirtableWebhookBase<AirtableBase>;

export type AirtableWebhookPayload =
  | AirtableBaseWebhookPayload
  | AirtableRecordWebhookPayload
  | AirtableTableWebhookPayload
  | AirtableWebhookBase<Record<string, unknown>>;

export interface AirtableReadRequest {
  action: 'get_base' | 'get_record' | 'get_table_records';
  method: 'GET';
  endpoint: string;
  routeTemplate: '/v0/meta/bases/{baseId}/tables' | '/v0/{baseId}/{tableId}' | '/v0/{baseId}/{tableId}/{recordId}';
  query?: Record<string, string>;
}

export interface AirtableWritebackRequest {
  action: 'create_record' | 'replace_record' | 'update_record';
  method: 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  routeTemplate: '/v0/{baseId}/{tableId}';
  body: Record<string, unknown>;
}
