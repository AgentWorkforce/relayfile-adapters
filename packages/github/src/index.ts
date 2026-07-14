import type { SchemaAdapter } from '@relayfile/adapter-core';
import { withProxyRetry } from '@relayfile/adapter-core/http';
import type { ConnectionProvider } from '@relayfile/sdk';

import { createGitHubSchemaAdapter } from './adapter.js';
import { GITHUB_API_BASE_URL } from './config.js';
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
import { fetchPullRequestGateMetadata } from './pr/parser.js';

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

const GITHUB_PAGE_SIZE = 100;
const GITHUB_STATUS_PULL_REQUEST_MAX_PAGES = 100;

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
      ...(config.resolveAuthorship ? { resolveAuthorship: config.resolveAuthorship } : {}),
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
    const child = await this.createIngestResult(
      action ? `pull_request_review.${action}` : 'pull_request_review.submitted',
      'review',
      payload,
      action === 'submitted' || !action ? 'write' : 'update',
    );
    return this.reconcileGateParents(payload, child);
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
    const child = await this.createIngestResult('check_run.completed', 'check_run', payload, 'write');
    return this.reconcileGateParents(payload, child);
  }

  async ingestCommitStatus(payload: Record<string, unknown>): Promise<IngestResult> {
    try {
      const targets = await this.resolveStatusPullRequestTargets(payload);
      return this.reconcileGateParents(payload, EMPTY_RESULT, targets);
    } catch (error) {
      return {
        ...EMPTY_RESULT,
        errors: [{
          path: this.computeScopedPath('commit', readString(payload.sha) ?? 'unknown', payload),
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
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

  private async reconcileGateParents(
    payload: Record<string, unknown>,
    child: IngestResult,
    explicitTargets?: Array<{ owner: string; repo: string; number: number }>,
  ): Promise<IngestResult> {
    const vfs = this.tryGetVfsProvider();
    const targets = explicitTargets ?? this.resolvePullRequestTargets(payload);
    if (!vfs || targets.length === 0) return child;

    const parentResults = await Promise.all(targets
      .filter((target) => shouldWriteWebhookForRepo(this.config, target.owner, target.repo))
      .map(async (target) => {
        try {
          // Invalidate any previously-ready snapshot before the network refresh.
          // If GitHub is unavailable, Factory sees this fail-closed state rather
          // than merging against stale successful checks or approvals.
          return await reconcilePullRequestGateRecord(
            this.provider as unknown as GitHubRequestProvider,
            target.owner,
            target.repo,
            target.number,
            vfs,
            this.config.connectionId,
          );
        } catch (error) {
          return {
            ...EMPTY_RESULT,
            errors: [{
              path: githubPullRequestPath(target.owner, target.repo, target.number),
              error: error instanceof Error ? error.message : String(error),
            }],
          };
        }
      }));
    return mergeIngestResults(child, ...parentResults);
  }

  private resolvePullRequestTargets(
    payload: Record<string, unknown>,
  ): Array<{ owner: string; repo: string; number: number }> {
    const repoInfo = extractRepoInfo(payload);
    const owner = repoInfo.owner || this.config.owner;
    const repo = repoInfo.repo || this.config.repo;
    if (!owner || !repo) return [];
    const numbers = new Set<number>();
    if (repoInfo.number && Number.isInteger(repoInfo.number)) numbers.add(repoInfo.number);
    const checkRun = asRecord(payload.check_run);
    if (Array.isArray(checkRun?.pull_requests)) {
      for (const value of checkRun.pull_requests) {
        const number = readNumber(asRecord(value), 'number');
        if (number && Number.isInteger(number)) numbers.add(number);
      }
    }
    return [...numbers].map((number) => ({ owner, repo, number }));
  }

  private async resolveStatusPullRequestTargets(
    payload: Record<string, unknown>,
  ): Promise<Array<{ owner: string; repo: string; number: number }>> {
    const repoInfo = extractRepoInfo(payload);
    const owner = repoInfo.owner || this.config.owner;
    const repo = repoInfo.repo || this.config.repo;
    const sha = readString(payload.sha);
    const connectionId = this.config.connectionId;
    const missing = [
      !owner ? 'owner' : undefined,
      !repo ? 'repo' : undefined,
      !sha ? 'sha' : undefined,
      !connectionId ? 'connectionId' : undefined,
    ].filter((field): field is string => Boolean(field));
    if (missing.length > 0) {
      throw new Error(`Cannot resolve GitHub status pull request targets: missing ${missing.join(', ')}`);
    }
    if (!owner || !repo || !sha || !connectionId) {
      throw new Error('Cannot resolve GitHub status pull request targets: invalid configuration');
    }
    try {
      const targets = new Map<number, { owner: string; repo: string; number: number }>();
      for (let page = 1; page <= GITHUB_STATUS_PULL_REQUEST_MAX_PAGES; page += 1) {
        const response = await withProxyRetry(this.provider as unknown as GitHubRequestProvider).proxy({
          method: 'GET',
          baseUrl: GITHUB_API_BASE_URL,
          endpoint: `/repos/${owner}/${repo}/commits/${sha}/pulls`,
          connectionId,
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          query: {
            page: String(page),
            per_page: String(GITHUB_PAGE_SIZE),
          },
        });
        if (response.status >= 400) {
          throw new Error(`GitHub pull request lookup for status ${sha} failed with HTTP ${response.status}`);
        }
        if (!Array.isArray(response.data)) {
          throw new Error(`GitHub pull request lookup for status ${sha} returned a malformed payload`);
        }
        for (const value of response.data) {
          const number = readNumber(asRecord(value), 'number');
          if (number && Number.isInteger(number)) targets.set(number, { owner, repo, number });
        }
        if (!hasNextPage(response.headers) && response.data.length < GITHUB_PAGE_SIZE) break;
        if (page === GITHUB_STATUS_PULL_REQUEST_MAX_PAGES) {
          throw new Error(
            `GitHub pull request lookup for status ${sha} exceeded ${GITHUB_STATUS_PULL_REQUEST_MAX_PAGES} pages`,
          );
        }
      }
      return [...targets.values()];
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
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

function hasNextPage(headers: Record<string, string>): boolean {
  return Object.entries(headers).some(
    ([name, value]) => name.toLowerCase() === 'link' && value.includes('rel="next"'),
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function reconcilePullRequestGateRecord(
  provider: GitHubRequestProvider,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
  connectionId?: string,
): Promise<IngestResult> {
  if (!connectionId?.trim()) {
    throw new Error(`Missing GitHub connection id while refreshing ${owner}/${repo}#${number} gate metadata`);
  }
  const aliasPath = githubByIdAliasPath(owner, repo, 'pulls', number);
  const raw = await readVfsText(vfs, aliasPath);
  if (!raw) {
    throw new Error(`Cannot refresh GitHub gate metadata before ${aliasPath} is materialized`);
  }
  const record = asRecord(JSON.parse(raw));
  if (!record) throw new Error(`GitHub pull request record at ${aliasPath} is malformed`);
  const wrappedPayload = asRecord(record.payload);
  const current = wrappedPayload ?? record;
  const headSha = readString(current.headRefOid) ?? readNestedString(current, 'head', 'sha');
  if (!headSha) throw new Error(`GitHub pull request record at ${aliasPath} is missing headRefOid`);
  const baseRef = readNestedString(current, 'base', 'ref');
  const title = readString(current.title);
  const canonicalPath = githubPullRequestPath(owner, repo, number, title);

  // Fail closed before any provider request, then restore only the refreshed
  // gate fields. The rest of the mounted PR snapshot remains byte-for-byte
  // equivalent at the value level and no files, diff, indexes, or layout are
  // re-ingested for review/check/status events.
  await markPullRequestGatePending(vfs, owner, repo, number);
  const gate = await fetchPullRequestGateMetadata(
    provider,
    owner,
    repo,
    number,
    headSha,
    connectionId.trim(),
    undefined,
    { baseRef },
  );
  if (!gate.complete) {
    throw new Error(`GitHub gate refresh was incomplete for ${owner}/${repo}#${number}`);
  }
  const refreshedPayload = {
    ...current,
    reviewDecision: gate.reviewDecision,
    statusCheckRollup: gate.statusCheckRollup,
  };
  const refreshed = JSON.stringify(
    wrappedPayload ? { ...record, payload: refreshedPayload } : refreshedPayload,
    null,
    2,
  );
  await writeVfsText(vfs, aliasPath, refreshed);
  await writeVfsText(vfs, canonicalPath, refreshed);
  return {
    filesWritten: 0,
    filesUpdated: 2,
    filesDeleted: 0,
    paths: [aliasPath, canonicalPath],
    errors: [],
  };
}

async function markPullRequestGatePending(
  vfs: VfsLike,
  owner: string,
  repo: string,
  number: number,
): Promise<void> {
  const aliasPath = githubByIdAliasPath(owner, repo, 'pulls', number);
  const raw = await readVfsText(vfs, aliasPath);
  if (!raw) return;
  const record = asRecord(JSON.parse(raw));
  if (!record) return;
  const wrappedPayload = asRecord(record.payload);
  const current = wrappedPayload ?? record;
  const pendingPayload = {
    ...current,
    mergeable: 'UNKNOWN',
    mergeStateStatus: 'UNKNOWN',
    reviewDecision: 'REVIEW_REQUIRED',
    statusCheckRollup: [
      { name: 'relayfile/gate-refresh', status: 'PENDING', conclusion: null, detailsUrl: null },
    ],
  };
  const pending = JSON.stringify(
    wrappedPayload ? { ...record, payload: pendingPayload } : pendingPayload,
    null,
    2,
  );
  const title = readString(current.title);
  await writeVfsText(vfs, aliasPath, pending);
  await writeVfsText(vfs, githubPullRequestPath(owner, repo, number, title), pending);
}

async function readVfsText(vfs: VfsLike, path: string): Promise<string | undefined> {
  const reader = vfs.readFile ?? vfs.read ?? vfs.get;
  if (!reader) return undefined;
  const value = await reader.call(vfs, path);
  return typeof value === 'string' ? value : undefined;
}

async function writeVfsText(vfs: VfsLike, path: string, content: string): Promise<void> {
  const writer = vfs.writeFile ?? vfs.write ?? vfs.put ?? vfs.set ?? vfs.upsert;
  if (!writer) throw new Error(`GitHub VFS cannot write fail-closed gate state at ${path}`);
  await writer.call(vfs, path, content);
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
