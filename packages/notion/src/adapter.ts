import type { FileSemantics, RelayFileClient, WebhookInput } from '@relayfile/sdk';
import { NotionApiClient } from './client.js';
import { collectWorkspaceFiles, writeWorkspaceFiles } from './bulk-ingest.js';
import { ingestDatabaseArtifacts } from './databases/ingestion.js';
import { discoverContentMetadata } from './discovery/discover.js';
import { computePath as computeMappedPath, notionDiscoveryManifestPath } from './path-mapper.js';
import { ingestPageArtifacts, retrievePage } from './pages/ingestion.js';
import { detectDatabaseChanges, detectStandalonePageChanges } from './sync.js';
import { resolveWritebackRequest } from './writeback.js';
import type { DiscoverOptions, DiscoverResult } from './discovery/types.js';
import type { NotionAdapterConfig, NotionConnectionProvider, NotionVfsFile } from './types.js';

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
  signal?: AbortSignal;
}

export interface SyncResult extends IngestResult {
  nextCursor?: string | null;
}

export abstract class IntegrationAdapter {
  protected readonly client: RelayFileClient;
  protected readonly provider?: NotionConnectionProvider;

  abstract readonly name: string;
  abstract readonly version: string;

  constructor(client: RelayFileClient, provider?: NotionConnectionProvider) {
    this.client = client;
    this.provider = provider;
  }

  abstract ingestWebhook(workspaceId: string, event: WebhookInput): Promise<IngestResult>;
  abstract computePath(objectType: string, objectId: string, context?: Record<string, string>): string;
  abstract computeSemantics(objectType: string, objectId: string, payload: Record<string, unknown>): FileSemantics;

  sync?(workspaceId: string, options?: SyncOptions): Promise<SyncResult>;
  writeBack?(workspaceId: string, path: string, content: string): Promise<void>;
}

export class NotionAdapter extends IntegrationAdapter {
  override readonly name = 'notion';
  override readonly version = '0.1.0';

  readonly api: NotionApiClient;

  constructor(
    client: RelayFileClient,
    provider?: NotionConnectionProvider,
    config: NotionAdapterConfig = {},
  ) {
    super(client, provider);
    this.api = new NotionApiClient(provider, config);
  }

  override computePath(objectType: string, objectId: string, context: Record<string, string> = {}): string {
    switch (objectType) {
      case 'database':
        return computeMappedPath({ objectType: 'database', objectId });
      case 'page':
        return context.databaseId
          ? computeMappedPath({ objectType: 'database_page', objectId, databaseId: context.databaseId })
          : computeMappedPath({ objectType: 'page', objectId });
      case 'page_content':
        return computeMappedPath({ objectType: 'page_content', objectId, databaseId: context.databaseId });
      case 'comment':
        return computeMappedPath({ objectType: 'comment', objectId, databaseId: context.databaseId });
      case 'block':
        if (!context.pageId) {
          throw new Error('Notion block paths require context.pageId');
        }
        return computeMappedPath({
          objectType: 'block',
          objectId,
          databaseId: context.databaseId,
          pageId: context.pageId,
        });
      default:
        throw new Error(`Unsupported Notion object type: ${objectType}`);
    }
  }

  override computeSemantics(objectType: string, objectId: string, payload: Record<string, unknown>): FileSemantics {
    const properties: Record<string, string> = {
      provider: 'notion',
      'provider.object_id': objectId,
      'provider.object_type': objectType,
      'notion.object_id': objectId,
      'notion.object_type': objectType,
    };
    const relations = new Set<string>();

    if (typeof payload.last_edited_time === 'string') {
      properties['notion.last_edited_time'] = payload.last_edited_time;
    }
    if (typeof payload.page_id === 'string') {
      properties['notion.page_id'] = payload.page_id;
      relations.add(payload.page_id);
    }
    if (typeof payload.database_id === 'string') {
      properties['notion.database_id'] = payload.database_id;
      relations.add(payload.database_id);
    }

    return { properties, relations: [...relations] };
  }

