export const LINEAR_WEBHOOK_OBJECT_TYPES = [
  'comment',
  'cycle',
  'issue',
  'milestone',
  'project',
  'roadmap',
] as const;
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
  display_name?: string;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  email?: string;
  admin?: boolean;
  avatarUrl?: string;
  avatar_url?: string;
  updatedAt?: string;
  updated_at?: string;
  url?: string;
}

export interface LinearTeam {
  id: string;
  key?: string;
  name?: string;
  description?: string | null;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
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
  target_date?: string | null;
  startedAt?: string | null;
  started_at?: string | null;
  completedAt?: string | null;
  completed_at?: string | null;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  team_ids?: string[];
  teams?: LinearTeam[];
  url?: string;
}

export interface LinearMilestone {
  id: string;
  name?: string;
  description?: string | null;
  status?: string;
  progress?: number | null;
  project?: LinearProjectReference | null;
  project_id?: string | null;
  project_name?: string | null;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

export interface LinearRoadmap {
  id: string;
  name?: string;
  description?: string | null;
  project_ids?: string[];
  projects?: LinearProjectReference[];
  team_ids?: string[];
  teams?: LinearTeam[];
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
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
export type LinearMilestoneWebhookPayload = LinearWebhookBase<LinearMilestone>;
export type LinearRoadmapWebhookPayload = LinearWebhookBase<LinearRoadmap>;

export type LinearWebhookPayload =
  | LinearCommentWebhookPayload
  | LinearCycleWebhookPayload
  | LinearIssueWebhookPayload
  | LinearMilestoneWebhookPayload
  | LinearProjectWebhookPayload
  | LinearRoadmapWebhookPayload
  | LinearWebhookBase<LinearPayloadRecord>;
