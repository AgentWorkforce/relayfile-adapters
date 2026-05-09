import type { PostgresConfig, FetchContentClient, JsonObject, StorageBridgeEvent } from './types.js';

export async function fetchContent(event: StorageBridgeEvent, config: PostgresConfig, client: FetchContentClient = {}): Promise<Uint8Array | null> {
  if (event.changeType === 'deleted') return null;
  const inline = readInlineContent(event.metadata);
  if (inline) return inline;
  const remote = await client.getObject?.(event, config);
  if (remote === null || remote === undefined) return null;
  return typeof remote === 'string' ? Buffer.from(remote) : Buffer.from(remote);
}

function readInlineContent(metadata: JsonObject): Uint8Array | null {
  const raw = metadata.raw;
  if (isObject(raw)) {
    const contentBase64 = readString(raw, 'contentBase64') ?? readString(raw, 'data') ?? readString(raw, 'bodyBase64');
    if (contentBase64) return Buffer.from(contentBase64, 'base64');
  }
  const postgres = metadata.postgres;
  if (isObject(postgres) && postgres.row_json !== undefined) return Buffer.from(JSON.stringify(postgres.row_json));
  const redis = metadata.redis;
  if (isObject(redis) && redis.value !== undefined) return Buffer.from(typeof redis.value === 'string' ? redis.value : JSON.stringify(redis.value));
  return null;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
