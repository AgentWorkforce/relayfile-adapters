import {
  type AdapterResourceConfig,
  type JsonSchemaObject,
  assertReadOnlyFieldsRejected,
  findResourceByPath,
} from "./discovery.js";

export type StorageBridgeWritebackMethod = "PUT" | "PATCH" | "DELETE";

export interface StorageBridgeWritebackRequest {
  readonly workspaceId: string;
  readonly path: string;
  readonly content?: string | Buffer | Uint8Array | Record<string, unknown> | null;
  readonly method?: StorageBridgeWritebackMethod;
}

export interface ParsedStorageBridgeWriteback {
  readonly resource: AdapterResourceConfig;
  readonly operation: "create" | "update" | "delete";
  readonly id: string;
  readonly canonical: boolean;
  readonly filename: string;
  readonly payload?: Record<string, unknown>;
}

export interface StorageBridgeWritebackCreated {
  readonly created: string;
  readonly path: string;
  readonly url?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface StorageBridgeWritebackHandlers<Result = unknown> {
  create(input: ParsedStorageBridgeWriteback): Promise<StorageBridgeWritebackCreated> | StorageBridgeWritebackCreated;
  update(input: ParsedStorageBridgeWriteback): Promise<Result> | Result;
  delete(input: ParsedStorageBridgeWriteback): Promise<Result> | Result;
}

export interface DispatchStorageBridgeWritebackOptions<Result = unknown> {
  readonly resources: readonly AdapterResourceConfig[];
  readonly schemas?: Record<string, JsonSchemaObject>;
  readonly handlers: StorageBridgeWritebackHandlers<Result>;
}

export async function dispatchStorageBridgeWriteback<Result = unknown>(
  request: StorageBridgeWritebackRequest,
  options: DispatchStorageBridgeWritebackOptions<Result>,
): Promise<StorageBridgeWritebackCreated | Result> {
  const parsed = parseStorageBridgeWriteback(request, options.resources);
  const schema = options.schemas?.[parsed.resource.schema];
  if (schema && parsed.payload && parsed.operation !== "create") {
    assertReadOnlyFieldsRejected(schema, parsed.payload);
  }

  switch (parsed.operation) {
    case "create":
      return options.handlers.create(parsed);
    case "update":
      return options.handlers.update(parsed);
    case "delete":
      return options.handlers.delete(parsed);
  }
}

export function parseStorageBridgeWriteback(
  request: StorageBridgeWritebackRequest,
  resources: readonly AdapterResourceConfig[],
): ParsedStorageBridgeWriteback {
  const resource = findResourceByPath(resources, request.path);
  if (!resource) {
    throw new Error(`No storage bridge writeback resource matched ${request.path}`);
  }

  const filename = request.path.split("/").filter(Boolean).at(-1);
  if (!filename) {
    throw new Error(`Storage bridge writeback path has no filename: ${request.path}`);
  }

  const id = stripJsonExtension(decodeURIComponent(filename));
  if (id === "new") {
    throw new Error(
      "Storage bridge writeback creates must use any non-canonical filename; new.json is not supported",
    );
  }

  const canonical = resource.idPattern.test(id);
  const method = request.method ?? "PUT";
  const operation =
    method === "DELETE" ? "delete" : canonical ? "update" : "create";
  if (operation === "delete" && !canonical) {
    throw new Error(
      `Storage bridge delete requires a canonical id matching ${resource.idPattern}`,
    );
  }

  const payload = operation === "delete" ? undefined : parseWritebackContent(request.content);

  return {
    resource,
    operation,
    id,
    canonical,
    filename,
    payload,
  };
}

export function buildStorageBridgeCreateResult(input: {
  readonly resourcePath: string;
  readonly id: string;
  readonly url?: string;
  readonly metadata?: Record<string, unknown>;
}): StorageBridgeWritebackCreated {
  const path = `${input.resourcePath.replace(/\/$/, "")}/${encodeURIComponent(input.id)}.json`;
  return {
    created: input.id,
    path,
    ...(input.url ? { url: input.url } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function parseWritebackContent(
  content: StorageBridgeWritebackRequest["content"],
): Record<string, unknown> {
  if (content === undefined || content === null) return {};
  if (typeof content === "string") return parseJsonObject(content);
  if (Buffer.isBuffer(content)) return parseJsonObject(content.toString("utf8"));
  if (content instanceof Uint8Array) {
    return parseJsonObject(Buffer.from(content).toString("utf8"));
  }
  if (typeof content === "object" && !Array.isArray(content)) {
    return content;
  }
  throw new Error("Storage bridge writeback content must be a JSON object");
}

function parseJsonObject(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new Error(
      `Storage bridge writeback content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new Error("Storage bridge writeback content must be a JSON object");
}

function stripJsonExtension(filename: string): string {
  return filename.endsWith(".json") ? filename.slice(0, -5) : filename;
}
