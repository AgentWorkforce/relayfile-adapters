export { GitLabApiClient } from './api.js';
export { GitLabAdapter, DEFAULT_CONFIG } from './adapter.js';
export { bulkIngestProject } from './bulk-ingest.js';
export { ingestCommit, mapCommitNoteToOperation } from './commits/ingestion.js';
export { ingestIssue, mapIssueNoteToOperation } from './issues/ingestion.js';
export { mapApprovalsToOperation } from './mr/approvals.js';
export { parseDiffEntries, renderMergeRequestPatch } from './mr/diff-parser.js';
export { mapDiscussionToOperation, mapDiscussionWebhookToOperation, buildDiscussionCreateBody } from './mr/discussions.js';
export { ingestMergeRequest } from './mr/ingestion.js';
export {
  computeCommitCommentPath,
  computeGitLabPath,
  computeIssueCommentPath,
  computeMergeRequestApprovalsPath,
  computeMergeRequestDiffPath,
  computeMergeRequestDiscussionPath,
  computeMetadataPath,
  computePipelineJobPath,
  computeSnippetCommentPath,
  decodeProjectPath,
  encodeProjectPath,
  parseGitLabPath,
} from './path-mapper.js';
export { ingestPipeline } from './pipeline/ingestion.js';
export { mapJobStatusToOperationMode, mapPipelineStatusToOperationMode } from './pipeline/job-mapper.js';
export { normalizeWebhook, computePathFromWebhook } from './webhook/normalizer.js';
export { EVENT_MAP, extractEventKey, extractProjectInfo, routeGitLabWebhook } from './webhook/router.js';
export { verifyWebhookToken, WebhookVerificationError } from './webhook/verify.js';
export { GitLabWritebackHandler } from './writeback.js';
export type {
  AgentDiscussionComment,
  AgentIssueUpdate,
  AgentMergeRequestUpdate,
  ConnectionProvider,
  DeploymentStatus,
  GitLabAdapterConfig,
  GitLabApprovalState,
  GitLabBuildWebhook,
  GitLabCommit,
  GitLabDeployment,
  GitLabDeploymentWebhook,
  GitLabDiffEntry,
  GitLabDiscussion,
  GitLabDiscussionPosition,
  GitLabIssue,
  GitLabIssueWebhook,
  GitLabJob,
  GitLabLabel,
  GitLabMergeRequest,
  GitLabMergeRequestWebhook,
  GitLabNamespace,
  GitLabNote,
  GitLabNoteWebhook,
  GitLabPipeline,
  GitLabPipelineWebhook,
  GitLabProject,
  GitLabPushCommit,
  GitLabPushWebhook,
  GitLabRepositoryFile,
  GitLabSupportedEvent,
  GitLabSyncObjectType,
  GitLabTagPushWebhook,
  GitLabUser,
  GitLabWebhookEnvelope,
  GitLabWebhookEventType,
  GitLabWebhookPayload,
  IngestError,
  IngestOperation,
  IngestResult,
  IssueAction,
  JobStatus,
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MergeRequestAction,
  NoteableType,
  PipelineStatus,
  ProxyMethod,
  ProxyRequest,
  ProxyResponse,
  SyncOptions,
  SyncResult,
  WebhookInput,
  WritebackPathTarget,
  WritebackResult,
} from './types.js';
export type { GitLabResourceType, ParsedGitLabPath } from './path-mapper.js';
