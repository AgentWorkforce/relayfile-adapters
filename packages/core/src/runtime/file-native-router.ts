import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  recordWritebackStatus,
  type WritebackStatusEntry,
  type WritebackStatusCode,
} from "./writeback-status.js";

export type AdapterResourceOperation = "create" | "update" | "delete";

export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly operations?: readonly AdapterResourceOperation[];
}

export type FileNativeWritebackKind = "patch" | "create" | "delete";
export type FileNativeWritebackEvent = "write" | "delete";

export interface FileNativeWritebackRoute {
  kind: FileNativeWritebackKind;
  resource: AdapterResourceConfig;
  id?: string;
  canonical: boolean;
}

export interface FileNativeWritebackRequest {
  readonly method?: string;
  readonly endpoint?: string;
  readonly action?: string;
  readonly body?: unknown;
  readonly [key: string]: unknown;
}

export interface FileNativeCreateReceipt {
  readonly draftPath: string;
  readonly canonicalPath?: string;
  readonly id?: string;
  readonly resource: string;
  readonly createdAt: string;
}

export interface FileNativeWritebackExecutionOk {
  readonly ok: true;
  readonly route: FileNativeWritebackRoute;
  readonly request?: FileNativeWritebackRequest;
  readonly adapterResult?: unknown;
  readonly createReceipt?: FileNativeCreateReceipt;
  readonly status: WritebackStatusEntry;
}

export interface FileNativeWritebackExecutionFailed {
  readonly ok: false;
  readonly route?: FileNativeWritebackRoute;
  readonly errors?: WritebackValidationError[];
  readonly status?: WritebackStatusEntry;
}

export type FileNativeWritebackExecutionResult =
  | FileNativeWritebackExecutionOk
  | FileNativeWritebackExecutionFailed;

export interface ClassifyWriteOptions {
  fsEvent?: FileNativeWritebackEvent;
}

export interface ExecuteFileNativeWritebackOptions {
  path: string;
  content?: string;
  resources: readonly AdapterResourceConfig[];
  fsEvent?: FileNativeWritebackEvent;
  schemaRoot?: string;
  loadSchema?: (
    resource: AdapterResourceConfig
  ) => JsonSchema | Promise<JsonSchema>;
  resolveWritebackRequest?: (
    path: string,
    content: string
  ) => FileNativeWritebackRequest | Promise<FileNativeWritebackRequest>;
  resolveDeleteRequest?: (
    path: string
  ) => FileNativeWritebackRequest | Promise<FileNativeWritebackRequest>;
  applyWriteback?: (
    request: FileNativeWritebackRequest,
    route: FileNativeWritebackRoute
  ) => unknown | Promise<unknown>;
  extractCreatedId?: (
    result: unknown,
    request: FileNativeWritebackRequest,
    route: FileNativeWritebackRoute
  ) => string | undefined;
  makeCanonicalPath?: (
    id: string,
    route: FileNativeWritebackRoute
  ) => string | undefined;
  recordStatus?: boolean;
  now?: () => Date;
}

export interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly additionalProperties?: boolean | JsonSchema;
  readonly readOnly?: boolean;
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchema;
}

export type WritebackValidationReason =
  | "required"
  | "additionalProperties"
  | "readOnly"
  | "type"
  | "enum";

export class ReadOnlyFieldError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`Field "${field}" is read-only and cannot be written`);
    this.name = "ReadOnlyFieldError";
    this.field = field;
  }
}

export class WritebackValidationError extends Error {
  readonly field?: string;
  readonly reason: WritebackValidationReason;

  constructor(input: {
    field?: string;
    reason: WritebackValidationReason;
    message?: string;
  }) {
    super(input.message ?? defaultValidationMessage(input.reason, input.field));
    this.name = "WritebackValidationError";
    this.field = input.field;
    this.reason = input.reason;
  }
}

