import type { BulkWriteFile, ConnectionProvider } from '@relayfile/sdk';

export type { BulkWriteFile, ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

export const CONFLUENCE_PROVIDER_NAME = 'confluence';
export const CONFLUENCE_PATH_ROOT = '/confluence';
export const CONFLUENCE_API_PAGES_ROUTE = '/wiki/api/v2/pages';
export const CONFLUENCE_DEFAULT_PAGE_SIZE = 100;

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
export type JsonArray = JsonValue[];

export interface ConfluenceAdapterConfig {
  apiBaseUrl?: string;
  cloudId?: string;
  connectionId?: string;
  providerConfigKey?: string;
  pageSize?: number;
}

export interface ConfluenceSpace {
  id: string;
  key?: string;
  name?: string;
  type?: string;
  status?: string;
  authorId?: string;
  createdAt?: string;
  homepageId?: string;
  description?: string | JsonValue | null;
  [key: string]: unknown;
}

export interface ConfluencePageVersion {
  createdAt?: string;
  message?: string;
  number?: number;
  minorEdit?: boolean;
  authorId?: string;
  [key: string]: unknown;
}

export interface ConfluencePageBody {
  storage?: { value?: string; representation?: string; [key: string]: unknown };
  atlas_doc_format?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ConfluencePage {
  id: string;
  title?: string;
  type?: string;
  status?: string;
  authorId?: string;
  createdAt?: string;
  spaceId?: string;
  parentId?: string;
  parentType?: string;
  position?: number;
  version?: ConfluencePageVersion;
  body?: ConfluencePageBody;
  [key: string]: unknown;
}

export interface ConfluenceReadRequest {
  action: 'get_page' | 'get_space' | 'list_pages' | 'list_space_pages' | 'list_spaces';
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export interface ConfluenceWritebackRequest {
  action: 'create_page' | 'delete_page' | 'update_page';
  method: 'DELETE' | 'POST' | 'PUT';
  endpoint: string;
  body?: Record<string, unknown>;
}

export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
}

export interface WriteFileInput {
  workspaceId: string;
  path: string;
  content: string;
  contentType?: string;
  semantics?: FileSemantics;
}

export interface WriteFileResult {
  created?: boolean;
  updated?: boolean;
  status?: 'created' | 'updated' | 'queued' | 'pending';
}

export interface DeleteFileInput {
  workspaceId: string;
  path: string;
}

export interface ReadFileInput {
  workspaceId: string;
  path: string;
}

export interface ReadFileResult {
  content: string;
}

export interface RelayFileClientLike {
  writeFile(input: WriteFileInput): Promise<WriteFileResult | void>;
  deleteFile?(input: DeleteFileInput): Promise<void> | void;
  // Optional: when present, `ingestWebhook` reconciles stale aliases on
  // updates by reading the stable by-id alias (keyed only on the object id,
  // so it survives renames) and diffing the prior alias set against the
  // newly-computed one. Implementations that don't expose readFile keep
  // working — reconciliation simply degrades to "no-op", which matches the
  // previous behavior where stale aliases accumulated.
  readFile?(input: ReadFileInput): Promise<ReadFileResult | null | undefined>;
}

export interface ConfluenceNormalizedEvent {
  provider: string;
  connectionId?: string;
  providerConfigKey?: string;
  eventType: string;
  objectType: 'page' | 'space';
  objectId: string;
  payload: Record<string, unknown>;
}
