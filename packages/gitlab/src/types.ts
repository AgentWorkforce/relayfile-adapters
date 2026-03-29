import type { FileSemantics, WebhookInput as RelayWebhookInput } from '@relayfile/sdk';

export type WebhookInput = RelayWebhookInput;
export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type ProxyMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export interface ProxyRequest {
  method: ProxyMethod;
  baseUrl: string;
  endpoint: string;
  connectionId?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

export interface ConnectionProvider {
  readonly name: string;
  proxy(request: ProxyRequest): Promise<ProxyResponse>;
  healthCheck?(connectionId: string): Promise<boolean>;
  handleWebhook?(rawPayload: unknown): Promise<WebhookInput>;
}

export interface GitLabAdapterConfig {
  baseUrl: string;
  apiVersion: 'v4';
  defaultBranch: string;
  fetchFileContents: boolean;
  maxFileSizeBytes: number;
  perPage: number;
  projectPath?: string;
  connectionId?: string;
  webhookSecret?: string;
  supportedEvents: GitLabSupportedEvent[];
}

export interface IngestOperation {
  path: string;
  mode: 'update' | 'write';
  content?: string;
  contentType?: 'application/json' | 'text/plain';
  semantics?: FileSemantics;
}

export interface IngestError {
  path: string;
  error: string;
}

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: IngestError[];
  operations: IngestOperation[];
}

export interface SyncOptions {
  cursor?: string;
  limit?: number;
  objectTypes?: GitLabSyncObjectType[];
  fullResync?: boolean;
  projectPath?: string;
  signal?: AbortSignal;
}

export interface SyncResult extends IngestResult {
  nextCursor?: string | null;
  syncedObjectTypes: string[];
}

export type GitLabSyncObjectType =
  | 'commits'
  | 'issues'
  | 'merge_requests'
  | 'pipelines';

export abstract class IntegrationAdapter {
  protected readonly provider: ConnectionProvider;
  protected readonly config: GitLabAdapterConfig;

  abstract readonly name: string;
  abstract readonly version: string;

  constructor(provider: ConnectionProvider, config: GitLabAdapterConfig) {
    this.provider = provider;
    this.config = config;
  }

  abstract ingestWebhook(workspaceId: string, event: WebhookInput): Promise<IngestResult>;
  abstract computePath(objectType: string, objectId: string): string;
  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;
  sync?(workspaceId: string, options?: SyncOptions): Promise<SyncResult>;
  writeBack?(workspaceId: string, path: string, content: string): Promise<WritebackResult>;
  supportedEvents?(): string[];
}

export const GITLAB_SUPPORTED_EVENTS = [
  'merge_request.open',
  'merge_request.reopen',
  'merge_request.update',
  'merge_request.close',
  'merge_request.merge',
  'merge_request.approved',
  'merge_request.unapproved',
  'note.MergeRequest',
  'note.Issue',
  'note.Commit',
  'note.Snippet',
  'push',
  'pipeline.created',
  'pipeline.pending',
  'pipeline.running',
  'pipeline.success',
  'pipeline.failed',
  'pipeline.canceled',
  'pipeline.manual',
  'pipeline.skipped',
  'pipeline.waiting_for_resource',
  'issue.open',
  'issue.reopen',
  'issue.update',
  'issue.close',
  'deployment.created',
  'deployment.running',
  'deployment.success',
  'deployment.failed',
  'deployment.canceled',
  'build.created',
  'build.pending',
  'build.running',
  'build.success',
  'build.failed',
  'build.canceled',
  'build.manual',
  'build.skipped',
  'job.created',
  'job.pending',
  'job.running',
  'job.success',
  'job.failed',
  'job.canceled',
  'job.manual',
  'job.skipped',
  'tag_push',
] as const;

export type GitLabSupportedEvent = (typeof GITLAB_SUPPORTED_EVENTS)[number];

export type GitLabWebhookEventType =
  | 'build'
  | 'deployment'
  | 'issue'
  | 'job'
  | 'merge_request'
  | 'note'
  | 'pipeline'
  | 'push'
  | 'tag_push';

export type MergeRequestAction =
  | 'approval'
  | 'approved'
  | 'close'
  | 'merge'
  | 'open'
  | 'reopen'
  | 'unapproval'
  | 'unapproved'
  | 'update';

export type IssueAction = 'close' | 'open' | 'reopen' | 'update';

export type NoteableType = 'Commit' | 'Issue' | 'MergeRequest' | 'Snippet';

export type PipelineStatus =
  | 'canceled'
  | 'created'
  | 'failed'
  | 'manual'
  | 'pending'
  | 'running'
  | 'skipped'
  | 'success'
  | 'waiting_for_resource';

