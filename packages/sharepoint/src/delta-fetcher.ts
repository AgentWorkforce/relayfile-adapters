import { toObjectRelayfilePath } from './path-mapper.js';
import type { SharepointConfig, JsonObject, StorageBridgeEvent } from './types.js';

export interface DeltaFetchRequest {
  endpoint: string;
  cursor: string | null;
  headers: Record<string, string>;
}

export function buildDeltaFetchRequest(config: SharepointConfig, cursor: string | null = null): DeltaFetchRequest {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.accessToken) headers.authorization = 'Bearer ' + config.accessToken;
  return { endpoint: cursor ?? "/v1.0/drives/{driveId}/root/delta", cursor, headers };
}

export function mapDeltaRecord(record: JsonObject, config: SharepointConfig, detectedAt = new Date().toISOString()): StorageBridgeEvent {
  const id = readString(record, 'id') ?? readString(record, 'resourceId') ?? readString(record, 'key') ?? readString(record, 'name') ?? 'unknown';
  const occurredAt = readString(record, 'updatedAt') ?? readString(record, 'modifiedTime') ?? readString(record, 'eventTime') ?? detectedAt;
  const deleted = record.deleted === true || record.removed === true || readString(record, 'changeType') === 'deleted';
  return {
    eventId: "sharepoint" + ':delta:' + id + ':' + occurredAt,
    occurredAt,
    detectedAt,
    source: "sharepoint",
    changeType: deleted ? 'deleted' : 'updated',
    relayfilePath: readString(record, 'relayfilePath') ?? toObjectRelayfilePath({ id, path: readString(record, 'path'), name: readString(record, 'name'), key: readString(record, 'key'), accountId: config.accountId }),
    resourceId: id,
    sizeBytes: typeof record.size === 'number' ? record.size : null,
    fingerprint: readString(record, 'fingerprint') ?? readString(record, 'etag') ?? null,
    metadata: { provider: "sharepoint", providerConfigKey: config.providerConfigKey, delta: record },
    workspaceId: config.workspaceId,
  };
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}
