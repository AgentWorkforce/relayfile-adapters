import YAML from "yaml";
import type {
  DocsLlmConfig,
  DocsSourceConfig,
  DocsSpecMetadata,
  DocsSyncConfig,
  ExtractedAPI,
} from "./types.js";

export interface SpecGeneratorOptions {
  apiName: string;
  apiVersion?: string;
  apiDescription?: string;
  docsSource?: DocsSourceConfig;
  sync?: DocsSyncConfig;
  llm?: DocsLlmConfig;
}

export class SpecGenerator {
  generate(extracted: ExtractedAPI, options: SpecGeneratorOptions): string {
    const document = this.generateDocument(extracted, options);
    validateOpenApiDocument(document);
    return YAML.stringify(document, { lineWidth: 0 });
  }

  generateDocument(
    extracted: ExtractedAPI,
    options: SpecGeneratorOptions
  ): Record<string, unknown> {
    const registry = new SchemaRegistry();
    const document: Record<string, unknown> = {
      openapi: "3.0.3",
      info: {
        title: options.apiName,
        version: options.apiVersion ?? "1.0.0",
        description: options.apiDescription ?? extracted.description,
      },
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {},
      },
      "x-webhooks": {},
    };

    if (options.docsSource) {
      document["x-docs-source"] = toSpecMetadata(
        options.docsSource,
        options.sync,
        options.llm
      );
    }

    const paths = document.paths as Record<string, Record<string, unknown>>;
    for (const endpoint of extracted.endpoints) {
      const pathItem = (paths[endpoint.path] ??= {});
      const operation: Record<string, unknown> = {
        summary: endpoint.summary,
        description: endpoint.description,
        operationId: toOperationId(endpoint.method, endpoint.path),
        parameters: endpoint.parameters
          .filter((parameter) => parameter.in !== "body")
          .map((parameter) => ({
            name: parameter.name,
            in: parameter.in,
            required: parameter.required || parameter.in === "path",
            description: parameter.description,
            schema: simpleTypeSchema(parameter.type),
          })),
        responses: {
          "200": {
            description: "Successful response",
          },
        },
      };

      if (endpoint.requestShape) {
        operation.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: registry.referenceFor(
                endpoint.requestShape,
                `${registry.baseName(endpoint.method, endpoint.path)}Request`
              ),
            },
          },
        };
      } else {
        const bodyParameter = endpoint.parameters.find(
          (parameter) => parameter.in === "body"
        );
        if (bodyParameter) {
          operation.requestBody = {
            required: bodyParameter.required,
            content: {
              "application/json": {
                schema: simpleTypeSchema(bodyParameter.type),
              },
            },
          };
        }
      }

      if (endpoint.responseShape) {
        operation.responses = {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: registry.referenceFor(
                  endpoint.responseShape,
                  `${registry.baseName(endpoint.method, endpoint.path)}Response`
                ),
              },
            },
          },
        };
      }

      pathItem[endpoint.method.toLowerCase()] = operation;
    }

    const webhooks = document["x-webhooks"] as Record<string, unknown>;
    for (const webhook of extracted.webhooks) {
      const webhookOperation: Record<string, unknown> = {
        summary: webhook.summary,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: registry.referenceFor(
                webhook.payloadShape ?? {},
                `${toPascalCase(webhook.event)}Webhook`
              ),
            },
          },
        },
        responses: {
          "200": {
            description: "Webhook accepted",
          },
        },
      };

      if (webhook.deliveryFormat) {
        webhookOperation["x-delivery-format"] = webhook.deliveryFormat;
      }
      webhooks[webhook.event] = { post: webhookOperation };
    }

    if (extracted.auth && extracted.auth.type !== "none") {
      const scheme = authToSecurityScheme(extracted.auth);
      if (scheme) {
        (
          document.components as Record<string, Record<string, unknown>>
        ).securitySchemes.DefaultAuth = scheme;
        for (const pathItem of Object.values(paths)) {
          for (const operation of Object.values(pathItem)) {
            if (operation && typeof operation === "object") {
              (operation as Record<string, unknown>).security = [
                { DefaultAuth: [] },
              ];
            }
          }
        }
      }
    }

    const errors = extracted.errors ?? [];
    if (errors.length > 0) {
      const errorSchema = errors.reduce<Record<string, unknown>>(
        (shape, error) => mergeShape(shape, error.shape ?? {}),
        {}
      );
      (
        document.components as Record<string, Record<string, unknown>>
      ).schemas.Error = registry.inlineSchema(errorSchema);
    }

    (
      document.components as Record<string, Record<string, unknown>>
    ).schemas = {
      ...(document.components as Record<string, Record<string, unknown>>).schemas,
      ...registry.schemas,
    };

    return document;
  }
}

function validateOpenApiDocument(document: Record<string, unknown>): void {
  if (document.openapi !== "3.0.3") {
    throw new Error("Generated document must target OpenAPI 3.0.3");
  }
  const info = asRecord(document.info);
  if (!info?.title || !info.version) {
    throw new Error("Generated document is missing info.title or info.version");
  }
  if (!isPlainObject(document.paths)) {
    throw new Error("Generated document is missing paths");
  }
  if (!isPlainObject(document.components)) {
    throw new Error("Generated document is missing components");
  }
}

