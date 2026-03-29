import type {
  DocsLlmConfig,
  DocsSourceConfig,
  DocsSyncConfig,
} from "../docs/types.js";

export interface AdapterSource {
  openapi?: string;
  postman?: string;
  samples?: string | string[];
  docs?: DocsSourceConfig;
  sync?: DocsSyncConfig;
  llm?: DocsLlmConfig;
}

export interface AdapterMetadata {
  name: string;
  version: string;
  baseUrl?: string;
  source: AdapterSource;
}

export interface DataProjection {
  extract?: string[];
}

export interface WebhookMapping extends DataProjection {
  path: string;
  objectType?: string;
  objectId?: string;
}

export interface ResourceMapping extends DataProjection {
  endpoint: string;
  path: string;
  iterate?: boolean;
}

export interface WritebackMapping {
  match: string;
  endpoint: string;
  baseUrl?: string;
}

export interface MappingSpec {
  adapter: AdapterMetadata;
  webhooks: Record<string, WebhookMapping>;
  resources?: Record<string, ResourceMapping>;
  writebacks?: Record<string, WritebackMapping>;
}

export type ValidationLevel = "error" | "warning";

export interface ValidationIssue {
  level: ValidationLevel;
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
