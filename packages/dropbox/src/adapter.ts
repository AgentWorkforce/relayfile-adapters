import { DROPBOX_NANGO_FALLBACK_SYNC, validateConfig } from './config.js';
import { DropboxBridge } from './bridge.js';
import { fetchContent } from './fetch-content.js';
import { toObjectRelayfilePath } from './path-mapper.js';
import { resources } from './resources.js';
import { resolveWritebackRequest } from './writeback.js';
import type { DropboxConfig, FetchContentClient, NangoSyncRecord, ProviderNotification, StorageBridgeEvent, StorageBridgeEventPublisher, WritebackOperation } from './types.js';

export class DropboxAdapter {
  readonly slug = "dropbox";
  readonly source = "dropbox";
  readonly resources = resources;
  readonly nangoFallbackSyncName = DROPBOX_NANGO_FALLBACK_SYNC;
  readonly config: DropboxConfig;
  private readonly bridge?: DropboxBridge;
  private readonly contentClient: FetchContentClient;

  constructor(config: DropboxConfig, options: { publisher?: StorageBridgeEventPublisher; contentClient?: FetchContentClient } = {}) {
    this.config = validateConfig(config);
    this.contentClient = options.contentClient ?? {};
    if (options.publisher) this.bridge = new DropboxBridge(this.config, options.publisher);
  }

  async handleNotification(notification: ProviderNotification): Promise<StorageBridgeEvent[]> {
    if (!this.bridge) throw new Error('DropboxAdapter requires a publisher to handle notifications');
    return this.bridge.handleNotification(notification);
  }

  fetchContent(event: StorageBridgeEvent): Promise<Uint8Array | null> {
    return fetchContent(event, this.config, this.contentClient);
  }

  resolveWriteback(path: string, content: string, operation?: WritebackOperation) {
    return resolveWritebackRequest(path, content, operation);
  }

  supportedEvents(): string[] {
    // Dropbox user webhooks are account-level invalidation signals.
    // We expose the normalized trigger used by cloud routing.
    return ['file.changed'];
  }

  mapNangoSyncRecord(record: NangoSyncRecord): StorageBridgeEvent {
    if (!this.nangoFallbackSyncName) throw new Error('Dropbox does not declare a Nango scheduled-sync fallback');
    const id = String(record.id ?? record.resourceId ?? record.path ?? 'unknown');
    const occurredAt = typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString();
    return {
      eventId: "dropbox" + ':nango:' + id + ':' + occurredAt,
      occurredAt,
      detectedAt: new Date().toISOString(),
      source: "dropbox",
      changeType: record.deleted === true ? 'deleted' : 'updated',
      relayfilePath: toObjectRelayfilePath({ id, path: typeof record.path === 'string' ? record.path : undefined, name: typeof record.name === 'string' ? record.name : undefined }),
      resourceId: id,
      sizeBytes: typeof record.size === 'number' ? record.size : null,
      fingerprint: typeof record.etag === 'string' ? record.etag : null,
      metadata: { provider: "dropbox", providerConfigKey: this.config.providerConfigKey, nango: record as never },
      workspaceId: this.config.workspaceId,
    };
  }
}
