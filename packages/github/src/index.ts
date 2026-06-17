import type { SchemaAdapter } from '@relayfile/adapter-core';
import type { ConnectionProvider } from '@relayfile/sdk';

import { createGitHubSchemaAdapter } from './adapter.js';
import { DEFAULT_CONFIG, validateConfig } from './config.js';
import type { VfsLike } from './files/content-fetcher.js';
import { mergeIngestResults, vfsPathExists } from './ingest-utils.js';
import { isActualIssue } from './issues/fetcher.js';
import {
  persistIssueRecordFromObject,
  reconcileIssueRecord,
} from './issues/issue-mapper.js';
import { materializeRepo as materializeGitHubRepo, syncGitHubWorkspace } from './lazy.js';
import { shouldWriteWebhookForRepo } from './materialization-policy.js';
import {
  githubByIdAliasPath,
  githubDeploymentStatusPath,
  githubIssuePath,
  githubPullRequestPath,
} from './path-mapper.js';
import {
  type FileSemantics,
  type GitHubAdapterConfig,
  type GitHubRequestProvider,
  type IngestResult,
  IntegrationAdapter as LocalIntegrationAdapter,
  type JsonObject,
  type MaterializeResult,
  type NormalizedWebhook,
  type SyncOptions,
  type SyncResult,
} from './types.js';
import { extractRepoInfo, EVENT_MAP, type WebhookAdapter } from './webhook/event-map.js';
import { createRouter } from './webhook/router.js';
import { GitHubWritebackHandler } from './writeback.js';

export * from './emit-auxiliary-files.js';
export * from './digest.js';
export * from './index-emitter.js';
export * from './layout.js';
export * from './layout-prompt.js';
export * from './summary.js';
export * from './thread.js';
export * from './proactive/review-adapter.github.js';

const EMPTY_RESULT: IngestResult = {
  filesWritten: 0,
  filesUpdated: 0,
  filesDeleted: 0,
  paths: [],
  errors: [],
};

export const adapterName = 'github' as const;
export const GITHUB_ADAPTER_NAME = adapterName;

export class GitHubAdapter extends LocalIntegrationAdapter implements WebhookAdapter {
  readonly name = GITHUB_ADAPTER_NAME;
  readonly version = '0.1.0';
  private readonly inFlightMaterializations = new Map<string, Promise<MaterializeResult>>();
  private readonly schemaAdapter: SchemaAdapter;
  private readonly writebackHandler: GitHubWritebackHandler;

  constructor(provider: ConnectionProvider, config: Partial<GitHubAdapterConfig> = {}) {
    const validatedConfig = validateConfig({
      ...DEFAULT_CONFIG,
      ...config,
    });
    super(provider, validatedConfig);
    this.schemaAdapter = createGitHubSchemaAdapter(provider, validatedConfig);
    this.writebackHandler = new GitHubWritebackHandler(provider as never, {
      defaultConnectionId: validatedConfig.connectionId,
      defaultProviderConfigKey: validatedConfig.providerConfigKey,
    });
  }

  supportedEvents(): string[] {
    return [...this.config.supportedEvents];
  }

  /**
   * Connection-level scope keys a persona may set under
   * `integrations.github.scope` to filter what this adapter syncs/writes
   * (e.g. `{ owner: 'acme', repo: 'web' }`). These are the user-facing filter
   * params on {@link GitHubAdapterConfig} — not infra fields like
   * `connectionId`. Emitted into `@relayfile/adapter-core/scope-keys` so persona
   * authoring can autocomplete/lint scope keys per provider.
   */
  supportedScopeKeys(): string[] {
    return ['owner', 'repo'];
  }

  async ingestWebhook(_workspaceId: string, event: NormalizedWebhook): Promise<IngestResult> {
    return this.routeWebhook(event.payload, event.eventType);
  }

  async routeWebhook(
    payload: Record<string, unknown>,
    explicitEventType?: string,
    headers?: Headers | Record<string, string | string[] | undefined>,
  ): Promise<IngestResult> {
    if (headers && !explicitEventType) {
      return createRouter(this).route(headers, payload);
    }

    const eventType = explicitEventType ?? '';
    const handler = EVENT_MAP[eventType];

    if (!handler) {
      return {
        ...EMPTY_RESULT,
        errors: [{ path: this.computePath('events', eventType || 'unknown'), error: `Unsupported event: ${eventType || 'unknown'}` }],
      };
    }

    return handler(this, payload);
  }

