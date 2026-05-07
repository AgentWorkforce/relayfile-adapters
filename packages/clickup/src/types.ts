export const CLICKUP_WEBHOOK_OBJECT_TYPES = [
  'folder',
  'list',
  'space',
  'task',
] as const;

export const CLICKUP_WEBHOOK_ACTIONS = [
  'created',
  'deleted',
  'updated',
] as const;

export type ClickUpWebhookObjectType = (typeof CLICKUP_WEBHOOK_OBJECT_TYPES)[number];
export type ClickUpWebhookAction = (typeof CLICKUP_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface ClickUpAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
}

export interface ClickUpWritebackRequest {
  action:
    | 'create_folder'
    | 'create_list'
    | 'create_task'
    | 'update_folder'
    | 'update_list'
    | 'update_space'
    | 'update_task'
    | 'task_comment';
  method: 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  body: Record<string, unknown>;
}

export interface ClickUpUser {
  id?: number | string;
  username?: string;
  email?: string;
  color?: string;
  initials?: string;
  profilePicture?: string | null;
  profile_picture?: string | null;
}

export interface ClickUpStatus {
  id?: string;
  status?: string;
  type?: string;
  color?: string;
  orderindex?: number | string;
}

export interface ClickUpPriority {
  id?: string;
  priority?: string;
  color?: string;
  orderindex?: string;
}

export interface ClickUpReference {
  id: string;
  name?: string;
}

export interface ClickUpSpaceReference extends ClickUpReference {}
export interface ClickUpFolderReference extends ClickUpReference {}
export interface ClickUpListReference extends ClickUpReference {}
export interface ClickUpTaskReference extends ClickUpReference {}

export interface ClickUpCustomField {
  id?: string;
  name?: string;
  type?: string;
  type_config?: Record<string, unknown>;
  date_created?: string;
  hide_from_guests?: boolean;
  value?: unknown;
  required?: boolean;
}

export interface ClickUpTask {
  id: string;
  custom_id?: string | null;
  custom_item_id?: number | string | null;
  name?: string;
  text_content?: string | null;
  description?: string | null;
  status?: ClickUpStatus | string | null;
  orderindex?: string;
  date_created?: string;
  date_updated?: string;
  date_closed?: string | null;
  date_done?: string | null;
  archived?: boolean;
  creator?: ClickUpUser | null;
  assignees?: ClickUpUser[];
  watchers?: ClickUpUser[];
  checklists?: unknown[];
  tags?: Array<{ name?: string; tag_fg?: string; tag_bg?: string }>;
  parent?: string | null;
  priority?: ClickUpPriority | string | null;
  due_date?: string | null;
  start_date?: string | null;
  points?: number | string | null;
  time_estimate?: number | string | null;
  time_spent?: number | string | null;
  custom_fields?: ClickUpCustomField[];
  dependencies?: ClickUpTaskReference[];
  linked_tasks?: ClickUpTaskReference[];
  team_id?: string;
  url?: string;
  list?: ClickUpListReference | null;
  folder?: ClickUpFolderReference | null;
  space?: ClickUpSpaceReference | null;
}

export interface ClickUpList {
  id: string;
  name?: string;
  orderindex?: number | string;
  content?: string | null;
  status?: ClickUpStatus | null;
  priority?: ClickUpPriority | null;
  assignee?: ClickUpUser | null;
  task_count?: number | string;
  due_date?: string | null;
  start_date?: string | null;
  archived?: boolean;
  override_statuses?: boolean;
  permission_level?: string;
  folder?: ClickUpFolderReference | null;
  space?: ClickUpSpaceReference | null;
}

export interface ClickUpFolder {
  id: string;
  name?: string;
  orderindex?: number | string;
  hidden?: boolean;
  task_count?: string | number;
  archived?: boolean;
  override_statuses?: boolean;
  space?: ClickUpSpaceReference | null;
  lists?: ClickUpListReference[];
}

export interface ClickUpSpace {
  id: string;
  name?: string;
  color?: string | null;
  private?: boolean;
  avatar?: string | null;
  admin_can_manage?: boolean;
  archived?: boolean;
  multiple_assignees?: boolean;
  statuses?: ClickUpStatus[];
  features?: Record<string, unknown>;
}

export interface ClickUpWebhookBase<TData> {
  event: string;
  task_id?: string;
  list_id?: string;
  folder_id?: string;
  space_id?: string;
  webhook_id?: string;
  history_items?: Array<Record<string, unknown>>;
  data?: TData;
}

export type ClickUpTaskWebhookPayload = ClickUpWebhookBase<ClickUpTask>;
export type ClickUpListWebhookPayload = ClickUpWebhookBase<ClickUpList>;
export type ClickUpFolderWebhookPayload = ClickUpWebhookBase<ClickUpFolder>;
export type ClickUpSpaceWebhookPayload = ClickUpWebhookBase<ClickUpSpace>;

export type ClickUpWebhookPayload =
  | ClickUpFolderWebhookPayload
  | ClickUpListWebhookPayload
  | ClickUpSpaceWebhookPayload
  | ClickUpTaskWebhookPayload
  | ClickUpWebhookBase<Record<string, unknown>>;