export type JobStatus =
  | 'canceled'
  | 'created'
  | 'failed'
  | 'manual'
  | 'pending'
  | 'running'
  | 'skipped'
  | 'success';

export type DeploymentStatus = 'canceled' | 'created' | 'failed' | 'running' | 'success';

export interface GitLabNamespace {
  full_path?: string;
  id?: number;
  kind?: string;
  name?: string;
  path?: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  default_branch?: string;
  description?: string | null;
  http_url_to_repo?: string;
  namespace?: GitLabNamespace;
  ssh_url_to_repo?: string;
  web_url?: string;
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  avatar_url?: string | null;
  email?: string;
  web_url?: string;
}

export interface GitLabLabel {
  id?: number;
  title: string;
  color?: string;
  description?: string | null;
  text_color?: string;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: 'closed' | 'locked' | 'merged' | 'opened';
  author: GitLabUser;
  assignees?: GitLabUser[];
  labels: Array<GitLabLabel | string>;
  draft?: boolean;
  source_branch: string;
  target_branch: string;
  sha?: string;
  merge_commit_sha?: string | null;
  head_pipeline?: { id: number; status: PipelineStatus } | null;
  merge_status?: string;
  references?: { full?: string; relative?: string; short?: string };
  source_project_id?: number;
  target_project_id?: number;
  web_url?: string;
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  closed_at?: string | null;
}

export interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: 'closed' | 'opened';
  author: GitLabUser;
  assignees?: GitLabUser[];
  labels: Array<GitLabLabel | string>;
  references?: { full?: string; relative?: string; short?: string };
  web_url?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

export interface GitLabDiscussionPosition {
  base_sha: string;
  head_sha: string;
  new_line?: number | null;
  new_path?: string;
  old_line?: number | null;
  old_path?: string;
  position_type?: 'image' | 'text';
  start_sha: string;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: GitLabUser;
  attachment?: unknown;
  confidential?: boolean;
  internal?: boolean;
  noteable_id?: number;
  noteable_iid?: number;
  noteable_type: NoteableType;
  resolvable?: boolean;
  resolved?: boolean;
  resolved_at?: string | null;
  resolved_by?: GitLabUser | null;
  system?: boolean;
  type?: 'DiffNote' | 'DiscussionNote' | null;
  position?: GitLabDiscussionPosition;
  created_at: string;
  updated_at: string;
}

export interface GitLabDiscussion {
  id: string;
  individual_note: boolean;
  notes: GitLabNote[];
}

export interface GitLabApprovalState {
  approved: boolean;
  approved_by: Array<{ user: GitLabUser }>;
  approvals_left: number;
  approvals_required: number;
  suggested_approvers?: GitLabUser[];
}

export interface GitLabDiffEntry {
  a_mode?: string;
  b_mode?: string;
  deleted_file: boolean;
  diff: string;
  generated_file?: boolean;
  new_file: boolean;
  new_path: string;
  old_path: string;
  renamed_file: boolean;
  too_large?: boolean;
}

export interface GitLabPipeline {
  id: number;
  iid?: number;
  ref: string;
  sha: string;
  source?: string;
  status: PipelineStatus;
  updated_at?: string;
  created_at?: string;
  finished_at?: string | null;
  web_url?: string;
}

export interface GitLabJob {
  id: number;
  name: string;
  stage: string;
  status: JobStatus;
  ref?: string;
  tag?: boolean;
  allow_failure?: boolean;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration?: number | null;
  web_url?: string;
  runner?: { description?: string; id: number } | null;
  pipeline?: { id: number; project_id?: number; ref?: string; sha?: string; status?: PipelineStatus };
}

export interface GitLabCommit {
  authored_date: string;
  author_email: string;
  author_name: string;
  committed_date: string;
  id: string;
  message: string;
  parent_ids?: string[];
  short_id: string;
  title: string;
  web_url?: string;
}

export interface GitLabDeployment {
  id: number;
  iid?: number;
  deployable?: GitLabJob | null;
  environment?: string;
  ref?: string;
  sha?: string;
  status: DeploymentStatus;
  created_at?: string;
  updated_at?: string;
}

export interface GitLabRepositoryFile {
  blob_id?: string;
  branch?: string;
  commit_id?: string;
  content?: string;
  content_sha256?: string;
  encoding?: 'base64' | string;
  file_name?: string;
  file_path: string;
  last_commit_id?: string;
  ref?: string;
  size?: number;
}

export interface GitLabWebhookBase {
  object_kind: GitLabWebhookEventType;
  event_name?: string;
  event_type?: string;
  project: GitLabProject;
  user?: GitLabUser;
}

