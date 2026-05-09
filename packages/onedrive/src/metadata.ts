import type { JsonObject, StorageBridgeEvent } from './types.js';

export interface RelayfileIngestEnvelope {
  provider: string;
  event_type: 'file.created' | 'file.updated' | 'file.deleted';
  path: string;
  delivery_id: string;
  timestamp: string;
  data: { contentBase64: string | null; metadata: JsonObject };
  headers: Record<string, string>;
  semantics: { properties: JsonObject };
}

export function serializeMetadata(event: StorageBridgeEvent): JsonObject {
  return {
    source: event.source,
    resourceId: event.resourceId,
    sizeBytes: event.sizeBytes,
    fingerprint: event.fingerprint,
    relayfilePath: event.relayfilePath,
    providerMetadata: event.metadata,
  };
}

export function toIngestEnvelope(event: StorageBridgeEvent, content: Uint8Array | string | null): RelayfileIngestEnvelope {
  const contentBase64 = content === null ? null : Buffer.from(content).toString('base64');
  return {
    provider: "onedrive",
    event_type: event.changeType === 'deleted' ? 'file.deleted' : event.changeType === 'created' ? 'file.created' : 'file.updated',
    path: event.relayfilePath,
    delivery_id: event.eventId,
    timestamp: event.occurredAt,
    data: { contentBase64, metadata: serializeMetadata(event) },
    headers: { 'x-relayfile-storage-source': event.source },
    semantics: { properties: { source: event.source, resourceId: event.resourceId, fingerprint: event.fingerprint } },
  };
}
