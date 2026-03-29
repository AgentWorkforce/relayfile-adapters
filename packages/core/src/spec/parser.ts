import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import type {
  DocsLlmConfig,
  DocsSourceConfig,
  DocsSyncConfig,
} from "../docs/types.js";
import type { ServiceSpec } from "../ingest/types.js";
import { extractTemplateFields, pathExists } from "./template.js";
import type {
  MappingSpec,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

export async function loadMappingSpec(
  location: string,
  cwd = process.cwd()
): Promise<MappingSpec> {
  const text = await readFile(resolve(cwd, location), "utf8");
  return parseMappingSpecText(text, location);
}

export function parseMappingSpecText(
  text: string,
  location = "<inline>"
): MappingSpec {
  const parsed = parseMappingText(text, location);
  return validateParsedMapping(parsed);
}

export function validateMappingSpec(
  spec: MappingSpec,
  serviceSpec?: ServiceSpec
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!spec.adapter.name.trim()) {
    issues.push(error("adapter.name", "Adapter name is required"));
  }

  if (!hasSource(spec)) {
    issues.push(
      error(
        "adapter.source",
        "One of adapter.source.openapi, adapter.source.postman, adapter.source.samples, or adapter.source.docs is required"
      )
    );
  }

  if (spec.adapter.source.docs && !spec.adapter.source.docs.url.trim()) {
    issues.push(error("adapter.source.docs.url", "Docs source URL is required"));
  }

  for (const [eventName, mapping] of Object.entries(spec.webhooks)) {
    validateEndpointFormat(
      issues,
      `webhooks.${eventName}.path`,
      mapping.path,
      false
    );

    if (serviceSpec) {
      const schema =
        serviceSpec.webhookSchemas[eventName] ??
        serviceSpec.webhookSchemas[eventName.split(".")[0] ?? ""];
      if (schema) {
        validateTemplateFields(
          issues,
          `webhooks.${eventName}.path`,
          mapping.path,
          schema,
          serviceSpec
        );
        validateExtractFields(
          issues,
          `webhooks.${eventName}.extract`,
          mapping.extract,
          schema,
          serviceSpec
        );
      } else {
        issues.push(
          warning(
            `webhooks.${eventName}`,
            `No webhook schema found for event "${eventName}" in the service spec`
          )
        );
      }
    }
  }

  for (const [resourceName, mapping] of Object.entries(spec.resources ?? {})) {
    validateEndpointFormat(
      issues,
      `resources.${resourceName}.endpoint`,
      mapping.endpoint,
      true
    );
    validateEndpointFormat(
      issues,
      `resources.${resourceName}.path`,
      mapping.path,
      false
    );

    if (serviceSpec) {
      const endpoint = serviceSpec.endpoints.find((item) => item.key === mapping.endpoint);
      if (!endpoint) {
        issues.push(
          error(
            `resources.${resourceName}.endpoint`,
            `Endpoint "${mapping.endpoint}" was not found in the service spec`
          )
        );
      } else {
        const validParams = new Set(endpoint.parameters.map((parameter) => parameter.name));
        for (const field of extractTemplateFields(mapping.path)) {
          if (!validParams.has(field) && !schemaPathExists(endpoint.responseSchema, field, serviceSpec)) {
            issues.push(
              warning(
                `resources.${resourceName}.path`,
                `Field "${field}" was not found in endpoint params or response schema`
              )
            );
          }
        }
      }
    }
  }

  for (const [writebackName, mapping] of Object.entries(spec.writebacks ?? {})) {
    validateEndpointFormat(
      issues,
      `writebacks.${writebackName}.endpoint`,
      mapping.endpoint,
      true
    );

    if (serviceSpec && !serviceSpec.endpoints.find((item) => item.key === mapping.endpoint)) {
      issues.push(
        warning(
          `writebacks.${writebackName}.endpoint`,
          `Endpoint "${mapping.endpoint}" was not found in the service spec`
        )
      );
    }
  }

  return {
    valid: issues.every((issue) => issue.level !== "error"),
    issues,
  };
}