export function classifyWrite(
  path: string,
  resources: readonly AdapterResourceConfig[],
  opts: ClassifyWriteOptions = {}
): FileNativeWritebackRoute | null {
  const event = opts.fsEvent ?? "write";
  const normalizedPath = normalizeWritebackPath(path);
  const resource = findMatchingResource(normalizedPath, resources);
  if (!resource) {
    return null;
  }

  const id = readWritebackId(normalizedPath);
  if (!id || isReservedWritebackFilename(id)) {
    return null;
  }

  const canonical = testResourceId(resource.idPattern, id);
  if (event === "delete") {
    return canonical
      ? {
          kind: "delete",
          resource,
          id,
          canonical,
        }
      : null;
  }

  return {
    kind: canonical ? "patch" : "create",
    resource,
    id,
    canonical,
  };
}

export function validatePayload(
  payload: unknown,
  schema: JsonSchema,
  op: "patch" | "create"
): { ok: true } | { ok: false; errors: WritebackValidationError[] } {
  const errors: WritebackValidationError[] = [];
  if (!isRecord(payload)) {
    errors.push(
      new WritebackValidationError({
        reason: "type",
        message: "Writeback payload must be a JSON object",
      })
    );
    return { ok: false, errors };
  }

  const properties = schema.properties ?? {};
  if (op === "create") {
    for (const field of schema.required ?? []) {
      if (!(field in payload) || payload[field] === undefined) {
        errors.push(
          new WritebackValidationError({
            field,
            reason: "required",
            message: `Missing required field "${field}"`,
          })
        );
      }
    }
  }

  for (const [field, value] of Object.entries(payload)) {
    const propertySchema = properties[field];
    if (!propertySchema) {
      if (schema.additionalProperties === false) {
        errors.push(
          new WritebackValidationError({
            field,
            reason: "additionalProperties",
            message: `Field "${field}" is not allowed by the resource schema`,
          })
        );
      }
      continue;
    }

    if (propertySchema.readOnly === true) {
      errors.push(
        new WritebackValidationError({
          field,
          reason: "readOnly",
          message: `Field "${field}" is read-only and cannot be written`,
        })
      );
      continue;
    }

    validateFieldValue(field, value, propertySchema, errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export async function executeFileNativeWriteback(
  options: ExecuteFileNativeWritebackOptions
): Promise<FileNativeWritebackExecutionResult> {
  const route = classifyWrite(options.path, options.resources, {
    fsEvent: options.fsEvent,
  });
  if (!route) {
    return { ok: false };
  }

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  try {
    let request: FileNativeWritebackRequest | undefined;
    if (route.kind === "delete") {
      if (!options.resolveDeleteRequest) {
        throw new Error("Missing delete writeback resolver");
      }
      request = await options.resolveDeleteRequest(options.path);
    } else {
      const content = options.content ?? "";
      const payload = parseWritebackJsonObject(content);
      const schema = await loadWritebackSchema(route.resource, options);
      const validation = validatePayload(payload, schema, route.kind);
      if (!validation.ok) {
        const status = buildValidationStatus(
          options.path,
          route.kind,
          validation.errors,
          timestamp
        );
        maybeRecordStatus(status, options);
        return { ok: false, route, errors: validation.errors, status };
      }
      if (!options.resolveWritebackRequest) {
        throw new Error("Missing writeback resolver");
      }
      request = await options.resolveWritebackRequest(options.path, content);
    }

    const adapterResult = options.applyWriteback
      ? await options.applyWriteback(request, route)
      : undefined;
    const createReceipt =
      route.kind === "create"
        ? createPointerReceipt(options.path, route, request, adapterResult, timestamp, options)
        : undefined;
    const status = buildStatus(options.path, route.kind, "ok", timestamp);
    maybeRecordStatus(status, options);
    return { ok: true, route, request, adapterResult, createReceipt, status };
  } catch (error) {
    const status = statusFromError(options.path, route.kind, error, timestamp);
    maybeRecordStatus(status, options);
    return { ok: false, route, status };
  }
}

function validateFieldValue(
  field: string,
  value: unknown,
  schema: JsonSchema,
  errors: WritebackValidationError[]
): void {
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(
      new WritebackValidationError({
        field,
        reason: "enum",
        message: `Field "${field}" must be one of the schema enum values`,
      })
    );
    return;
  }

  if (schema.type && !matchesJsonSchemaType(value, schema.type)) {
    errors.push(
      new WritebackValidationError({
        field,
        reason: "type",
        message: `Field "${field}" does not match schema type ${formatSchemaType(
          schema.type
        )}`,
      })
    );
    return;
  }

  if (isRecord(value) && schema.properties) {
    const nested = validatePayload(value, schema, "patch");
    if (!nested.ok) {
      for (const error of nested.errors) {
        errors.push(
          new WritebackValidationError({
            field: error.field ? `${field}.${error.field}` : field,
            reason: error.reason,
            message: error.message.replace(
              /^Field "([^"]+)"/,
              `Field "${field}.$1"`
            ),
          })
        );
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      if (schema.items?.type && !matchesJsonSchemaType(item, schema.items.type)) {
        errors.push(
          new WritebackValidationError({
            field: `${field}[${index}]`,
            reason: "type",
            message: `Field "${field}[${index}]" does not match schema type ${formatSchemaType(
              schema.items.type
            )}`,
          })
        );
        return;
      }
      if (isRecord(item) && schema.items?.properties) {
        const nested = validatePayload(item, schema.items, "patch");
        if (!nested.ok) {
          for (const error of nested.errors) {
            errors.push(
              new WritebackValidationError({
                field: error.field
                  ? `${field}[${index}].${error.field}`
                  : `${field}[${index}]`,
                reason: error.reason,
                message: error.message.replace(
                  /^Field "([^"]+)"/,
                  `Field "${field}[${index}].$1"`
                ),
              })
            );
          }
        }
      }
    });
  }
}

