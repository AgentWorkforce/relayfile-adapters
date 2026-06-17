export { GitLabApiClient } from './api.js';
export { GitLabAdapter, DEFAULT_CONFIG } from './adapter.js';
export { bulkIngestProject } from './bulk-ingest.js';
export { ingestCommit, mapCommitNoteToOperation } from './commits/ingestion.js';
export { ingestIssue, mapIssueNoteToOperation } from './issues/ingestion.js';
export * from './materialization-policy.js';
export { mapApprovalsToOperation } from './mr/approvals.js';
export { parseDiffEntries, renderMergeRequestPatch } from './mr/diff-parser.js';
export { mapDiscussionToOperation, mapDiscussionWebhookToOperation, buildDiscussionCreateBody } from './mr/discussions.js';
export { ingestMergeRequest } from './mr/ingestion.js';
export * from './digest.js';
export * from './emit-auxiliary-files.js';
export * from './index-emitter.js';
export * from './layout.js';
export * from './layout-prompt.js';
export * from './summary.js';
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
  gitLabByAssigneeAliasPath,
  gitLabByCreatorAliasPath,
  gitLabByIdAliasPath,
  gitLabByPriorityAliasPath,
  gitLabByRefAliasPath,
  gitLabByStateAliasPath,
  gitLabByStatusAliasPath,
  gitLabByTitleAliasPath,
  gitLabFlatRecordFilename,
  gitLabProjectMetadataPath,
  gitLabProjectPrefix,
  gitLabProjectResourceIndexPath,
  gitLabProjectsIndexPath,
  gitLabRecordDirectorySegment,
  gitLabRootIndexPath,
  normalizeGitLabTagRef,
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
  GitLabMaterializationFilter,
  GitLabMaterializationMode,
  GitLabMaterializationPolicy,
  GitLabMaterializationResource,
  GitLabMaterializationRule,
  GitLabMaterializationState,
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
export type {
  GitLabDirectoryResourceType,
  GitLabFlatResourceType,
  GitLabIndexedResourceType,
  GitLabResourceType,
  GitLabStatefulResourceType,
  GitLabTitledResourceType,
  ParsedGitLabPath,
} from './path-mapper.js';

export * from './resources.js';
export * from './sync-bucketing.js';