function toSpecMetadata(
  docsSource: DocsSourceConfig,
  sync?: DocsSyncConfig,
  llm?: DocsLlmConfig
): DocsSpecMetadata {
  return {
    url: docsSource.url,
    crawlPaths: docsSource.crawlPaths,
    selectors: docsSource.selectors,
    sync: sync
      ? {
          trigger: sync.trigger,
          feedUrl: sync.feedUrl,
          repo: sync.repo,
        }
      : undefined,
    llm: llm
      ? {
          provider: llm.provider,
          endpoint: llm.endpoint,
          model: llm.model,
          maxTokens: llm.maxTokens,
          concurrency: llm.concurrency,
          chunkSize: llm.chunkSize,
        }
      : undefined,
  };
}

function simpleTypeSchema(type: string): Record<string, unknown> {
  switch (type.toLowerCase()) {
    case "boolean":
      return { type: "boolean" };
    case "integer":
      return { type: "integer" };
    case "number":
      return { type: "number" };
    case "object":
      return { type: "object", additionalProperties: true };
    case "array":
      return { type: "array", items: {} };
    default:
      return { type: "string" };
  }
}

function authToSecurityScheme(
  auth: ExtractedAPI["auth"]
): Record<string, unknown> | undefined {
  if (!auth) {
    return undefined;
  }
  if (auth.type === "bearer") {
    return { type: "http", scheme: "bearer" };
  }
  if (auth.type === "basic") {
    return { type: "http", scheme: "basic" };
  }
  if (auth.type === "oauth2") {
    return {
      type: "oauth2",
      flows: {
        authorizationCode: {
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "https://example.com/oauth/token",
          scopes: {},
        },
      },
    };
  }
  if (auth.type === "api-key") {
    return {
      type: "apiKey",
      in: auth.location ?? "header",
      name: auth.headerName ?? auth.name ?? "X-API-Key",
    };
  }
  return undefined;
}

class SchemaRegistry {
  readonly schemas: Record<string, unknown> = {};
  private readonly hashes = new Map<string, string>();

  baseName(method: string, path: string): string {
    return toPascalCase(`${method.toLowerCase()} ${path.replace(/[{}]/g, "")}`);
  }

  referenceFor(shape: unknown, preferredName: string): Record<string, unknown> {
    const schema = this.inlineSchema(shape);
    const hash = JSON.stringify(schema);
    const existing = this.hashes.get(hash);
    if (existing) {
      return { $ref: `#/components/schemas/${existing}` };
    }

    const name = this.uniqueName(preferredName);
    this.hashes.set(hash, name);
    this.schemas[name] = schema;
    return { $ref: `#/components/schemas/${name}` };
  }

  inlineSchema(shape: unknown): Record<string, unknown> {
    if (looksLikeSchema(shape)) {
      return normalizeSchemaLike(shape);
    }
    if (Array.isArray(shape)) {
      return {
        type: "array",
        items: shape.length > 0 ? this.inlineSchema(shape[0]) : {},
      };
    }
    if (isPlainObject(shape)) {
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(shape).map(([key, value]) => [key, this.inlineSchema(value)])
        ),
        required: Object.keys(shape),
      };
    }
    if (typeof shape === "boolean") {
      return { type: "boolean", example: shape };
    }
    if (typeof shape === "number") {
      return {
        type: Number.isInteger(shape) ? "integer" : "number",
        example: shape,
      };
    }
    if (typeof shape === "string") {
      return { type: "string", example: shape };
    }
    return {};
  }

  private uniqueName(name: string): string {
    let candidate = toPascalCase(name);
    let suffix = 2;
    while (this.schemas[candidate]) {
      candidate = `${toPascalCase(name)}${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}

function normalizeSchemaLike(shape: unknown): Record<string, unknown> {
  const record = asRecord(shape) ?? {};
  const properties = asRecord(record.properties);
  return {
    ...(typeof record.type === "string" ? { type: record.type } : {}),
    ...(typeof record.description === "string"
      ? { description: record.description }
      : {}),
    ...(Array.isArray(record.required) ? { required: record.required } : {}),
    ...(Array.isArray(record.enum) ? { enum: record.enum } : {}),
    ...(record.nullable === true ? { nullable: true } : {}),
    ...(properties
      ? {
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, value]) => [
              key,
              normalizeSchemaLike(value),
            ])
          ),
        }
      : {}),
    ...(record.items ? { items: normalizeSchemaLike(record.items) } : {}),
    ...(Array.isArray(record.oneOf)
      ? { oneOf: record.oneOf.map(normalizeSchemaLike) }
      : {}),
    ...(Array.isArray(record.anyOf)
      ? { anyOf: record.anyOf.map(normalizeSchemaLike) }
      : {}),
    ...(Array.isArray(record.allOf)
      ? { allOf: record.allOf.map(normalizeSchemaLike) }
      : {}),
    ...(record.additionalProperties !== undefined
      ? {
          additionalProperties:
            record.additionalProperties === true ||
            record.additionalProperties === false
              ? record.additionalProperties
              : normalizeSchemaLike(record.additionalProperties),
        }
      : {}),
  };
}

function looksLikeSchema(shape: unknown): boolean {
  const record = asRecord(shape);
  if (!record) {
    return false;
  }
  return [
    "additionalProperties",
    "allOf",
    "anyOf",
    "enum",
    "items",
    "nullable",
    "oneOf",
    "properties",
    "required",
    "type",
  ].some((key) => key in record);
}

function mergeShape(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): Record<string, unknown> {
  const output = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = output[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      output[key] = mergeShape(existing, value);
      continue;
    }
    if (existing === undefined) {
      output[key] = value;
    }
  }
  return output;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? (value as Record<string, unknown>) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

function toOperationId(method: string, path: string): string {
  return `${method.toLowerCase()}${toPascalCase(path)}`;
}