function validateParsedMapping(value: unknown): MappingSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Mapping spec must be an object");
  }

  const spec = value as Record<string, unknown>;
  const adapter = asRecord(spec.adapter, "adapter");
  const source = asRecord(adapter.source, "adapter.source");
  const webhooks = asRecord(spec.webhooks, "webhooks");

  return {
    adapter: {
      name: readRequiredString(adapter.name, "adapter.name"),
      version: readRequiredString(adapter.version, "adapter.version"),
      baseUrl: readOptionalString(adapter.baseUrl),
      source: {
        openapi: readOptionalString(source.openapi),
        postman: readOptionalString(source.postman),
        samples: readOptionalStringArrayOrString(source.samples),
        docs: parseDocsSource(source.docs),
        sync: parseDocsSync(source.sync),
        llm: parseDocsLlm(source.llm),
      },
    },
    webhooks: parseMappings(webhooks, parseWebhookMapping),
    resources: spec.resources
      ? parseMappings(asRecord(spec.resources, "resources"), parseResourceMapping)
      : undefined,
    writebacks: spec.writebacks
      ? parseMappings(asRecord(spec.writebacks, "writebacks"), parseWritebackMapping)
      : undefined,
  };
}

function parseMappings<TValue>(
  value: Record<string, unknown>,
  reader: (input: Record<string, unknown>) => TValue
): Record<string, TValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, reader(asRecord(item, key))])
  );
}

function parseWebhookMapping(input: Record<string, unknown>) {
  return {
    path: readRequiredString(input.path, "path"),
    objectType: readOptionalString(input.objectType),
    objectId: readOptionalString(input.objectId),
    extract: readOptionalStringArray(input.extract),
  };
}

function parseResourceMapping(input: Record<string, unknown>) {
  return {
    endpoint: readRequiredString(input.endpoint, "endpoint"),
    path: readRequiredString(input.path, "path"),
    iterate: input.iterate === true,
    extract: readOptionalStringArray(input.extract),
  };
}

function parseWritebackMapping(input: Record<string, unknown>) {
  return {
    match: readRequiredString(input.match, "match"),
    endpoint: readRequiredString(input.endpoint, "endpoint"),
    baseUrl: readOptionalString(input.baseUrl),
  };
}

function parseDocsSource(value: unknown): DocsSourceConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const docs = asRecord(value, "adapter.source.docs");
  const selectors =
    docs.selectors === undefined
      ? undefined
      : asRecord(docs.selectors, "adapter.source.docs.selectors");

  return {
    url: readRequiredString(docs.url, "adapter.source.docs.url"),
    crawlPaths: readOptionalStringArray(
      docs.crawlPaths ?? docs.crawl_paths
    ),
    selectors: selectors
      ? {
          content: readOptionalString(selectors.content),
          codeBlock: readOptionalString(
            selectors.codeBlock ?? selectors.code_block
          ),
          pagination: readOptionalString(selectors.pagination),
        }
      : undefined,
    maxPages: readOptionalNumber(docs.maxPages ?? docs.max_pages),
    rateLimitMs: readOptionalNumber(docs.rateLimitMs ?? docs.rate_limit_ms),
  };
}

function parseDocsSync(value: unknown): DocsSyncConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const sync = asRecord(value, "adapter.source.sync");
  const trigger = readRequiredString(sync.trigger, "adapter.source.sync.trigger");
  if (
    trigger !== "content-hash" &&
    trigger !== "changelog-rss" &&
    trigger !== "github-release"
  ) {
    throw new Error(
      "adapter.source.sync.trigger must be one of content-hash, changelog-rss, github-release"
    );
  }

  return {
    trigger,
    feedUrl: readOptionalString(sync.feedUrl ?? sync.feed_url),
    repo: readOptionalString(sync.repo),
    stateFile: readOptionalString(sync.stateFile ?? sync.state_file),
  };
}