export interface GitLabMergeRequestWebhook extends GitLabWebhookBase {
  object_kind: 'merge_request';
  labels?: GitLabLabel[];
  object_attributes: GitLabMergeRequest & {
    action: MergeRequestAction;
    oldrev?: string;
    last_commit?: GitLabCommit;
    source?: GitLabProject;
    target?: GitLabProject;
  };
  changes?: Record<string, { current: unknown; previous: unknown }>;
}

export interface GitLabNoteWebhook extends GitLabWebhookBase {
  object_kind: 'note';
  commit?: GitLabCommit;
  issue?: GitLabIssue;
  merge_request?: GitLabMergeRequest;
  object_attributes: GitLabNote & {
    action?: string;
    discussion_id?: string;
  };
  snippet?: { id: number; title?: string };
}

export interface GitLabPushCommit {
  added?: string[];
  author?: { email?: string; name?: string };
  id: string;
  message: string;
  modified?: string[];
  removed?: string[];
  timestamp?: string;
  title?: string;
  url?: string;
}

export interface GitLabPushWebhook extends GitLabWebhookBase {
  object_kind: 'push';
  after: string;
  before: string;
  checkout_sha?: string | null;
  commits: GitLabPushCommit[];
  project_id?: number;
  ref: string;
  repository?: {
    description?: string;
    git_http_url?: string;
    git_ssh_url?: string;
    homepage?: string;
    name?: string;
    url?: string;
  };
  total_commits_count?: number;
  user_email?: string;
  user_name?: string;
  user_username?: string;
}

export interface GitLabPipelineWebhook extends GitLabWebhookBase {
  object_kind: 'pipeline';
  object_attributes: GitLabPipeline & { name?: string };
  commit?: GitLabCommit;
  merge_request?: GitLabMergeRequest;
}

export interface GitLabIssueWebhook extends GitLabWebhookBase {
  object_kind: 'issue';
  changes?: Record<string, { current: unknown; previous: unknown }>;
  labels?: GitLabLabel[];
  object_attributes: GitLabIssue & { action: IssueAction };
}

export interface GitLabBuildWebhook extends GitLabWebhookBase {
  object_kind: 'build' | 'job';
  before_sha?: string;
  build_created_at?: string;
  build_duration?: number | null;
  build_finished_at?: string | null;
  build_id: number;
  build_name: string;
  build_stage: string;
  build_status: JobStatus;
  build_started_at?: string | null;
  commit?: GitLabCommit;
  pipeline_id?: number;
  ref?: string;
  runner?: { description?: string; id: number } | null;
  sha?: string;
  tag?: boolean;
}

export interface GitLabDeploymentWebhook extends GitLabWebhookBase {
  object_kind: 'deployment';
  deployable_id: number;
  deployable_url?: string;
  environment?: string;
  id: number;
  ref?: string;
  sha?: string;
  short_sha?: string;
  status: DeploymentStatus;
}

export interface GitLabTagPushWebhook extends GitLabWebhookBase {
  object_kind: 'tag_push';
  after: string;
  before: string;
  checkout_sha?: string | null;
  commits: GitLabPushCommit[];
  ref: string;
  user_name?: string;
  user_username?: string;
}

export type GitLabWebhookPayload =
  | GitLabBuildWebhook
  | GitLabDeploymentWebhook
  | GitLabIssueWebhook
  | GitLabMergeRequestWebhook
  | GitLabNoteWebhook
  | GitLabPipelineWebhook
  | GitLabPushWebhook
  | GitLabTagPushWebhook;

export interface GitLabWebhookEnvelope {
  deliveryId?: string;
  eventType: GitLabSupportedEvent;
  headers?: Record<string, string>;
  payload: GitLabWebhookPayload;
}

export interface AgentDiscussionComment {
  body: string;
  created_at?: string;
  position?: GitLabDiscussionPosition;
}

export interface AgentMergeRequestUpdate {
  assignee_ids?: number[];
  description?: string | null;
  labels?: string;
  remove_source_branch?: boolean;
  squash?: boolean;
  state_event?: 'close' | 'reopen';
  target_branch?: string;
  title?: string;
}

export interface AgentIssueUpdate {
  assignee_ids?: number[];
  confidential?: boolean;
  description?: string | null;
  labels?: string;
  state_event?: 'close' | 'reopen';
  title?: string;
}

export interface WritebackPathTarget {
  entity: 'issue' | 'issue_note' | 'merge_request' | 'merge_request_discussion';
  projectPath: string;
  resourceId: string;
}

export interface WritebackResult {
  success: boolean;
  externalId?: string;
  error?: string;
}