  override async ingestWebhook(workspaceId: string, event: WebhookInput): Promise<IngestResult> {
    try {
      const files = await this.filesForWebhook(event);
      await writeWorkspaceFiles(this.client, workspaceId, files);
      return {
        filesWritten: files.length,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: files.map((file) => file.path),
        errors: [],
      };
    } catch (error) {
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: [],
        errors: [{ path: '', error: error instanceof Error ? error.message : String(error) }],
      };
    }
  }

  async ingestDatabase(workspaceId: string, databaseId: string): Promise<IngestResult> {
    const files = await ingestDatabaseArtifacts(this.api, databaseId);
    await writeWorkspaceFiles(this.client, workspaceId, files);
    return summarizeFiles(files);
  }

  async ingestPage(workspaceId: string, pageId: string, databaseId?: string): Promise<IngestResult> {
    const page = await retrievePage(this.api, pageId);
    const files = await ingestPageArtifacts(this.api, page, { databaseId });
    await writeWorkspaceFiles(this.client, workspaceId, files);
    return summarizeFiles(files);
  }

  async bulkIngest(workspaceId: string): Promise<IngestResult> {
    const files = await collectWorkspaceFiles(this.api);
    await writeWorkspaceFiles(this.client, workspaceId, files);
    return summarizeFiles(files);
  }

  async discover(workspaceId: string, options: DiscoverOptions = {}): Promise<DiscoverResult> {
    const concurrency = options.concurrency ?? this.api.config.discoveryConcurrency ?? 8;
    const result = await discoverContentMetadata(this.api, { ...options, concurrency });
    const manifestFile: NotionVfsFile = {
      path: notionDiscoveryManifestPath(),
      contentType: 'application/json; charset=utf-8',
      content: `${JSON.stringify(result.manifest, null, 2)}\n`,
      semantics: {
        properties: {
          provider: 'notion',
          'provider.object_type': 'discovery_manifest',
        },
      },
    };
    const allFiles = [manifestFile, ...result.ingestedFiles];
    await writeWorkspaceFiles(this.client, workspaceId, allFiles);
    return result;
  }

  override async sync(workspaceId: string, options: SyncOptions = {}): Promise<SyncResult> {
    const watermark = options.cursor ?? new Date(0).toISOString();
    const files: NotionVfsFile[] = [];
    let nextCursor = watermark;

    for (const databaseId of this.api.config.databaseIds ?? []) {
      const changes = await detectDatabaseChanges(this.api, databaseId, watermark);
      nextCursor = changes.nextCursor > nextCursor ? changes.nextCursor : nextCursor;
      for (const page of changes.pages) {
        files.push(...(await ingestPageArtifacts(this.api, page, { databaseId })));
      }
    }

    if ((this.api.config.pageIds ?? []).length > 0 || (this.api.config.databaseIds ?? []).length === 0) {
      const changes = await detectStandalonePageChanges(this.api, watermark);
      nextCursor = changes.nextCursor > nextCursor ? changes.nextCursor : nextCursor;
      for (const page of changes.pages) {
        if (this.api.config.pageIds && this.api.config.pageIds.length > 0 && !this.api.config.pageIds.includes(page.id)) {
          continue;
        }
        files.push(...(await ingestPageArtifacts(this.api, page)));
      }
    }

    if (files.length > 0) {
      await writeWorkspaceFiles(this.client, workspaceId, files);
    }

    return {
      ...summarizeFiles(files),
      nextCursor,
    };
  }

  override async writeBack(_workspaceId: string, path: string, content: string): Promise<void> {
    const request = resolveWritebackRequest(path, content);
    await this.api.request(request.method, request.endpoint, {
      apiVersion: request.apiVersion,
      body: request.body,
    });
  }

  private async filesForWebhook(event: WebhookInput): Promise<NotionVfsFile[]> {
    switch (event.objectType) {
      case 'database':
        return ingestDatabaseArtifacts(this.api, event.objectId);
      case 'page': {
        const databaseId = readDatabaseId(event.payload);
        const page = await retrievePage(this.api, event.objectId);
        return ingestPageArtifacts(this.api, page, databaseId ? { databaseId } : {});
      }
      case 'block': {
        const pageId = typeof event.metadata?.pageId === 'string' ? event.metadata.pageId : undefined;
        if (!pageId) {
          throw new Error('Notion block webhook ingestion requires metadata.pageId');
        }
        const page = await retrievePage(this.api, pageId);
        const databaseId = readDatabaseId(page as unknown as Record<string, unknown>);
        return ingestPageArtifacts(this.api, page, databaseId ? { databaseId } : {});
      }
      default:
        throw new Error(`Unsupported Notion webhook object type: ${event.objectType}`);
    }
  }
}

function summarizeFiles(files: NotionVfsFile[]): IngestResult {
  return {
    filesWritten: files.length,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: files.map((file) => file.path),
    errors: [],
  };
}

function readDatabaseId(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.database_id === 'string') {
    return payload.database_id;
  }
  const parent = payload.parent;
  if (isRecord(parent) && typeof parent.type === 'string') {
    const parentRecord = parent;
    if (parentRecord.type === 'database_id' && typeof parentRecord.database_id === 'string') {
      return parentRecord.database_id;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