  computePath(objectType: string, objectId: string): string {
    const repoPrefix = this.getRepoPrefix();

    switch (objectType) {
      case 'pull_request':
        return `${repoPrefix}/pulls/${objectId}/meta.json`;
      case 'issue':
        return `${repoPrefix}/issues/${objectId}/meta.json`;
      case 'review':
        return `${repoPrefix}/reviews/${objectId}.json`;
      case 'review_thread':
        return `${repoPrefix}/review-threads/${objectId}.json`;
      case 'check_run':
        return `${repoPrefix}/checks/${objectId}.json`;
      case 'deployment_status':
        return githubDeploymentStatusPath(
          this.config.owner ?? '_owner',
          this.config.repo ?? '_repo',
          'deployment-unknown',
          objectId,
        );
      case 'commit':
        return `${repoPrefix}/commits/${objectId}/metadata.json`;
      default:
        return `/github/${objectType}/${objectId}.json`;
    }
  }

  computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const properties: Record<string, string> = {
      provider: this.name,
      objectType,
      objectId,
    };

    const action = normalizeLifecycleAction(objectType, payload);
    if (action) {
      properties.action = action;
    }

    const repoInfo = extractRepoInfo(payload);
    if (repoInfo.owner) {
      properties.owner = repoInfo.owner;
    }
    if (repoInfo.repo) {
      properties.repo = repoInfo.repo;
    }
    if (repoInfo.number !== undefined) {
      properties.number = String(repoInfo.number);
    }

