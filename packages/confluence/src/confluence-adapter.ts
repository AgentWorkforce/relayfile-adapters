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
  confluencePageByIdAliasPath,
  confluencePageByParentAliasPath,
  confluencePageBySpaceAliasPath,
  confluencePageByStatePath,
  confluencePageByTitleAliasPath,
  confluencePagePath,
  confluenceSpaceByIdAliasPath,
  confluenceSpaceByKeyAliasPath,
  confluenceSpaceByTitleAliasPath,
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
    let normalized: ConfluenceNormalizedEvent;
    let canonicalPath: string;
    let aliasPaths: string[];
    let isDelete: boolean;
    let semantics: FileSemantics;
    let content: string;
    try {
      normalized = this.normalizeEvent(event);
      canonicalPath = this.pathForEvent(normalized);
      aliasPaths = this.aliasPathsForEvent(normalized);
      isDelete = this.isDeleteEvent(normalized);
      semantics = this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload);
      content = this.renderContent(workspaceId, normalized, isDelete);
    } catch (error) {
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: [],
        errors: [{ path: '', error: error instanceof Error ? error.message : String(error) }],
      };
    }

    const targetPaths = [canonicalPath, ...aliasPaths];

    if (isDelete) {
      // Best-effort delete of every known path. Each file is independent
      // (canonical bytes are duplicated to each alias), so a 404/transient
      // error on one path must not skip the others — that's how callers
      // end up with half-deleted records that the next sync writes over.
      return this.fanoutDelete(workspaceId, targetPaths);
    }

    // Reconciliation: if the object was previously written, the prior alias
    // set may differ from the new one (rename, status change, parent move,
    // etc.). Read the stable by-id alias to recover the prior payload, then
    // delete any aliases that no longer apply. The by-id alias is keyed only
    // on objectId so it survives every other field change and is the right
    // anchor for "was this record materialized before?".
    const stalePaths = await this.computeStalePaths(workspaceId, normalized, targetPaths);

    return this.fanoutWrite(workspaceId, targetPaths, content, semantics, isDelete, stalePaths);
  }

  // Per-path try/catch so one failure doesn't abandon the rest of the fan-out.
  // Errors are accumulated and returned in `IngestResult.errors`; callers can
  // re-attempt only the failed paths instead of having to re-derive the full
  // set. We deliberately don't roll back successful writes on a later error —
  // best-effort rollback can cascade failures and cloud's sync is idempotent
  // (the next event for the same id will reconcile via `computeStalePaths`).
  private async fanoutDelete(workspaceId: string, paths: string[]): Promise<IngestResult> {
    let filesDeleted = 0;
    const errors: IngestError[] = [];
    const succeeded: string[] = [];
    if (!this.client.deleteFile) {
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths,
        errors: paths.map((path) => ({ path, error: 'deleteFile not supported by client' })),
      };
    }
    for (const path of paths) {
      try {
        await this.client.deleteFile({ workspaceId, path });
        filesDeleted += 1;
        succeeded.push(path);
      } catch (error) {
        errors.push({ path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { filesWritten: 0, filesUpdated: 0, filesDeleted, paths: succeeded, errors };
  }

  private async fanoutWrite(
    workspaceId: string,
    paths: string[],
    content: string,
    semantics: FileSemantics,
    isDelete: boolean,
    stalePaths: string[],
  ): Promise<IngestResult> {
    let filesWritten = 0;
    let filesUpdated = 0;
    let filesDeleted = 0;
    const errors: IngestError[] = [];
    const succeeded: string[] = [];

    // Reconciliation deletes first. If a stale path delete fails we log the
    // error and continue — stale aliases are non-fatal (functional state is
    // still correct, just bloated), and we want the canonical write to
    // proceed so the new content is visible.
    if (stalePaths.length > 0 && this.client.deleteFile) {
      for (const path of stalePaths) {
        try {
          await this.client.deleteFile({ workspaceId, path });
          filesDeleted += 1;
          succeeded.push(path);
        } catch (error) {
          errors.push({ path, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    for (const path of paths) {
      try {
        const result = await this.client.writeFile({
          workspaceId,
          path,
          content,
          contentType: JSON_CONTENT_TYPE,
          semantics,
        });
        const counts = inferWriteCounts(result, isDelete);
        filesWritten += counts.filesWritten;
        filesUpdated += counts.filesUpdated;
        filesDeleted += counts.filesDeleted;
        succeeded.push(path);
      } catch (error) {
        errors.push({ path, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return { filesWritten, filesUpdated, filesDeleted, paths: succeeded, errors };
  }

  // Compute the set of alias/canonical paths that were emitted on a prior
  // write but no longer apply after this update. Requires `readFile` on the
  // client; when absent (legacy clients), returns an empty array and the
  // adapter degrades to "no reconciliation" (matches pre-#69 behavior).
  // Read failures (404, network, parse) are non-fatal — we'd rather leave
  // stale aliases behind than block the canonical write on a stat call.
  private async computeStalePaths(
    workspaceId: string,
    normalized: ConfluenceNormalizedEvent,
    newPaths: string[],
  ): Promise<string[]> {
    if (typeof this.client.readFile !== 'function') return [];

    const byIdPath = normalized.objectType === 'page'
      ? confluencePageByIdAliasPath(normalized.objectId)
      : normalized.objectType === 'space'
        ? confluenceSpaceByIdAliasPath(normalized.objectId)
        : null;
    if (!byIdPath) return [];

    let priorPayload: Record<string, unknown> | null = null;
    try {
      const prior = await this.client.readFile({ workspaceId, path: byIdPath });
      if (!prior || typeof prior.content !== 'string') return [];
      const wrapper = JSON.parse(prior.content) as unknown;
      if (!isRecord(wrapper) || !isRecord(wrapper.payload)) return [];
      priorPayload = wrapper.payload;
    } catch {
      return [];
    }

    const priorEvent: ConfluenceNormalizedEvent = {
      provider: CONFLUENCE_PROVIDER_NAME,
      eventType: `${normalized.objectType}.reconcile`,
      objectType: normalized.objectType,
      objectId: normalized.objectId,
      payload: priorPayload,
    };
    const priorCanonical = this.pathForEvent(priorEvent);
    const priorAliases = this.aliasPathsForEvent(priorEvent);
    const priorPaths = new Set([priorCanonical, ...priorAliases]);

    const currentPaths = new Set(newPaths);
    const stale: string[] = [];
    for (const p of priorPaths) {
      if (!currentPaths.has(p)) stale.push(p);
    }
    return stale;
  }

  /**
   * Returns the by-* alias paths that should be written alongside the
   * canonical record for an event. Aliases store the same bytes as the
   * canonical path so any one of them resolves to the same JSON. Callers
   * doing bulk materialization (e.g. `materializePageFiles`) reuse this so
   * write-path and read-path stay symmetrical.
   *
   * Collision handling: `by-title` uses the canonical slugifier; when two
   * pages share a title in the same scope, the second write wins (Confluence
   * agents almost never lean on by-title for round-trip, so we keep the
   * primary alias collision-free instead of forcing every reader to know the
   * hash suffix). Callers that need the disambiguated form can compute it
   * explicitly via `confluencePageByTitleAliasPath(title, id, true)`.
   */
  aliasPathsForEvent(event: ConfluenceNormalizedEvent): string[] {
    const paths: string[] = [];
    const id = event.objectId;

    if (event.objectType === 'page') {
      paths.push(confluencePageByIdAliasPath(id));
      const title = readString(event.payload.title);
      if (title && slugifies(title)) {
        paths.push(confluencePageByTitleAliasPath(title, id));
      }
      const status = readString(event.payload.status);
      if (status) {
        paths.push(confluencePageByStatePath(status, id));
      }
      const spaceId = readString(event.payload.spaceId);
      if (spaceId) {
        paths.push(confluencePageBySpaceAliasPath(spaceId, id));
      }
      const parentId = readString(event.payload.parentId);
      if (parentId) {
        paths.push(confluencePageByParentAliasPath(parentId, id));
      }
      return paths;
    }

    if (event.objectType === 'space') {
      paths.push(confluenceSpaceByIdAliasPath(id));
      const name = readString(event.payload.name) ?? readString(event.payload.title);
      if (name && slugifies(name)) {
        paths.push(confluenceSpaceByTitleAliasPath(name, id));
      }
      const key = readString(event.payload.key);
      if (key) {
        paths.push(confluenceSpaceByKeyAliasPath(key));
      }
      return paths;
    }

    return paths;
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

  /**
   * Materialize a page into the canonical path plus its by-* alias paths.
   * Callers performing bulk sync (cloud full-resync) should iterate the
   * returned `paths` and write the same `payload` bytes to each — that's
   * how the runtime contract treats aliases (duplicated bytes, single
   * source of truth at the canonical path).
   */
  materializePageFiles(page: ConfluencePage): { paths: string[]; payload: Record<string, unknown> } {
    const canonical = this.materializePage(page);
    const aliases = this.aliasPathsForEvent({
      provider: CONFLUENCE_PROVIDER_NAME,
      eventType: 'page.synced',
      objectType: 'page',
      objectId: page.id,
      payload: page as unknown as Record<string, unknown>,
    });
    return { paths: [canonical.path, ...aliases], payload: canonical.payload };
  }

  /**
   * Materialize a space into the canonical path plus its by-* alias paths.
   * See {@link materializePageFiles} for the bulk-sync contract.
   */
  materializeSpaceFiles(space: ConfluenceSpace): { paths: string[]; payload: Record<string, unknown> } {
    const canonical = this.materializeSpace(space);
    const aliases = this.aliasPathsForEvent({
      provider: CONFLUENCE_PROVIDER_NAME,
      eventType: 'space.synced',
      objectType: 'space',
      objectId: space.id,
      payload: space as unknown as Record<string, unknown>,
    });
    return { paths: [canonical.path, ...aliases], payload: canonical.payload };
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

/**
 * Returns true when the input contains enough alphanumeric content for the
 * shared alias slugifier to produce a non-fallback result. We use this to
 * skip emitting `by-title/untitled.json` aliases that would collide for
 * every emoji-only / punctuation-only title — the by-id alias still resolves
 * those records. Mirrors the NFKD + combining-mark strip from `alias-slug.ts`.
 */
function slugifies(value: string): boolean {
  const normalized = value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return /[a-zA-Z0-9]/u.test(normalized);
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
