import type {
  StorageBridgeChangeType,
  StorageBridgeEvent as CoreStorageBridgeEvent,
} from '@relayfile/adapter-core';

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };
export type StorageBridgeEvent = Omit<CoreStorageBridgeEvent, 'source' | 'metadata'> & { readonly source: 'azure-blob'; readonly metadata: JsonObject };
export type { StorageBridgeChangeType };

export interface StorageBridgeEventPublisher {
  publish(event: StorageBridgeEvent): Promise<void> | void;
}

export interface AzureBlobConfig {
  workspaceId: string;
  connectionId: string;
  accountId?: string;
  providerConfigKey?: string;
  accessToken?: string;
  refreshToken?: string;
  webhookSecret?: string;
  signingSecret?: string;
  endpointSecret?: string;
  nangoFallbackSyncName?: string;
  apiBaseUrl?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ProviderNotification {
  body: JsonValue;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  rawBody?: string | Uint8Array;
  receivedAt?: string;
}

export interface FetchContentClient {
  getObject?(event: StorageBridgeEvent, config: AzureBlobConfig): Promise<string | Uint8Array | null>;
}

export type WritebackOperation = 'create' | 'update' | 'delete';

export interface ProviderWritebackRequest {
  action: string;
  operation: WritebackOperation;
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  resource: string;
  resourceId: string | null;
  body: JsonObject | null;
  parameters?: readonly unknown[];
}

export interface NangoSyncRecord {
  id?: string;
  model?: string;
  updatedAt?: string;
  deleted?: boolean;
  [key: string]: unknown;
}