    return {
      properties,
      relations: repoInfo.number !== undefined ? [`github:${objectType}:${repoInfo.number}`] : [],
    };
  }

  async ingestPullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult('pull_request.opened', 'pull_request', payload, 'write');
  }

  async updatePullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    const action = readString(payload.action);
    return this.createIngestResult(
      action ? `pull_request.${action}` : 'pull_request.updated',
      'pull_request',
      payload,
      'update',
    );
  }

  async closePullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult(
      isMergedPullRequestPayload(payload) ? 'pull_request.merged' : 'pull_request.closed',
      'pull_request',
      payload,
      'update',
    );
  }

  async ingestReview(payload: Record<string, unknown>): Promise<IngestResult> {
    const action = readString(payload.action);
    return this.createIngestResult(
      action ? `pull_request_review.${action}` : 'pull_request_review.submitted',
      'review',
      payload,
      action === 'submitted' || !action ? 'write' : 'update',
    );
  }

  async ingestReviewComment(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult(
      'pull_request_review_comment.created',
      'review_comment',
      payload,
      'write',
    );
  }

  async ingestReviewThread(payload: Record<string, unknown>): Promise<IngestResult> {
    const action = readString(payload.action);
    return this.createIngestResult(
      action ? `pull_request_review_thread.${action}` : 'pull_request_review_thread.resolved',
      'review_thread',
      payload,
      'update',
    );
  }

  async ingestIssueComment(payload: Record<string, unknown>): Promise<IngestResult> {
    const result = await this.createIngestResult(
      'issue_comment.created',
      'issue_comment',
      payload,
      'write',
    );

    // A comment event materializes `issues/<n>/comments/...`, but if the parent
    // issue's `issues.opened` webhook was missed the issue itself has no
    // `meta.json` (labels/state), leaving a "comments-only" dir that is
    // invisible to label-gated consumers. Backfill the issue record lazily.
    // See issue #176.
    const backfill = await this.backfillIssueIfMissing(payload);
    return backfill ? mergeIngestResults(result, backfill) : result;
  }

  async ingestPushCommits(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult('push', 'commit', payload, 'write');
  }

  async ingestIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.reconcileIssue('issues.opened', payload, 'write');
  }

  async updateIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    const action = readString(payload.action);
    return this.reconcileIssue(
      action ? `issues.${action}` : 'issues.updated',
      payload,
      'update',
    );
  }

  async closeIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.reconcileIssue('issues.closed', payload, 'update');
  }

  async ingestCheckRun(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult('check_run.completed', 'check_run', payload, 'write');
  }

  async ingestDeploymentStatus(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult(
      'deployment_status.created',
      'deployment_status',
      payload,
      'write',
    );
  }

  async sync(_workspaceId: string, options: SyncOptions = {}): Promise<SyncResult> {
    return syncGitHubWorkspace(_workspaceId, this.provider as never, this.config, this.inFlightMaterializations, options);
  }

  async materializeRepo(workspaceId: string, owner: string, repo: string): Promise<MaterializeResult> {
    return materializeGitHubRepo(
      workspaceId,
      this.provider as never,
      this.config,
      owner,
      repo,
      this.inFlightMaterializations,
    );
  }

  async writeBack(workspaceId: string, path: string, content: string) {
    return this.writebackHandler.writeBack(workspaceId, path, content);
  }

  /**
   * Reconcile an issue record on an `issues.*` webhook rather than trusting the
   * envelope. When the provider can write to the mount we re-fetch the issue
   * (authoritative labels/state) and write a complete `meta.json` + aliases +
   * indexes; on a fetch failure we fall back to mapping the envelope's `issue`
   * object so the labels it carried are still persisted. When the provider is
   * not VFS-capable (e.g. unit tests) we keep the legacy path-only behaviour so
   * the upstream materializer writes the envelope. See issue #176.
   */
  private async reconcileIssue(
    eventType: string,
    payload: Record<string, unknown>,
    mode: 'update' | 'write',
  ): Promise<IngestResult> {
    const target = this.resolveIssueTarget(payload);
    const vfs = this.tryGetVfsProvider();

    if (vfs && target && shouldWriteWebhookForRepo(this.config, target.owner, target.repo)) {
      try {
        return await reconcileIssueRecord(
          this.provider as unknown as GitHubRequestProvider,
          target.owner,
          target.repo,
          target.number,
          vfs,
          this.config.connectionId,
        );
      } catch {
        // Re-fetch failed (network/auth/rate-limit). Persist what the envelope
        // carried so labels are not silently dropped.
        const envelopeIssue = asRecord(payload.issue);
        if (envelopeIssue && isActualIssue(envelopeIssue as JsonObject)) {
          try {
            const repository = asRecord(payload.repository);
            return await persistIssueRecordFromObject(
              vfs,
              target.owner,
              target.repo,
              envelopeIssue as JsonObject,
              repository ? (repository as JsonObject) : undefined,
            );
          } catch {
            // Fall through to the path-only result below.
          }
        }
      }
    }

    return this.createIngestResult(eventType, 'issue', payload, mode);
  }

  /**
   * Materialize an issue's canonical record if no `meta.json` exists yet. Driven
   * by `issue_comment.created` so a comment can no longer leave a labels-less,
   * meta-less issue directory behind. See issue #176.
   */
  private async backfillIssueIfMissing(
    payload: Record<string, unknown>,
  ): Promise<IngestResult | undefined> {
    const target = this.resolveIssueTarget(payload);
    const vfs = this.tryGetVfsProvider();
    if (!vfs || !target || !shouldWriteWebhookForRepo(this.config, target.owner, target.repo)) {
      return undefined;
    }

    const byIdAliasPath = githubByIdAliasPath(target.owner, target.repo, 'issues', target.number);
    if (await vfsPathExists(vfs, byIdAliasPath)) {
      return undefined;
    }

    try {
      return await reconcileIssueRecord(
        this.provider as unknown as GitHubRequestProvider,
        target.owner,
        target.repo,
        target.number,
        vfs,
        this.config.connectionId,
      );
    } catch {
      return undefined;
    }
  }

  private resolveIssueTarget(
    payload: Record<string, unknown>,
  ): { owner: string; repo: string; number: number } | undefined {
    const repoInfo = extractRepoInfo(payload);
    const owner = repoInfo.owner || this.config.owner;
    const repo = repoInfo.repo || this.config.repo;
    const number = repoInfo.number;
    if (!owner || !repo || typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
      return undefined;
    }
    return { owner, repo, number };
  }

  /**
   * Return the provider as a VFS writer when it exposes a write method,
   * otherwise `undefined`. Mirrors the lazy-sync VFS check but never throws so
   * non-VFS providers (unit tests, dry runs) cleanly fall back.
   */
  private tryGetVfsProvider(): VfsLike | undefined {
    const candidate = this.provider as unknown as VfsLike;
    const hasWriter = Boolean(
      candidate.writeFile ?? candidate.write ?? candidate.put ?? candidate.set ?? candidate.upsert,
    );
    return hasWriter ? candidate : undefined;
  }

  private async createIngestResult(
    eventType: string,
    objectType: string,
    payload: Record<string, unknown>,
    mode: 'update' | 'write',
  ): Promise<IngestResult> {
    const objectId = this.resolveObjectId(objectType, payload);
    const title = this.resolveTitle(objectType, payload);
    const path =
      (title ? this.computeScopedPath(objectType, objectId, payload, title) : undefined) ??
      this.computeSchemaScopedPath(eventType, objectType, objectId, payload) ??
      this.computeScopedPath(objectType, objectId, payload);

    return {
      filesWritten: mode === 'write' ? 1 : 0,
      filesUpdated: mode === 'update' ? 1 : 0,
      filesDeleted: 0,
      paths: [path],
      errors: [],
    };
  }

  private computeScopedPath(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
    title?: string,
  ): string {
    const repoInfo = extractRepoInfo(payload);
    const owner = repoInfo.owner || this.config.owner;
    const repo = repoInfo.repo || this.config.repo;

    if (!owner || !repo) {
      return this.computePath(objectType, objectId);
    }

    switch (objectType) {
      case 'pull_request':
        return githubPullRequestPath(owner, repo, objectId, title);
      case 'issue':
        return githubIssuePath(owner, repo, objectId, title);
      case 'review':
        return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/reviews/${objectId}.json`;
      case 'review_comment':
        return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/comments/${objectId}.json`;
      case 'review_thread': {
        const pullRequest = asRecord(payload.pull_request);
        const pullNumber = readNumericLike(pullRequest?.number);
        if (pullNumber) {
          return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/review-threads/${objectId}.json`;
        }
        return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/review-threads/${objectId}.json`;
      }
      case 'issue_comment': {
        // Directory records (`comments/<id>/meta.json`) so a comment's stem can
        // hold child records (e.g. reactions) without a file/dir collision on a
        // POSIX mount. See `githubIssueCommentPath` in `./path-mapper.ts`.
        const issue = asRecord(payload.issue);
        const issueNumber = readNumericLike(issue?.number);
        if (issueNumber) {
          return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments/${objectId}/meta.json`;
        }
        return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${objectId}/meta.json`;
      }
      case 'check_run':
        return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/checks/${objectId}.json`;
      case 'deployment_status': {
        const deploymentId =
          readNestedNumericLike(payload, 'deployment', 'id') ?? 'deployment-unknown';
        return githubDeploymentStatusPath(owner, repo, deploymentId, objectId);
      }
      case 'commit':
        return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${objectId}/metadata.json`;
      default:
        return this.computePath(objectType, objectId);
    }
  }

  private computeSchemaScopedPath(
    eventType: string,
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): string | undefined {
    try {
      return this.schemaAdapter.computeWebhookPath({
        provider: this.name,
        connectionId: this.config.connectionId ?? 'schema-adapter',
        eventType,
        objectType,
        objectId,
        payload,
      });
    } catch {
      return undefined;
    }
  }

  private getRepoPrefix(): string {
    const owner = this.config.owner ? encodeURIComponent(this.config.owner) : '_owner';
    const repo = this.config.repo ? encodeURIComponent(this.config.repo) : '_repo';
    return `/github/repos/${owner}/${repo}`;
  }

  private resolveObjectId(objectType: string, payload: Record<string, unknown>): string {
    const candidates = [
      objectType === 'review' ? readNestedNumericLike(payload, 'review', 'id') : undefined,
      objectType === 'review_comment' ? readNestedNumericLike(payload, 'comment', 'id') : undefined,
      objectType === 'review_thread' ? readNestedNumericLike(payload, 'thread', 'id') : undefined,
      objectType === 'deployment_status'
        ? readNestedNumericLike(payload, 'deployment_status', 'id')
        : undefined,
      readNumericLike(payload.id),
      readNumericLike(payload.number),
      readNestedNumericLike(payload, 'pull_request', 'number'),
      readNestedNumericLike(payload, 'issue', 'number'),
      readNestedNumericLike(payload, 'comment', 'id'),
      readNestedString(payload, 'check_run', 'id'),
      readNestedString(payload, 'pull_request', 'head', 'sha'),
      readString(payload.after),
    ];

    const matched = candidates.find((value) => value !== undefined);
    return matched ?? `${objectType}-unknown`;
  }

  private resolveTitle(objectType: string, payload: Record<string, unknown>): string | undefined {
    if (objectType === 'pull_request') {
      return readNestedString(payload, 'pull_request', 'title') ?? readString(payload.title);
    }
    if (objectType === 'issue') {
      return readNestedString(payload, 'issue', 'title') ?? readString(payload.title);
    }
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNumericLike(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return readString(value);
}

function readNestedNumericLike(
  payload: Record<string, unknown>,
  ...path: string[]
): string | undefined {
  return readNumericLike(readNestedValue(payload, ...path));
}

function readNestedString(payload: Record<string, unknown>, ...path: string[]): string | undefined {
  return readString(readNestedValue(payload, ...path));
}

function readNestedValue(payload: Record<string, unknown>, ...path: string[]): unknown {
  let current: unknown = payload;

  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function normalizeLifecycleAction(objectType: string, payload: Record<string, unknown>): string | undefined {
  const action = typeof payload.action === 'string' ? payload.action : undefined;
  if (objectType === 'pull_request' && action === 'closed' && isMergedPullRequestPayload(payload)) {
    return 'merged';
  }
  return action;
}

function isMergedPullRequestPayload(payload: Record<string, unknown>): boolean {
  return readNestedValue(payload, 'pull_request', 'merged') === true;
}

export * from './config.js';
export * from './adapter.js';
export { materializeRepo } from './lazy.js';
export * from './operations.js';
export * from './path-mapper.js';
export * from './types.js';
export * from './webhook/event-map.js';
export * from './writeback.js';

export * from './resources.js';
export * from './sync-bucketing.js';
