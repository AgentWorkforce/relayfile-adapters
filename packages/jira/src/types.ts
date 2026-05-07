export const JIRA_WEBHOOK_OBJECT_TYPES = [
  'comment',
  'issue',
  'project',
  'sprint',
] as const;

export const JIRA_WEBHOOK_ACTIONS = [
  'created',
  'deleted',
  'updated',
] as const;

export type JiraWebhookObjectType = (typeof JIRA_WEBHOOK_OBJECT_TYPES)[number];
export type JiraWebhookAction = (typeof JIRA_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface JiraAdapterConfig {
  apiUrl?: string;
  appName?: string;
  cloudId?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  sharedSecret?: string;
}

export interface JiraWritebackRequest {
  action:
    | 'create_comment'
    | 'create_issue'
    | 'create_project'
    | 'update_comment'
    | 'update_issue'
    | 'update_project'
    | 'update_sprint';
  method: 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  body: Record<string, unknown>;
}

export interface JiraReadRequest {
  action:
    | 'get_comment'
    | 'get_issue'
    | 'get_issue_comments'
    | 'get_project'
    | 'get_project_versions'
    | 'get_sprint'
    | 'list_issues'
    | 'list_projects';
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export interface JiraUser {
  accountId?: string;
  account_id?: string;
  active?: boolean;
  avatarUrls?: Record<string, string>;
  displayName?: string;
  display_name?: string;
  emailAddress?: string;
  email_address?: string;
  name?: string;
  self?: string;
  timeZone?: string;
  timezone?: string;
}

export interface JiraProject {
  id: string;
  key?: string;
  name?: string;
  projectTypeKey?: string;
  project_type_key?: string;
  lead?: JiraUser | null;
  description?: string | null;
  assigneeType?: string;
  assignee_type?: string;
  archived?: boolean;
  avatarUrls?: Record<string, string>;
  category?: {
    id?: string;
    name?: string;
    description?: string;
  } | null;
  self?: string;
  simplified?: boolean;
  style?: string;
  url?: string;
}

export interface JiraIssueType {
  id?: string;
  name?: string;
  description?: string;
  iconUrl?: string;
  subtask?: boolean;
}

export interface JiraStatus {
  id?: string;
  name?: string;
  description?: string;
  statusCategory?: {
    id?: number;
    key?: string;
    name?: string;
  };
}

export interface JiraPriority {
  id?: string;
  name?: string;
  iconUrl?: string;
}

export interface JiraResolution {
  id?: string;
  name?: string;
  description?: string;
}

export interface JiraIssueFields {
  assignee?: JiraUser | null;
  comment?: {
    comments?: JiraComment[];
    maxResults?: number;
    total?: number;
  };
  components?: Array<{ id?: string; name?: string }>;
  created?: string;
  creator?: JiraUser | null;
  description?: JsonValue | string | null;
  duedate?: string | null;
  fixVersions?: Array<{ id?: string; name?: string; released?: boolean }>;
  issuetype?: JiraIssueType | null;
  labels?: string[];
  parent?: JiraIssueReference | null;
  priority?: JiraPriority | null;
  project?: JiraProject | null;
  reporter?: JiraUser | null;
  resolution?: JiraResolution | null;
  resolutiondate?: string | null;
  sprint?: JiraSprint | null;
  status?: JiraStatus | null;
  summary?: string;
  updated?: string;
  versions?: Array<{ id?: string; name?: string; released?: boolean }>;
  [field: string]: unknown;
}

export interface JiraIssueReference {
  id?: string;
  key?: string;
  self?: string;
  fields?: {
    summary?: string;
    status?: JiraStatus | null;
  };
}

export interface JiraIssue {
  id: string;
  key?: string;
  self?: string;
  changelog?: JsonValue;
  fields?: JiraIssueFields;
  renderedFields?: Record<string, unknown>;
}

export interface JiraSprint {
  id: string | number;
  self?: string;
  state?: 'active' | 'closed' | 'future' | string;
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  completeDate?: string | null;
  originBoardId?: number | string;
  goal?: string | null;
}

export interface JiraComment {
  id: string;
  self?: string;
  body?: JsonValue | string | null;
  author?: JiraUser | null;
  updateAuthor?: JiraUser | null;
  created?: string;
  updated?: string;
  jsdPublic?: boolean;
}

export interface JiraWebhookUser extends JiraUser {}

export interface JiraWebhookBase {
  timestamp?: number;
  webhookEvent?: string;
  issue_event_type_name?: string;
  user?: JiraWebhookUser | null;
}

export interface JiraIssueWebhookPayload extends JiraWebhookBase {
  issue: JiraIssue;
  changelog?: JsonValue;
}

export interface JiraProjectWebhookPayload extends JiraWebhookBase {
  project: JiraProject;
}

export interface JiraSprintWebhookPayload extends JiraWebhookBase {
  sprint: JiraSprint;
}

export interface JiraCommentWebhookPayload extends JiraWebhookBase {
  comment: JiraComment;
  issue?: JiraIssueReference | JiraIssue;
}

export type JiraWebhookPayload =
  | JiraCommentWebhookPayload
  | JiraIssueWebhookPayload
  | JiraProjectWebhookPayload
  | JiraSprintWebhookPayload
  | (JiraWebhookBase & Record<string, unknown>);
