import { computeCanonicalPath } from '@relayfile/sdk';
import type { FileSemantics, WebhookInput } from '@relayfile/sdk';

import { GitLabApiClient } from './api.js';
import { bulkIngestProject } from './bulk-ingest.js';
import { ingestCommit, mapCommitNoteToOperation } from './commits/ingestion.js';
import { ingestIssue, mapIssueNoteToOperation } from './issues/ingestion.js';
import { ingestMergeRequest } from './mr/ingestion.js';
import { mapDiscussionWebhookToOperation } from './mr/discussions.js';
import {
  computeGitLabPath,
  computeMetadataPath,
  computeSnippetCommentPath,
} from './path-mapper.js';
import { ingestPipeline } from './pipeline/ingestion.js';
import { mapJobStatusToOperationMode, mapPipelineStatusToOperationMode } from './pipeline/job-mapper.js';
import {
  GITLAB_SUPPORTED_EVENTS as DEFAULT_SUPPORTED_EVENTS,
  IntegrationAdapter,
  type ConnectionProvider,
  type GitLabAdapterConfig,
  type GitLabBuildWebhook,
  type GitLabDeploymentWebhook,
  type GitLabIssueWebhook,
  type GitLabMergeRequestWebhook,
  type GitLabNoteWebhook,
  type GitLabPipelineWebhook,
  type GitLabPushWebhook,
  type GitLabSupportedEvent,
  type GitLabTagPushWebhook,
  type GitLabWebhookPayload,
  type IngestOperation,
  type IngestResult,
  type SyncOptions,
  type SyncResult,
  type WritebackResult,
} from './types.js';
import { EVENT_MAP, extractEventKey } from './webhook/router.js';
import { normalizeWebhook } from './webhook/normalizer.js';
import { verifyWebhookToken } from './webhook/verify.js';
import { GitLabWritebackHandler } from './writeback.js';

export const DEFAULT_CONFIG: GitLabAdapterConfig = {
  baseUrl: 'https://gitlab.com',
  apiVersion: 'v4',
  defaultBranch: 'main',
  fetchFileContents: true,
  maxFileSizeBytes: 1024 * 1024,
  perPage: 50,
  supportedEvents: [...DEFAULT_SUPPORTED_EVENTS],
};

function emptyResult(): IngestResult {
  return {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
    operations: [],
  };
}

function fromOperations(operations: IngestOperation[]): IngestResult {
  return {
    filesWritten: operations.filter((operation) => operation.mode === 'write').length,
    filesUpdated: operations.filter((operation) => operation.mode === 'update').length,
    filesDeleted: 0,
    paths: operations.map((operation) => operation.path),
    errors: [],
    operations,
  };
}

export class GitLabAdapter extends IntegrationAdapter {
  readonly name = 'gitlab';
  readonly version = '0.1.0';
  private readonly api: GitLabApiClient;
  private readonly writebackHandler: GitLabWritebackHandler;

