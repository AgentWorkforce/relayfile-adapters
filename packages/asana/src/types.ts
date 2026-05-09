export const ASANA_WEBHOOK_OBJECT_TYPES = [
  'task',
  'project',
  'section',
  'workspace',
] as const;

export const ASANA_WEBHOOK_ACTIONS = [
  'added',
  'changed',
  'deleted',
  'removed',
] as const;

export type AsanaWebhookObjectType = (typeof ASANA_WEBHOOK_OBJECT_TYPES)[number];
export type AsanaWebhookAction = (typeof ASANA_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface AsanaAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
  webhookToleranceMs?: number;
}

export interface AsanaGidReference {
  gid: string;
  name?: string;
  resource_type?: string;
}

export interface AsanaWorkspace {
  gid: string;
  name?: string;
  email_domains?: string[];
  is_organization?: boolean;
  resource_type?: 'workspace' | string;
}

export interface AsanaTeam extends AsanaGidReference {
  organization?: AsanaGidReference;
}

export interface AsanaUser extends AsanaGidReference {
  email?: string;
}

export interface AsanaProject {
  gid: string;
  name?: string;
  archived?: boolean;
  color?: string | null;
  completed?: boolean;
  completed_at?: string | null;
  created_at?: string;
  current_status?: {
    gid?: string;
    color?: string;
    text?: string;
    title?: string;
  } | null;
  default_view?: string;
  due_date?: string | null;
  due_on?: string | null;
  html_url?: string;
  modified_at?: string;
  notes?: string | null;
  owner?: AsanaUser | null;
  permalink_url?: string;
  public?: boolean;
  resource_type?: 'project' | string;
  start_on?: string | null;
  team?: AsanaTeam | null;
  workspace?: AsanaWorkspace | AsanaGidReference | null;
}

export interface AsanaSection {
  gid: string;
  name?: string;
  created_at?: string;
  project?: AsanaProject | AsanaGidReference | null;
  projects?: Array<AsanaProject | AsanaGidReference>;
  resource_type?: 'section' | string;
}

export interface AsanaTask {
  gid: string;
  name?: string;
  actual_time_minutes?: number | null;
  approval_status?: string;
  assignee?: AsanaUser | null;
  assignee_status?: string;
  completed?: boolean;
  completed_at?: string | null;
  created_at?: string;
  custom_fields?: AsanaCustomField[];
  due_at?: string | null;
  due_on?: string | null;
  followers?: AsanaUser[];
  hearted?: boolean;
  html_notes?: string | null;
  html_url?: string;
  liked?: boolean;
  memberships?: AsanaTaskMembership[];
  modified_at?: string;
  notes?: string | null;
  parent?: AsanaGidReference | null;
  permalink_url?: string;
  projects?: AsanaProject[];
  resource_subtype?: string;
  resource_type?: 'task' | string;
  start_at?: string | null;
  start_on?: string | null;
  tags?: AsanaGidReference[];
  workspace?: AsanaWorkspace | AsanaGidReference | null;
}

export interface AsanaCustomField {
  gid?: string;
  name?: string;
  display_value?: string | null;
  enum_value?: {
    gid?: string;
    name?: string;
  } | null;
  number_value?: number | null;
  text_value?: string | null;
  type?: string;
}

export interface AsanaTaskMembership {
  project?: AsanaProject | AsanaGidReference | null;
  section?: AsanaSection | AsanaGidReference | null;
}

export interface AsanaWebhookResource {
  gid?: string;
  name?: string;
  resource_type?: string;
  resource_subtype?: string;
}

export interface AsanaWebhookParent {
  gid?: string;
  name?: string;
  resource_type?: string;
}

export interface AsanaWebhookUser {
  gid?: string;
  name?: string;
  resource_type?: string;
}

export interface AsanaWebhookChange {
  action?: string;
  field?: string;
  new_value?: JsonValue;
  old_value?: JsonValue;
}

export interface AsanaWebhookEvent {
  action?: string;
  change?: AsanaWebhookChange;
  created_at?: string;
  parent?: AsanaWebhookParent;
  resource?: AsanaWebhookResource;
  type?: string;
  user?: AsanaWebhookUser;
}

export interface AsanaWebhookPayload {
  events: AsanaWebhookEvent[];
  sync?: string;
  data?: JsonValue;
  metadata?: Record<string, JsonValue | undefined>;
  connectionId?: string;
  provider?: string;
}

export interface AsanaRestRequest {
  method: 'DELETE' | 'GET' | 'POST' | 'PUT';
  endpoint: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface AsanaWritebackRequest extends AsanaRestRequest {
  action:
    | 'add_task_to_project'
    | 'create_project'
    | 'create_section'
    | 'create_task'
    | 'delete_project'
    | 'delete_section'
    | 'delete_task'
    | 'update_project'
    | 'update_section'
    | 'update_task';
  method: 'DELETE' | 'POST' | 'PUT';
}