function parseDocsLlm(value: unknown): DocsLlmConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const llm = asRecord(value, "adapter.source.llm");
  return {
    provider: readOptionalProvider(llm.provider),
    endpoint: readOptionalString(llm.endpoint),
    model: readOptionalString(llm.model),
    maxTokens: readOptionalNumber(llm.maxTokens ?? llm.max_tokens),
    concurrency: readOptionalNumber(llm.concurrency),
    chunkSize: readOptionalNumber(llm.chunkSize ?? llm.chunk_size),
  };
}

function validateEndpointFormat(
  issues: ValidationIssue[],
  path: string,
  value: string,
  requireMethod: boolean
): void {
  const pattern = requireMethod
    ? /^(GET|POST|PUT|PATCH|DELETE)\s+\/.+$/
    : /^\/.+$/;
  if (!pattern.test(value)) {
    issues.push(
      error(
        path,
        requireMethod
          ? "Expected endpoint format like `GET /resource/path`"
          : "Expected an absolute path template beginning with /"
      )
    );
  }
}

function validateTemplateFields(
  issues: ValidationIssue[],
  path: string,
  template: string,
  schema: unknown,
  serviceSpec: ServiceSpec
): void {
  for (const field of extractTemplateFields(template)) {
    if (!schemaPathExists(schema, field, serviceSpec)) {
      issues.push(error(path, `Field "${field}" does not exist in the referenced schema`));
    }
  }
}

function validateExtractFields(
  issues: ValidationIssue[],
  path: string,
  fields: string[] | undefined,
  schema: unknown,
  serviceSpec: ServiceSpec
): void {
  if (!fields) {
    return;
  }

  for (const field of fields) {
    if (!schemaPathExists(schema, field, serviceSpec)) {
      issues.push(error(path, `Extract field "${field}" does not exist in the referenced schema`));
    }
  }
}

function schemaPathExists(
  schema: unknown,
  fieldPath: string,
  serviceSpec: ServiceSpec,
  seen = new Set<string>()
): boolean {
  if (!schema || typeof schema !== "object") {
    return false;
  }

  const node = schema as {
    ref?: string;
    properties?: Record<string, unknown>;
    items?: unknown;
    anyOf?: unknown[];
    oneOf?: unknown[];
    allOf?: unknown[];
  };

  if (node.ref) {
    const refName = node.ref.replace(/^#\/components\/schemas\//, "");
    if (seen.has(refName)) {
      return false;
    }
    const dereferenced = serviceSpec.schemas[refName];
    if (!dereferenced) {
      return false;
    }
    seen.add(refName);
    return schemaPathExists(dereferenced, fieldPath, serviceSpec, seen);
  }

  const [head, ...rest] = fieldPath.split(".");
  if (!head) {
    return false;
  }

  const properties = node.properties ?? {};
  if (head in properties) {
    if (rest.length === 0) {
      return true;
    }
    return schemaPathExists(properties[head], rest.join("."), serviceSpec, seen);
  }

  if (node.items) {
    return schemaPathExists(node.items, fieldPath, serviceSpec, seen);
  }

  for (const variant of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
    if (schemaPathExists(variant, fieldPath, serviceSpec, seen)) {
      return true;
    }
  }

  return false;
}

function parseMappingText(text: string, location: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    try {
      return YAML.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse ${location}: ${message}`);
    }
  }
}

function hasSource(spec: MappingSpec): boolean {
  return Boolean(
    spec.adapter.source.openapi ||
      spec.adapter.source.postman ||
      spec.adapter.source.samples ||
      spec.adapter.source.docs
  );
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readOptionalStringArrayOrString(
  value: unknown
): string | string[] | undefined {
  if (typeof value === "string") {
    return value;
  }
  return readOptionalStringArray(value);
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalProvider(
  value: unknown
): DocsLlmConfig["provider"] | undefined {
  if (
    value === "anthropic" ||
    value === "custom" ||
    value === "openai"
  ) {
    return value;
  }
  return undefined;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function error(path: string, message: string): ValidationIssue {
  return { level: "error", path, message };
}

function warning(path: string, message: string): ValidationIssue {
  return { level: "warning", path, message };
}

export { schemaPathExists, pathExists };