function parseWritebackJsonObject(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new WritebackValidationError({
      reason: "type",
      message: `Writeback payload must be valid JSON: ${errorMessage(error)}`,
    });
  }

  if (!isRecord(parsed)) {
    throw new WritebackValidationError({
      reason: "type",
      message: "Writeback payload must be a JSON object",
    });
  }
  return parsed;
}

async function loadWritebackSchema(
  resource: AdapterResourceConfig,
  options: ExecuteFileNativeWritebackOptions
): Promise<JsonSchema> {
  if (options.loadSchema) {
    return options.loadSchema(resource);
  }

  const schemaPath = options.schemaRoot
    ? resolve(options.schemaRoot, resource.schema)
    : resolve(resource.schema);
  return JSON.parse(await readFile(schemaPath, "utf8")) as JsonSchema;
}

function buildValidationStatus(
  path: string,
  op: FileNativeWritebackKind,
  errors: readonly WritebackValidationError[],
  timestamp: string
): WritebackStatusEntry {
  const first = errors[0];
  return buildStatus(
    path,
    op,
    errors.some((error) => error.reason === "readOnly")
      ? "readonly_rejected"
      : "validation_failed",
    timestamp,
    first?.message,
    first?.field
  );
}

function statusFromError(
  path: string,
  op: FileNativeWritebackKind,
  error: unknown,
  timestamp: string
): WritebackStatusEntry {
  if (error instanceof WritebackValidationError) {
    return buildStatus(
      path,
      op,
      error.reason === "readOnly" ? "readonly_rejected" : "validation_failed",
      timestamp,
      error.message,
      error.field
    );
  }

  if (isReadOnlyFieldError(error)) {
    return buildStatus(
      path,
      op,
      "readonly_rejected",
      timestamp,
      errorMessage(error),
      error.field
    );
  }

  return buildStatus(path, op, "adapter_error", timestamp, errorMessage(error));
}

function buildStatus(
  path: string,
  op: FileNativeWritebackKind,
  outcome: WritebackStatusEntry["outcome"],
  timestamp: string,
  error?: string,
  field?: string
): WritebackStatusEntry {
  return {
    path,
    op,
    status: outcome === "ok" ? "accepted" : "rejected",
    code: statusCodeForOutcome(outcome),
    outcome,
    ...(error ? { error } : {}),
    ...(field ? { field } : {}),
    timestamp,
  };
}

function statusCodeForOutcome(
  outcome: WritebackStatusEntry["outcome"]
): WritebackStatusCode {
  switch (outcome) {
    case "adapter_error":
      return "ADAPTER_ERROR";
    case "ok":
      return "OK";
    case "readonly_rejected":
      return "READ_ONLY_FIELD";
    case "validation_failed":
      return "VALIDATION_FAILED";
  }
}

