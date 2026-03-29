import {
  asRecord,
  firstJsonContent,
  parseStructuredText,
  readSourceText,
} from "./shared.js";
import type {
  EndpointParameter,
  EndpointSpec,
  HttpMethod,
  SchemaNode,
  ServiceSpec,
} from "./types.js";

const METHODS: HttpMethod[] = ["DELETE", "GET", "PATCH", "POST", "PUT"];

export async function loadOpenApiSpec(
  location: string,
  cwd = process.cwd()
): Promise<ServiceSpec> {
  const text = await readSourceText(location, cwd);
  const parsed = parseStructuredText(text, location);
  const document = asRecord(parsed, "OpenAPI document");

  return openApiDocumentToServiceSpec(document, {
    sourceKind: "openapi",
    sourceLocation: location,
  });
}

export function openApiDocumentToServiceSpec(
  document: Record<string, unknown>,
  options: {
    sourceKind: ServiceSpec["sourceKind"];
    sourceLocation: string;
  }
): ServiceSpec {
  const info = asOptionalRecord(document.info);
  const title = typeof info?.title === "string" ? info.title : "Unknown API";
  const version = typeof info?.version === "string" ? info.version : "0.0.0";
  const schemas = collectSchemas(document);
  const endpoints = collectEndpoints(document);
  const webhookSchemas = collectWebhookSchemas(document);

  return {
    title,
    version,
    sourceKind: options.sourceKind,
    sourceLocation: options.sourceLocation,
    endpoints,
    schemas,
    webhookSchemas,
    raw: document,
  };
}

function collectSchemas(document: Record<string, unknown>): Record<string, SchemaNode> {
  const components = asOptionalRecord(document.components);
  const schemasValue = asOptionalRecord(components?.schemas);
  const schemas: Record<string, SchemaNode> = {};

  if (!schemasValue) {
    return schemas;
  }

  for (const [name, rawSchema] of Object.entries(schemasValue)) {
    schemas[name] = normalizeSchemaNode(rawSchema);
  }

  return schemas;
}

function collectEndpoints(document: Record<string, unknown>): EndpointSpec[] {
  const pathsValue = asOptionalRecord(document.paths);
  if (!pathsValue) {
    return [];
  }

  const endpoints: EndpointSpec[] = [];

  for (const [path, pathEntry] of Object.entries(pathsValue)) {
    const pathObject = asOptionalRecord(pathEntry);
    if (!pathObject) {
      continue;
    }

    const pathParameters = readParameters(pathObject.parameters);

    for (const method of METHODS) {
      const operationValue = pathObject[method.toLowerCase()];
      const operation = asOptionalRecord(operationValue);
      if (!operation) {
        continue;
      }

      const operationId =
        typeof operation.operationId === "string"
          ? operation.operationId
          : `${method}_${path}`.replace(/[^\w]+/g, "_");
      const requestBody = asOptionalRecord(operation.requestBody);
      const requestContent = firstJsonContent(asOptionalRecord(requestBody?.content));
      const responses = asOptionalRecord(operation.responses);
      const responseSchema = readPrimaryResponseSchema(responses);

      endpoints.push({
        key: `${method} ${path}`,
        operationId,
        method,
        path,
        summary: typeof operation.summary === "string" ? operation.summary : undefined,
        requestSchema: requestContent ? normalizeSchemaNode(requestContent.schema) : undefined,
        responseSchema,
        parameters: [...pathParameters, ...readParameters(operation.parameters)],
      });
    }
  }

  return endpoints;
}

function collectWebhookSchemas(document: Record<string, unknown>): Record<string, SchemaNode> {
  const webhooks =
    asOptionalRecord(document.webhooks) ??
    asOptionalRecord(document["x-webhooks"]);
  if (!webhooks) {
    return {};
  }

  const output: Record<string, SchemaNode> = {};
  for (const [eventName, rawWebhook] of Object.entries(webhooks)) {
    const webhook = asOptionalRecord(rawWebhook);
    if (!webhook) {
      continue;
    }

    for (const method of METHODS) {
      const operation = asOptionalRecord(webhook[method.toLowerCase()]);
      if (!operation) {
        continue;
      }

      const requestBody = asOptionalRecord(operation.requestBody);
      const requestContent = firstJsonContent(asOptionalRecord(requestBody?.content));
      if (requestContent?.schema) {
        output[eventName] = normalizeSchemaNode(requestContent.schema);
        break;
      }
    }
  }

  return output;
}

function readParameters(value: unknown): EndpointParameter[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: EndpointParameter[] = [];

  for (const item of value) {
    const parameter = asOptionalRecord(item);
    if (!parameter || typeof parameter.name !== "string" || typeof parameter.in !== "string") {
      continue;
    }

    output.push({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required === true,
      schema: parameter.schema ? normalizeSchemaNode(parameter.schema) : undefined,
    });
  }

  return output;
}

function readPrimaryResponseSchema(
  responses: Record<string, unknown> | undefined
): SchemaNode | undefined {
  if (!responses) {
    return undefined;
  }

  const preferredKeys = Object.keys(responses).sort((left, right) => {
    const leftScore = left.startsWith("2") ? 0 : 1;
    const rightScore = right.startsWith("2") ? 0 : 1;
    return leftScore - rightScore || left.localeCompare(right);
  });

  for (const key of preferredKeys) {
    const response = asOptionalRecord(responses[key]);
    const content = firstJsonContent(asOptionalRecord(response?.content));
    if (content?.schema) {
      return normalizeSchemaNode(content.schema);
    }
  }

  return undefined;
}

export function normalizeSchemaNode(input: unknown): SchemaNode {
  const value = asOptionalRecord(input);
  if (!value) {
    return { raw: {} };
  }

  if (typeof value.$ref === "string") {
    return {
      ref: value.$ref,
      raw: value,
    };
  }

  const properties = asOptionalRecord(value.properties);
  const additionalProperties = value.additionalProperties;

  return {
    type: typeof value.type === "string" ? value.type : undefined,
    format: typeof value.format === "string" ? value.format : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    enum: Array.isArray(value.enum) ? [...value.enum] : undefined,
    nullable: value.nullable === true,
    required: Array.isArray(value.required)
      ? value.required.filter((item): item is string => typeof item === "string")
      : undefined,
    properties: properties
      ? Object.fromEntries(
          Object.entries(properties).map(([key, property]) => [key, normalizeSchemaNode(property)])
        )
      : undefined,
    items: value.items ? normalizeSchemaNode(value.items) : undefined,
    anyOf: Array.isArray(value.anyOf) ? value.anyOf.map(normalizeSchemaNode) : undefined,
    oneOf: Array.isArray(value.oneOf) ? value.oneOf.map(normalizeSchemaNode) : undefined,
    allOf: Array.isArray(value.allOf) ? value.allOf.map(normalizeSchemaNode) : undefined,
    additionalProperties:
      typeof additionalProperties === "boolean"
        ? additionalProperties
        : additionalProperties
          ? normalizeSchemaNode(additionalProperties)
          : undefined,
    raw: value,
  };
}

function asOptionalRecord(
  value: unknown
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
