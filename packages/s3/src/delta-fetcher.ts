import { toObjectRelayfilePath } from './path-mapper.js';
import type { S3Config, JsonObject, StorageBridgeEvent } from './types.js';

export interface DeltaFetchRequest {
  endpoint: string;
  cursor: string | null;
  headers: Record<string, string>;
}

export function buildDeltaFetchRequest(config: S3Config, cursor: string | null = null): DeltaFetchRequest {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.accessToken) headers.authorization = 'Bearer ' + config.accessToken;
  return { endpoint: cursor ?? "sqs:ReceiveMessage", cursor, headers };
}

export function mapDeltaRecord(record: JsonObject, config: S3Config, detectedAt = new Date().toISOString()): StorageBridgeEvent {
  const id = readString(record, 'id') ?? readString(record, 'resourceId') ?? readString(record, 'key') ?? readString(record, 'name') ?? 'unknown';
  const occurredAt = readString(record, 'updatedAt') ?? readString(record, 'modifiedTime') ?? readString(record, 'eventTime') ?? detectedAt;
  const deleted = record.deleted === true || record.removed === true || readString(record, 'changeType') === 'deleted';
  return {
    eventId: "s3" + ':delta:' + id + ':' + occurredAt,
    occurredAt,
    detectedAt,
    source: "s3",
    changeType: deleted ? 'deleted' : 'updated',
    relayfilePath: readString(record, 'relayfilePath') ?? toObjectRelayfilePath({ id, path: readString(record, 'path'), name: readString(record, 'name'), key: readString(record, 'key'), accountId: config.accountId }),
    resourceId: id,
    sizeBytes: typeof record.size === 'number' ? record.size : null,
    fingerprint: readString(record, 'fingerprint') ?? readString(record, 'etag') ?? null,
    metadata: { provider: "s3", providerConfigKey: config.providerConfigKey, delta: record },
    workspaceId: config.workspaceId,
  };
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}