function maybeRecordStatus(
  status: WritebackStatusEntry,
  options: ExecuteFileNativeWritebackOptions
): void {
  if (options.recordStatus !== false) {
    recordWritebackStatus(status);
  }
}

function createPointerReceipt(
  draftPath: string,
  route: FileNativeWritebackRoute,
  request: FileNativeWritebackRequest,
  adapterResult: unknown,
  timestamp: string,
  options: ExecuteFileNativeWritebackOptions
): FileNativeCreateReceipt {
  const id =
    options.extractCreatedId?.(adapterResult, request, route) ??
    extractCreatedId(adapterResult);
  const canonicalPath = id
    ? options.makeCanonicalPath?.(id, route) ?? replaceWritebackBasename(draftPath, id)
    : undefined;

  return {
    draftPath,
    ...(canonicalPath ? { canonicalPath } : {}),
    ...(id ? { id } : {}),
    resource: route.resource.name,
    createdAt: timestamp,
  };
}

function extractCreatedId(value: unknown): string | undefined {
  const seen = new Set<unknown>();
  return extractCreatedIdFromRecord(value, seen);
}

function extractCreatedIdFromRecord(
  value: unknown,
  seen: Set<unknown>
): string | undefined {
  if (!isRecord(value) || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  for (const key of ["externalId", "id", "objectId"]) {
    const id = value[key];
    if (typeof id === "string" || typeof id === "number") {
      return String(id);
    }
  }

  for (const child of Object.values(value)) {
    const id = extractCreatedIdFromRecord(child, seen);
    if (id) {
      return id;
    }
  }
  return undefined;
}

function replaceWritebackBasename(path: string, id: string): string {
  const encoded = encodeURIComponent(id);
  return path.replace(/[^/]+\.json$/u, `${encoded}.json`);
}

function isReadOnlyFieldError(
  error: unknown
): error is Error & { field: string } {
  return (
    error instanceof Error &&
    error.name === "ReadOnlyFieldError" &&
    typeof (error as { field?: unknown }).field === "string"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findMatchingResource(
  path: string,
  resources: readonly AdapterResourceConfig[]
): AdapterResourceConfig | undefined {
  return [...resources]
    .sort((left, right) => right.path.length - left.path.length)
    .find((resource) => {
      resource.pathPattern.lastIndex = 0;
      const matched = resource.pathPattern.test(path);
      resource.pathPattern.lastIndex = 0;
      return matched;
    });
}

function normalizeWritebackPath(path: string): string {
  const trimmed = path.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function readWritebackId(path: string): string | undefined {
  const segment = path.split("/").filter(Boolean).at(-1);
  if (!segment || !segment.endsWith(".json")) {
    return undefined;
  }
  const stem = segment.slice(0, -5);
  if (!stem) {
    return undefined;
  }
  return decodeURIComponent(stem);
}

function isReservedWritebackFilename(stem: string): boolean {
  return (
    stem === ".schema" ||
    stem === ".create.example" ||
    stem === ".adapter" ||
    stem === ".tmp" ||
    stem === ".partial" ||
    stem === "partial" ||
    stem.endsWith(".tmp") ||
    stem.endsWith(".partial")
  );
}

function testResourceId(pattern: RegExp, id: string): boolean {
  pattern.lastIndex = 0;
  const matched = pattern.test(id);
  pattern.lastIndex = 0;
  return matched;
}

function matchesJsonSchemaType(
  value: unknown,
  type: string | readonly string[]
): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => matchesSingleJsonSchemaType(value, item));
}

function matchesSingleJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isRecord(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

function formatSchemaType(type: string | readonly string[]): string {
  return typeof type === "string" ? type : type.join(" | ");
}

function defaultValidationMessage(
  reason: WritebackValidationReason,
  field: string | undefined
): string {
  const label = field ? `Field "${field}"` : "Payload";
  switch (reason) {
    case "additionalProperties":
      return `${label} is not allowed by the resource schema`;
    case "enum":
      return `${label} must be one of the schema enum values`;
    case "readOnly":
      return `${label} is read-only and cannot be written`;
    case "required":
      return `${label} is required`;
    case "type":
      return `${label} does not match the schema type`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
