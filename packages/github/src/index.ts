import type { ConnectionProvider } from '@relayfile/sdk';

import { DEFAULT_CONFIG, validateConfig } from './config.js';
import { computeGitHubPath } from './path-mapper.js';
import {
  type FileSemantics,
  type GitHubAdapterConfig,
  type IngestResult,
  IntegrationAdapter as LocalIntegrationAdapter,
  type NormalizedWebhook,
  type SyncOptions,
  type SyncResult,
} from './types.js';
import { extractRepoInfo, EVENT_MAP, type WebhookAdapter } from './webhook/event-map.js';
import { createRouter } from './webhook/router.js';
import { GitHubWritebackHandler } from './writeback.js';

const EMPTY_RESULT: IngestResult = {
  filesWritten: 0,
  filesUpdated: 0,
  filesDeleted: 0,
  paths: [],
  errors: [],
};

export const adapterName = 'github' as const;
export const GITHUB_ADAPTER_NAME = adapterName;

// Lazy-loaded SchemaAdapter to avoid eager import of @relayfile/adapter-core.
// Only callers that invoke createIngestResult with schema-based path routing
// pay the cost; pure path/semantics consumers never trigger this import.
type SchemaAdapterLike = { computeWebhookPath(opts: Record<string, unknown>): string };
let lazySchemaAdapter: Promise<{
  create: (provider: ConnectionProvider, config: Pick<GitHubAdapterConfig, 'connectionId'>) => SchemaAdapterLike;
}> | undefined;

function getSchemaAdapterFactory(): Promise<{
  create: (provider: ConnectionProvider, config: Pick<GitHubAdapterConfig, 'connectionId'>) => SchemaAdapterLike;
}> {
  if (!lazySchemaAdapter) {
    lazySchemaAdapter = import('./adapter.js').then((mod) => ({
      create: (provider: ConnectionProvider, config: Pick<GitHubAdapterConfig, 'connectionId'>) =>
        mod.createGitHubSchemaAdapter(provider, config) as unknown as SchemaAdapterLike,
    }));
  }
  return lazySchemaAdapter;
}

export class GitHubAdapter extends LocalIntegrationAdapter implements WebhookAdapter {
  readonly name = GITHUB_ADAPTER_NAME;
  readonly version = '0.1.0';
  private schemaAdapterInstance: SchemaAdapterLike | undefined;
  private readonly writebackHandler: GitHubWritebackHandler;

  constructor(provider: ConnectionProvider, config: Partial<GitHubAdapterConfig> = {}) {
    const validatedConfig = validateConfig({
      ...DEFAULT_CONFIG,
      ...config,
    });
    super(provider, validatedConfig);
    this.writebackHandler = new GitHubWritebackHandler(provider as never, {
      defaultConnectionId: validatedConfig.connectionId,
      defaultProviderConfigKey: validatedConfig.providerConfigKey,
    });
  }

  private async getSchemaAdapter(): Promise<SchemaAdapterLike> {
    if (!this.schemaAdapterInstance) {
      const factory = await getSchemaAdapterFactory();
      this.schemaAdapterInstance = factory.create(this.provider, this.config);
    }
    return this.schemaAdapterInstance;
  }

  supportedEvents(): string[] {
    return [...this.config.supportedEvents];
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
    return computeGitHubPath(objectType, objectId, {
      owner: this.config.owner,
      repo: this.config.repo,
    });
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

    const action = typeof payload.action === 'string' ? payload.action : undefined;
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
    return this.createIngestResult('pull_request.synchronize', 'pull_request', payload, 'update');
  }

  async closePullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult('pull_request.closed', 'pull_request', payload, 'update');
  }

  async ingestReview(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult(
      'pull_request_review.submitted',
      'review',
      payload,
      'write',
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

  async ingestPushCommits(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult('push', 'commit', payload, 'write');
  }

  async ingestIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult('issues.opened', 'issue', payload, 'write');
  }

  async closeIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult('issues.closed', 'issue', payload, 'update');
  }

  async ingestCheckRun(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.createIngestResult('check_run.completed', 'check_run', payload, 'write');
  }

  async sync(_workspaceId: string, options: SyncOptions = {}): Promise<SyncResult> {
    return {
      filesWritten: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      cursor: options.cursor,
      syncedObjectTypes: [],
      errors: [],
    };
  }

  async writeBack(workspaceId: string, path: string, content: string) {
    return this.writebackHandler.writeBack(workspaceId, path, content);
  }

  private async createIngestResult(
    eventType: string,
    objectType: string,
    payload: Record<string, unknown>,
    mode: 'update' | 'write',
  ): Promise<IngestResult> {
    const objectId = this.resolveObjectId(objectType, payload);
    const path =
      (await this.computeSchemaScopedPath(eventType, objectType, objectId, payload)) ??
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
  ): string {
    const repoInfo = extractRepoInfo(payload);
    const owner = repoInfo.owner || this.config.owner;
    const repo = repoInfo.repo || this.config.repo;

    return computeGitHubPath(objectType, objectId, { owner, repo });
  }

  private async computeSchemaScopedPath(
    eventType: string,
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): Promise<string | undefined> {
    try {
      const schemaAdapter = await this.getSchemaAdapter();
      return schemaAdapter.computeWebhookPath({
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

  private resolveObjectId(objectType: string, payload: Record<string, unknown>): string {
    const candidates = [
      readNumericLike(payload.id),
      readNumericLike(payload.number),
      readNestedNumericLike(payload, 'pull_request', 'number'),
      readNestedNumericLike(payload, 'issue', 'number'),
      readNestedString(payload, 'check_run', 'id'),
      readNestedString(payload, 'pull_request', 'head', 'sha'),
      readString(payload.after),
    ];

    const matched = candidates.find((value) => value !== undefined);
    return matched ?? `${objectType}-unknown`;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

export * from './config.js';
export * from './path-mapper.js';
export * from './types.js';
export * from './operations.js';
export * from './webhook/event-map.js';
export * from './writeback.js';

// NOTE: adapter.ts (SchemaAdapter, mapping spec) is NOT re-exported from
// the barrel to avoid eagerly pulling in @relayfile/adapter-core.
// Consumers who need schema-based path routing should:
//   import { createGitHubSchemaAdapter } from '@relayfile/adapter-github/adapter';
