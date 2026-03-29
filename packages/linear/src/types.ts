export const LINEAR_WEBHOOK_OBJECT_TYPES = ['comment', 'cycle', 'issue', 'project'] as const;
export const LINEAR_WEBHOOK_ACTIONS = ['create', 'remove', 'update'] as const;

export type LinearWebhookObjectType = (typeof LINEAR_WEBHOOK_OBJECT_TYPES)[number];
export type LinearWebhookAction = (typeof LINEAR_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface LinearAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
}

export interface LinearUser {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  url?: string;
}

export interface LinearTeam {
  id: string;
  key?: string;
  name?: string;
}

export interface LinearState {
  id: string;
  name?: string;
  type?: string;
  color?: string;
}

export interface LinearLabel {
  id: string;
  name: string;
  color?: string;
}

export interface LinearProjectReference {
  id: string;
  name?: string;
  state?: string;
  url?: string;
}

export interface LinearCycleReference {
  id: string;
  number?: number;
  name?: string;
}

export interface LinearIssueReference {
  id: string;
  identifier?: string;
  title?: string;
  url?: string;
}

export interface LinearRelation {
  id?: string;
  type?: string;
  relatedIssueId?: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description?: string | null;
  state?: string;
  progress?: number | null;
  targetDate?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  url?: string;
}

export interface LinearCycle {
  id: string;
  number?: number;
  name?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  completedAt?: string | null;
}

export interface LinearComment {
  id: string;
  body?: string | null;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
  user?: LinearUser | null;
  issue?: LinearIssueReference | null;
}

export interface LinearIssue {
  id: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  priority?: number | null;
  estimate?: number | null;
  branchName?: string | null;
  dueDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  canceledAt?: string | null;
  url?: string;
  state?: LinearState | null;
  assignee?: LinearUser | null;
  creator?: LinearUser | null;
  team?: LinearTeam | null;
  project?: LinearProjectReference | null;
  cycle?: LinearCycleReference | null;
  labels?: LinearLabel[];
  parent?: LinearIssueReference | null;
  children?: LinearIssueReference[];
  relations?: LinearRelation[];
}

export interface LinearOrganization {
  id?: string;
  key?: string;
  name?: string;
}

export interface LinearWebhookActor extends LinearUser {}

export interface LinearWebhookBase<TData> {
  action: LinearWebhookAction | string;
  type: LinearWebhookObjectType | string;
  createdAt?: string;
  organizationId?: string;
  organization?: LinearOrganization;
  url?: string;
  actionBy?: LinearWebhookActor | null;
  data: TData;
  previousData?: Partial<TData>;
}

export type LinearPayloadRecord = Record<string, JsonValue | undefined>;

export type LinearIssueWebhookPayload = LinearWebhookBase<LinearIssue>;
export type LinearCommentWebhookPayload = LinearWebhookBase<LinearComment>;
export type LinearProjectWebhookPayload = LinearWebhookBase<LinearProject>;
export type LinearCycleWebhookPayload = LinearWebhookBase<LinearCycle>;

export type LinearWebhookPayload =
  | LinearCommentWebhookPayload
  | LinearCycleWebhookPayload
  | LinearIssueWebhookPayload
  | LinearProjectWebhookPayload
  | LinearWebhookBase<LinearPayloadRecord>;
