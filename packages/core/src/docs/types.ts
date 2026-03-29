export interface DocsSelectorConfig {
  content?: string;
  codeBlock?: string;
  pagination?: string;
}

export interface DocsSourceConfig {
  url: string;
  crawlPaths?: string[];
  selectors?: DocsSelectorConfig;
  maxPages?: number;
  rateLimitMs?: number;
}

export type DocsSyncTrigger =
  | "changelog-rss"
  | "content-hash"
  | "github-release";

export interface DocsSyncConfig {
  trigger: DocsSyncTrigger;
  feedUrl?: string;
  repo?: string;
  stateFile?: string;
}

export interface DocsLlmConfig {
  provider?: "anthropic" | "custom" | "openai";
  endpoint?: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  concurrency?: number;
  chunkSize?: number;
  headers?: Record<string, string>;
}

export interface DocPage {
  url: string;
  title: string;
  content: string;
}

export interface ExtractedParameter {
  name: string;
  in: "body" | "header" | "path" | "query";
  type: string;
  required: boolean;
  description?: string;
}

export interface ExtractedEndpoint {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters: ExtractedParameter[];
  requestShape?: Record<string, unknown>;
  responseShape?: Record<string, unknown>;
}

export interface ExtractedWebhook {
  event: string;
  summary?: string;
  payloadShape?: Record<string, unknown>;
  deliveryFormat?: string;
  idField?: string;
}

export interface ExtractedAuth {
  type: "api-key" | "basic" | "bearer" | "none" | "oauth2";
  headerName?: string;
  location?: "cookie" | "header" | "query";
  name?: string;
}

export interface ExtractedError {
  status?: string;
  description?: string;
  shape?: Record<string, unknown>;
}

export interface ExtractedAPI {
  title?: string;
  description?: string;
  endpoints: ExtractedEndpoint[];
  webhooks: ExtractedWebhook[];
  auth?: ExtractedAuth;
  rateLimits?: string[];
  errors?: ExtractedError[];
}

export interface Change {
  type: "added" | "deprecated" | "modified" | "preserved";
  path: string;
  detail: string;
}

export interface UpdateResult {
  changed: boolean;
  changes: Change[];
  spec: string;
  mapping?: string;
  warnings: string[];
}

export interface ChangeDetectionResult {
  changed: boolean;
  reason?: string;
  previousHash?: string;
  currentHash?: string;
  stateKey: string;
}

export interface DocsToSpecResult {
  pages: DocPage[];
  extracted: ExtractedAPI;
  spec: string;
  mapping: string;
}

export interface DocsSpecMetadata {
  url: string;
  crawlPaths?: string[];
  selectors?: DocsSelectorConfig;
  sync?: Omit<DocsSyncConfig, "stateFile">;
  llm?: Omit<DocsLlmConfig, "apiKey" | "headers">;
}
