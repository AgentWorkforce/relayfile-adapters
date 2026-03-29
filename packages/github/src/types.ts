import type {
  ConnectionProvider,
  ProxyRequest as SharedProxyRequest,
  ProxyResponse as SharedProxyResponse,
} from '@relayfile/sdk';

export type { ConnectionProvider } from '@relayfile/sdk';

export const GITHUB_REVIEW_EVENTS = ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'] as const;
export const GITHUB_REVIEW_SIDES = ['LEFT', 'RIGHT'] as const;
export const DEFAULT_GITHUB_EVENTS = [
  'pull_request.opened',
  'pull_request.synchronize',
  'pull_request.closed',
  'pull_request_review.submitted',
  'pull_request_review_comment.created',
  'push',
  'issues.opened',
  'issues.closed',
  'check_run.completed',
] as const;

export type GitHubReviewEvent = (typeof GITHUB_REVIEW_EVENTS)[number];
export type GitHubReviewSide = (typeof GITHUB_REVIEW_SIDES)[number];
export type GitHubSupportedEvent = (typeof DEFAULT_GITHUB_EVENTS)[number];
export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface AgentComment {
  path: string;
  line: number;
  side: GitHubReviewSide;
  body: string;
  suggestion?: string;
}

export interface AgentReviewMetadata {
  commitSha?: string;
  connectionId?: string;
  providerConfigKey?: string;
}

export interface AgentReview {
  event: GitHubReviewEvent;
  body: string;
  comments: AgentComment[];
  metadata?: AgentReviewMetadata;
}

export interface GitHubReviewComment {
  path: string;
  line: number;
  side: GitHubReviewSide;
  body: string;
}

export interface GitHubCreateReviewInput {
  event: GitHubReviewEvent;
  body: string;
  comments: GitHubReviewComment[];
}

export type ProxyRequest = SharedProxyRequest;
export type ProxyResponse<T = JsonValue | null> = SharedProxyResponse<T>;

export interface GitHubRequestProvider extends Pick<ConnectionProvider, 'name'> {
  connectionId?: string;
  defaultConnectionId?: string;
  providerConfigKey?: string;
  defaultProviderConfigKey?: string;
  resolveConnectionId?: () => Promise<string> | string;
  getConnectionId?: () => Promise<string> | string;
  proxy(request: ProxyRequest): Promise<ProxyResponse>;
}

export interface GitHubActor {
  id?: number;
  login: string;
  type?: string;
  url?: string;
}

export interface GitHubBranchRef {
  ref: string;
  sha: string;
  repo?: string;
}

export interface GitHubLabel {
  name: string;
  color?: string;
  description?: null | string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author?: GitHubActor;
  url?: string;
  committedAt?: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  body?: null | string;
  author?: GitHubActor;
  head: GitHubBranchRef;
  base: GitHubBranchRef;
  labels?: GitHubLabel[];
  url?: string;
  draft?: boolean;
  merged?: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  body?: null | string;
  author?: GitHubActor;
  labels?: GitHubLabel[];
  url?: string;
}

export interface GitHubReview {
  id: number | string;
  state: string;
  body?: null | string;
  user?: GitHubActor;
  submittedAt?: string;
  commitSha?: string;
  url?: string;
}

export interface GitHubCheckRun {
  id: number | string;
  name: string;
  status: string;
  conclusion?: null | string;
  url?: string;
  detailsUrl?: string;
  headSha?: string;
}

export interface GitHubWebhookEnvelope {
  eventType: string;
  deliveryId?: string;
  payload: Record<string, unknown>;
}

export type GitHubWebhookEvent =
  | (GitHubWebhookEnvelope & { action: string })
  | (GitHubWebhookEnvelope & { action?: undefined });

export interface GitHubAdapterConfig {
  baseUrl: string;
  defaultBranch: string;
  fetchFileContents: boolean;
  maxFileSizeBytes: number;
  supportedEvents: string[];
  owner?: string;
  repo?: string;
  connectionId?: string;
  providerConfigKey?: string;
}

export interface NormalizedWebhook {
  provider: string;
  connectionId: string;
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
}

export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
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
}

export interface SyncOptions {
  cursor?: string;
  limit?: number;
  full?: boolean;
}

export interface SyncResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  cursor?: string;
  syncedObjectTypes: string[];
  errors: Array<{ objectType?: string; error: string }>;
}

export abstract class IntegrationAdapter {
  protected readonly provider: ConnectionProvider;
  protected readonly config: GitHubAdapterConfig;
  abstract readonly name: string;
  abstract readonly version: string;

  constructor(provider: ConnectionProvider, config: GitHubAdapterConfig) {
    this.provider = provider;
    this.config = config;
  }

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook): Promise<IngestResult>;
  abstract computePath(objectType: string, objectId: string): string;
  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;
  sync?(workspaceId: string, options?: SyncOptions): Promise<SyncResult>;
  writeBack?(workspaceId: string, path: string, content: string): Promise<WritebackResult | void>;
  supportedEvents?(): string[];
}

export interface WritebackPathTarget {
  owner: string;
  prNumber: number;
  repo: string;
}

export interface WritebackResult {
  success: boolean;
  externalId?: string;
  error?: string;
}