  constructor(provider: ConnectionProvider, config: Partial<GitLabAdapterConfig> = {}) {
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...config,
      supportedEvents: config.supportedEvents ?? [...DEFAULT_SUPPORTED_EVENTS],
    };
    super(provider, mergedConfig);
    this.api = new GitLabApiClient(this.provider, this.config);
    this.writebackHandler = new GitLabWritebackHandler(this.provider, {
      baseUrl: this.config.baseUrl,
      connectionId: this.config.connectionId,
    });
  }

  supportedEvents(): string[] {
    return [...this.config.supportedEvents];
  }

  async ingestWebhook(_workspaceId: string, event: WebhookInput): Promise<IngestResult> {
    return this.routeWebhook(event.payload as unknown as GitLabWebhookPayload, event.eventType as GitLabSupportedEvent);
  }

  async routeWebhook(
    payload: GitLabWebhookPayload,
    explicitEventType?: GitLabSupportedEvent,
    headers?: Headers | Record<string, string | string[] | undefined>,
  ): Promise<IngestResult> {
    if (this.config.webhookSecret && headers) {
      verifyWebhookToken(headers, this.config.webhookSecret);
    }

    const eventType = explicitEventType ?? extractEventKey(payload);
    const handler = EVENT_MAP[eventType];
    if (!handler) {
      const result = emptyResult();
      result.errors.push({
        path: computeCanonicalPath(this.name, 'events', eventType),
        error: `Unsupported GitLab event: ${eventType}`,
      });
      return result;
    }

    const normalized = normalizeWebhook(payload, eventType);
    return handler(this, normalized, payload);
  }

  computePath(objectType: string, objectId: string): string {
    return computeGitLabPath(objectType, objectId);
  }

  computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const semantics: FileSemantics = {
      properties: {
        provider: this.name,
        objectId,
        objectType,
      },
      relations: [],
    };

    const project = payload.project;
    if (project && typeof project === 'object' && !Array.isArray(project)) {
      const projectPath = (project as { path_with_namespace?: string }).path_with_namespace;
      if (projectPath) {
        semantics.properties = {
          ...semantics.properties,
          projectPath,
        };
        semantics.relations = [`gitlab:project:${projectPath}`];
      }
    }

    return semantics;
  }

  async sync(_workspaceId: string, options: SyncOptions = {}): Promise<SyncResult> {
    return bulkIngestProject(this.api, {
      ...options,
      projectPath: options.projectPath ?? this.config.projectPath,
    });
  }

  async writeBack(workspaceId: string, path: string, content: string): Promise<WritebackResult> {
    return this.writebackHandler.writeBack(workspaceId, path, content);
  }

  async ingestMergeRequest(
    _normalized: WebhookInput,
    payload: GitLabWebhookPayload,
  ): Promise<IngestResult> {
    const mergeRequest = payload as GitLabMergeRequestWebhook;
    return fromOperations(
      await ingestMergeRequest(this.api, mergeRequest.project.path_with_namespace, mergeRequest.object_attributes.iid, 'write'),
    );
  }

  async updateMergeRequest(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const mergeRequest = payload as GitLabMergeRequestWebhook;
    return fromOperations(
      await ingestMergeRequest(this.api, mergeRequest.project.path_with_namespace, mergeRequest.object_attributes.iid, 'update'),
    );
  }

  async closeMergeRequest(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    return this.updateMergeRequest(_normalized, payload);
  }

  async mergeMergeRequest(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    return this.updateMergeRequest(_normalized, payload);
  }

  async ingestApproval(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    return this.updateMergeRequest(_normalized, payload);
  }

  async ingestNote(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const notePayload = payload as GitLabNoteWebhook;
    const projectPath = notePayload.project.path_with_namespace;

    switch (notePayload.object_attributes.noteable_type) {
      case 'MergeRequest':
        return fromOperations([mapDiscussionWebhookToOperation(projectPath, notePayload)]);
      case 'Issue':
        return fromOperations([
          mapIssueNoteToOperation(projectPath, notePayload.issue?.iid ?? notePayload.object_attributes.noteable_iid ?? 0, notePayload),
        ]);
      case 'Commit':
        return fromOperations([
          mapCommitNoteToOperation(projectPath, notePayload.commit?.id ?? '', notePayload),
        ]);
      case 'Snippet':
        return fromOperations([
          {
            path: computeSnippetCommentPath(
              projectPath,
              notePayload.object_attributes.noteable_id ?? 0,
              notePayload.object_attributes.id,
            ),
            mode: 'write',
            content: JSON.stringify(notePayload.object_attributes, null, 2),
            contentType: 'application/json',
          },
        ]);
    }
  }

  async ingestPush(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const pushPayload = payload as GitLabPushWebhook;
    const operations: IngestOperation[] = [];
    for (const commit of pushPayload.commits) {
      operations.push(
        ...(await ingestCommit(this.api, pushPayload.project.path_with_namespace, commit.id, 'write')),
      );
    }

    if (operations.length === 0 && pushPayload.after) {
      operations.push(
        ...(await ingestCommit(this.api, pushPayload.project.path_with_namespace, pushPayload.after, 'write')),
      );
    }

    return fromOperations(operations);
  }

  async ingestPipeline(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const pipelinePayload = payload as GitLabPipelineWebhook;
    return fromOperations(
      await ingestPipeline(
        this.api,
        pipelinePayload.project.path_with_namespace,
        pipelinePayload.object_attributes.id,
        mapPipelineStatusToOperationMode(pipelinePayload.object_attributes.status),
      ),
    );
  }

  async ingestJob(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const jobPayload = payload as GitLabBuildWebhook;
    const projectPath = jobPayload.project.path_with_namespace;
    const pipelineId = jobPayload.pipeline_id ?? 0;
    const operations: IngestOperation[] = [
      {
        path: computeMetadataPath(projectPath, 'pipelines', pipelineId),
        mode: 'update',
        content: JSON.stringify(
          {
            id: pipelineId,
            ref: jobPayload.ref,
            sha: jobPayload.sha,
            status: jobPayload.build_status,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      },
      {
        path: this.computePath('pipelines', `${projectPath}/pipelines/${pipelineId}`).replace(
          '/metadata.json',
          `/jobs/${encodeURIComponent(String(jobPayload.build_id))}.json`,
        ),
        mode: mapJobStatusToOperationMode(jobPayload.build_status),
        content: JSON.stringify(jobPayload, null, 2),
        contentType: 'application/json',
      },
    ];

    return fromOperations(operations);
  }

  async ingestIssue(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const issuePayload = payload as GitLabIssueWebhook;
    return fromOperations(
      await ingestIssue(this.api, issuePayload.project.path_with_namespace, issuePayload.object_attributes.iid, 'write'),
    );
  }

  async closeIssue(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const issuePayload = payload as GitLabIssueWebhook;
    return fromOperations(
      await ingestIssue(this.api, issuePayload.project.path_with_namespace, issuePayload.object_attributes.iid, 'update'),
    );
  }

  async updateIssue(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    return this.closeIssue(_normalized, payload);
  }

  async ingestDeployment(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const deploymentPayload = payload as GitLabDeploymentWebhook;
    return fromOperations([
      {
        path: computeMetadataPath(deploymentPayload.project.path_with_namespace, 'deployments', deploymentPayload.id),
        mode: deploymentPayload.status === 'created' ? 'write' : 'update',
        content: JSON.stringify(deploymentPayload, null, 2),
        contentType: 'application/json',
      },
    ]);
  }

  async ingestTagPush(_normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<IngestResult> {
    const tagPayload = payload as GitLabTagPushWebhook;
    return fromOperations([
      {
        path: computeMetadataPath(tagPayload.project.path_with_namespace, 'tags', tagPayload.ref),
        mode: 'write',
        content: JSON.stringify(tagPayload, null, 2),
        contentType: 'application/json',
      },
    ]);
  }
}
