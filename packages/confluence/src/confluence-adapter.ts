import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';
export type {
  DeleteFileInput,
  FileSemantics,
  RelayFileClientLike,
  WriteFileInput,
  WriteFileResult,
} from './types.js';

import {
  computeConfluencePath,
  confluencePagePath,
  confluenceSpacePath,
} from './path-mapper.js';
import {
  CONFLUENCE_PROVIDER_NAME,
  type ConfluenceAdapterConfig,
  type ConfluenceNormalizedEvent,
  type ConfluencePage,
  type ConfluenceSpace,
  type FileSemantics,
  type RelayFileClientLike,
  type WriteFileResult,
} from './types.js';
import { resolveConfluenceWritebackRequest } from './writeback.js';

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

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export class ConfluenceAdapter {
  readonly name = CONFLUENCE_PROVIDER_NAME;
  readonly version = '0.1.0';

  constructor(
    protected readonly client: RelayFileClientLike,
    protected readonly provider: ConnectionProvider,
    readonly config: ConfluenceAdapterConfig = {},
  ) {}

  supportedEvents(): string[] {
    return [
      'page.created',
      'page.updated',
      'page.deleted',
      'space.created',
      'space.updated',
      'space.deleted',
    ];
  }

  computePath(objectType: string, objectId: string, options: { title?: string; spaceId?: string } = {}): string {
    return computeConfluencePath(objectType, objectId, options);
  }

  computeSemantics(objectType: string, objectId: string, payload: Record<string, unknown>): FileSemantics {
    const properties: Record<string, string> = {
      provider: CONFLUENCE_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': objectType,
    };
    const relations: string[] = [];
    const comments: string[] = [];

    addString(properties, 'confluence.status', payload.status);
    addString(properties, 'confluence.title', payload.title);
    addString(properties, 'confluence.type', payload.type);

    if (objectType === 'page') {
      addString(properties, 'confluence.space_id', payload.spaceId);
      addString(properties, 'confluence.parent_id', payload.parentId);
      const spaceId = readString(payload.spaceId);
      if (spaceId) relations.push(confluenceSpacePath(spaceId));
      const parentId = readString(payload.parentId);
      if (parentId) relations.push(confluencePagePath(parentId));
      const bodyText = readStorageBodyText(payload.body);
      if (bodyText) comments.push(stripHtml(bodyText));
    }

    if (objectType === 'space') {
      addString(properties, 'confluence.space_key', payload.key);
      addString(properties, 'confluence.homepage_id', payload.homepageId);
      const homepageId = readString(payload.homepageId);
      if (homepageId) relations.push(confluencePagePath(homepageId));
    }

    return {
      properties,
      ...(relations.length > 0 ? { relations } : {}),
      ...(comments.length > 0 ? { comments } : {}),
    };
  }

  async ingestWebhook(workspaceId: string, event: ConfluenceNormalizedEvent | Record<string, unknown>): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = this.pathForEvent(normalized);

      if (this.isDeleteEvent(normalized)) {
        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path });
          return { filesWritten: 0, filesUpdated: 0, filesDeleted: 1, paths: [path], errors: [] };
        }
      }

      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content: this.renderContent(workspaceId, normalized, this.isDeleteEvent(normalized)),
        contentType: JSON_CONTENT_TYPE,
        semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
      });

      const counts = inferWriteCounts(writeResult, this.isDeleteEvent(normalized));
      return {
        filesWritten: counts.filesWritten,
        filesUpdated: counts.filesUpdated,
        filesDeleted: counts.filesDeleted,
        paths: [path],
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

  writeBack(path: string, content: string) {
    return resolveConfluenceWritebackRequest(path, content);
  }

  materializeSpace(space: ConfluenceSpace): { path: string; payload: Record<string, unknown> } {
    return {
      path: confluenceSpacePath(space.id, space.name ?? space.key),
      payload: {
        provider: CONFLUENCE_PROVIDER_NAME,
        objectType: 'space',
        objectId: space.id,
        payload: space,
      },
    };
  }

  materializePage(page: ConfluencePage): { path: string; payload: Record<string, unknown> } {
    return {
      path: confluencePagePath(page.id, page.title, page.spaceId),
      payload: {
        provider: CONFLUENCE_PROVIDER_NAME,
        objectType: 'page',
        objectId: page.id,
        payload: page,
      },
    };
  }

  protected normalizeEvent(event: ConfluenceNormalizedEvent | Record<string, unknown>): ConfluenceNormalizedEvent {
    if (isConfluenceNormalizedEvent(event)) return event;

    const page = isRecord(event.page) ? event.page : undefined;
    if (page) {
      const id = readString(page.id);
      if (!id) throw new Error('Confluence page event requires page.id');
      return {
        provider: CONFLUENCE_PROVIDER_NAME,
        eventType: readString(event.eventType) ?? readString(event.webhookEvent) ?? 'page.updated',
        objectType: 'page',
        objectId: id,
        payload: { ...page, _webhook: event },
      };
    }

    const space = isRecord(event.space) ? event.space : undefined;
    if (space) {
      const id = readString(space.id);
      if (!id) throw new Error('Confluence space event requires space.id');
      return {
        provider: CONFLUENCE_PROVIDER_NAME,
        eventType: readString(event.eventType) ?? readString(event.webhookEvent) ?? 'space.updated',
        objectType: 'space',
        objectId: id,
        payload: { ...space, _webhook: event },
      };
    }

    throw new Error('Unsupported Confluence event shape');
  }

  protected pathForEvent(event: ConfluenceNormalizedEvent): string {
    const title = readString(event.payload.title) ?? readString(event.payload.name);
    const spaceId = event.objectType === 'page' ? readString(event.payload.spaceId) : undefined;
    return computeConfluencePath(event.objectType, event.objectId, {
      ...(title ? { title } : {}),
      ...(spaceId ? { spaceId } : {}),
    });
  }

  protected isDeleteEvent(event: ConfluenceNormalizedEvent): boolean {
    return event.eventType.toLowerCase().includes('deleted') || event.payload.deleted === true;
  }

  protected renderContent(
    workspaceId: string,
    event: ConfluenceNormalizedEvent,
    deleted: boolean,
  ): string {
    return JSON.stringify(
      {
        provider: CONFLUENCE_PROVIDER_NAME,
        workspaceId,
        objectType: event.objectType,
        objectId: event.objectId,
        deleted,
        payload: event.payload,
        ...(this.config.connectionId ? { connectionId: this.config.connectionId } : {}),
      },
      null,
      2,
    );
  }
}

function inferWriteCounts(
  result: WriteFileResult | void,
  deleted: boolean,
): { filesWritten: number; filesUpdated: number; filesDeleted: number } {
  if (deleted) return { filesWritten: 0, filesUpdated: 0, filesDeleted: 1 };
  if (result?.updated || result?.status === 'updated') {
    return { filesWritten: 0, filesUpdated: 1, filesDeleted: 0 };
  }
  return { filesWritten: 1, filesUpdated: 0, filesDeleted: 0 };
}

function addString(target: Record<string, string>, key: string, value: unknown): void {
  const normalized = readString(value);
  if (normalized) target[key] = normalized;
}

function readStorageBodyText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const storage = value.storage;
  if (!isRecord(storage)) return undefined;
  return readString(storage.value);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConfluenceNormalizedEvent(value: unknown): value is ConfluenceNormalizedEvent {
  return (
    isRecord(value) &&
    value.provider === CONFLUENCE_PROVIDER_NAME &&
    (value.objectType === 'page' || value.objectType === 'space') &&
    typeof value.objectId === 'string' &&
    isRecord(value.payload)
  );
}
