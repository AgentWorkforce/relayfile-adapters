import {
  computeCanonicalPath,
  IntegrationAdapter,
  type ConnectionProvider,
  type FileSemantics,
  type ProxyResponse,
  type RelayFileClient,
} from "@relayfile/sdk";
import type {
  AdapterWebhook,
  AdapterWebhookMetadata,
  IngestError,
  IngestResult,
  SyncOptions,
  SyncResult,
} from "@relayfile/sdk";
import { minimatch } from "minimatch";
import {
  interpolateTemplate,
  pickFields,
  readTemplateValue,
} from "../spec/template.js";
import type {
  MappingSpec,
  PaginationConfig,
  ResourceMapping,
  WebhookMapping,
  WritebackMapping,
} from "../spec/types.js";

export interface MatchedWriteback {
  name: string;
  mapping: WritebackMapping;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  endpointPath: string;
  params: Record<string, string>;
}

export interface SchemaAdapterOptions {
  client: RelayFileClient;
  provider: ConnectionProvider;
  spec: MappingSpec;
  defaultConnectionId?: string;
  resolveConnectionId?: (context: {
    workspaceId: string;
    path: string;
    content: string;
    parsedContent?: unknown;
    match: MatchedWriteback;
  }) => Promise<string> | string;
}

export interface SchemaSyncOptions extends SyncOptions {
  workspaceId?: string;
  resourceName?: string;
  connectionId?: string;
  resume?: boolean;
  maxPages?: number;
  since?: string;
  watermark?: string;
  sinceParamName?: string;
  watermarkParamName?: string;
  input?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

export interface SchemaResourceSyncOptions extends SchemaSyncOptions {
  workspaceId: string;
}

export { IntegrationAdapter } from "@relayfile/sdk";
export type {
  AdapterWebhook,
  AdapterWebhookMetadata,
  IngestError,
  IngestResult,
} from "@relayfile/sdk";

export class SchemaAdapter extends IntegrationAdapter {
  readonly name: string;
  readonly version: string;

  private readonly spec: MappingSpec;
  private readonly defaultConnectionId?: string;
  private readonly resolveConnectionIdFn?: SchemaAdapterOptions["resolveConnectionId"];

  constructor(options: SchemaAdapterOptions) {
    super(options.client, options.provider);
    this.spec = options.spec;
    this.name = options.spec.adapter.name;
    this.version = options.spec.adapter.version;
    this.defaultConnectionId = options.defaultConnectionId;
    this.resolveConnectionIdFn = options.resolveConnectionId;
  }

  computePath(objectType: string, objectId: string): string {
    return computeCanonicalPath(this.name, objectType, objectId);
  }

  computeWebhookPath(event: AdapterWebhook): string {
    const mapping = this.resolveWebhookMapping(event);
    return interpolateTemplate(mapping.path, event.payload, { strict: true });
  }

  computeResourcePath(
    resourceName: string,
    input: Record<string, unknown>
  ): string {
    const mapping = this.spec.resources?.[resourceName];
    if (!mapping) {
      throw new Error(`Unknown resource mapping "${resourceName}"`);
    }
    return interpolateTemplate(mapping.path, input, { strict: true });
  }

  normalizePayload(
    event: AdapterWebhook,
    mapping?: WebhookMapping | ResourceMapping
  ): Record<string, unknown> {
    const payload = event.payload;
    return pickFields(payload, mapping?.extract);
  }

  computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics {
    const properties: Record<string, string> = {
      provider: this.name,
      "provider.object_type": objectType,
      "provider.object_id": objectId,
    };

    if (typeof payload.status === "string") {
      properties["provider.status"] = payload.status;
    }

    return { properties };
  }

  supportedEvents(): string[] {
    return Object.keys(this.spec.webhooks);
  }

  async sync(
    resourceName: string,
    options: SchemaResourceSyncOptions
  ): Promise<SyncResult>;
  async sync(
    workspaceId: string,
    options?: SchemaSyncOptions
  ): Promise<SyncResult>;
  async sync(
    workspaceId: string,
    resourceName: string,
    options?: SchemaSyncOptions
  ): Promise<SyncResult>;
  async sync(
    first: string,
    second: string | SchemaSyncOptions = {},
    third: SchemaSyncOptions = {}
  ): Promise<SyncResult> {
    const { workspaceId, resourceName, options } =
      this.resolveSyncInvocation(first, second, third);
    const mapping = this.spec.resources?.[resourceName];
    if (!mapping) {
      throw new Error(`Unknown resource mapping "${resourceName}"`);
    }

    const signal = options.signal;
    throwIfAborted(signal);

    const parsedEndpoint = parseEndpointDescriptor(mapping.endpoint);
    const input = buildSyncInput(options);
    const endpoint = interpolateBracedTemplate(
      parsedEndpoint.path,
      input,
      "resource endpoint"
    );
    const syncMetadata = mapping.sync;
    const objectType = syncMetadata?.modelName ?? resourceName;
    const checkpointKey = syncMetadata?.checkpointKey ?? resourceName;
    const inputScope = checkpointScope(input);
    const checkpointPath = syncCheckpointPath(
      this.name,
      resourceName,
      checkpointKey,
      inputScope
    );
    const connectionId = this.resolveSyncConnectionId(resourceName, options);
    const maxPages =
      readNonNegativeInteger(options.maxPages) ?? DEFAULT_SYNC_MAX_PAGES;
    const checkpoint =
      options.resume === false
        ? undefined
        : await this.readSyncCheckpoint(workspaceId, checkpointPath, signal);
    const initialCursor =
      readString(options.cursor) ?? checkpointCursor(checkpoint);
    let cursor = initialCursor;
    let watermark =
      readString(options.watermark) ??
      readString(options.since) ??
      readString(checkpoint?.watermark);
    const requestWatermark = watermark;
    let page = readPositiveInteger(initialCursor) ?? 1;
    let offset = readNonNegativeInteger(initialCursor) ?? 0;
    let linkTarget =
      mapping.pagination?.strategy === "link-header" && initialCursor
        ? parseLinkTarget(initialCursor)
        : undefined;

    const result: SyncResult = {
      filesWritten: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [],
      cursor: initialCursor,
      nextCursor: initialCursor ?? null,
      syncedObjectTypes: [objectType],
      errors: [],
    };

    let runPagesSynced = 0;
    let pagesSynced = readNonNegativeInteger(checkpoint?.pagesSynced) ?? 0;
    let recordsSynced = readNonNegativeInteger(checkpoint?.recordsSynced) ?? 0;
    let nextCursor: string | null = initialCursor ?? null;
    let hasNextPage = true;
    const seenPageSignatures = new Set<string>();

    while (hasNextPage) {
      throwIfAborted(signal);
      if (runPagesSynced >= maxPages) {
        break;
      }

      const pageRequest = buildPageRequest({
        baseQuery: options.query,
        pagination: mapping.pagination,
        cursor,
        page,
        offset,
        limit: options.limit,
        watermark: requestWatermark,
        watermarkParamName:
          readString(options.watermarkParamName) ??
          readString(options.sinceParamName),
        linkTarget,
      });

      let response: ProxyResponse;
      try {
        const proxyRequest: Parameters<ConnectionProvider["proxy"]>[0] & {
          signal?: AbortSignal;
        } = {
          method: parsedEndpoint.method,
          baseUrl: linkTarget?.baseUrl ?? this.spec.adapter.baseUrl ?? "",
          endpoint: linkTarget?.endpoint ?? endpoint,
          connectionId,
          query: pageRequest.query,
          signal,
        };
        response = await this.provider.proxy(proxyRequest);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        result.errors.push({
          objectType,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }

      throwIfAborted(signal);

      if (response.status >= 400) {
        result.errors.push({
          objectType,
          error: `Sync failed with ${response.status}: ${JSON.stringify(response.data)}`,
        });
        break;
      }

      const nextLinkTarget =
        mapping.pagination?.strategy === "link-header"
          ? parseNextLink(response.headers)
          : undefined;
      const repeatedLinkTarget = repeatedLinkHeaderTarget(
        mapping.pagination,
        nextLinkTarget,
        cursor
      );
      if (repeatedLinkTarget) {
        result.errors.push({
          objectType,
          error: `Pagination stalled for ${resourceName}: repeated link-header target ${repeatedLinkTarget}.`,
        });
        break;
      }

      const records = extractSyncRecords(response.data, mapping);
      const pageSignature = syncPageSignature(mapping.pagination, records);
      if (pageSignature) {
        if (seenPageSignatures.has(pageSignature)) {
          result.errors.push({
            objectType,
            error: `Pagination stalled for ${resourceName}: repeated page data.`,
          });
          break;
        }
        seenPageSignatures.add(pageSignature);
      }

      let pageHadWriteFailure = false;
      for (const rawRecord of records) {
        let path: string | undefined;

        try {
          throwIfAborted(signal);
          const record = normalizeSyncRecord(rawRecord);
          const pathInput = { ...input, ...record };
          path = interpolateResourcePath(mapping.path, pathInput);
          const payload = pickFields(record, mapping.extract);
          const objectId = resolveObjectId(
            record,
            syncMetadata?.cursorField,
            path
          );
          const baseRevision = await this.resolveBaseRevision(
            workspaceId,
            path,
            signal
          );

          throwIfAborted(signal);
          await this.client.writeFile({
            workspaceId,
            path,
            baseRevision,
            content: `${JSON.stringify(payload, null, 2)}\n`,
            contentType: "application/json",
            encoding: "utf-8",
            semantics: this.computeSemantics(objectType, objectId, record),
            signal,
          });
          if (baseRevision === "0") {
            result.filesWritten += 1;
          } else {
            result.filesUpdated += 1;
          }
          result.paths?.push(path);
          recordsSynced += 1;
          watermark = advanceWatermark(
            watermark,
            syncMetadata?.cursorField
              ? readTemplateValue(record, syncMetadata.cursorField)
              : undefined
          );
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          const syncError: SyncResult["errors"][number] = {
            objectType,
            error: error instanceof Error ? error.message : String(error),
          };
          if (path) {
            syncError.path = path;
          }
          result.errors.push(syncError);
          pageHadWriteFailure = true;
        }
      }

      if (pageHadWriteFailure) {
        break;
      }

      runPagesSynced += 1;
      pagesSynced += 1;
      const nextPage = resolveNextPage({
        pagination: mapping.pagination,
        response,
        recordsRead: records.length,
        page,
        offset,
        limit: pageRequest.limit,
        cursor,
        maxPages,
        pagesSynced: runPagesSynced,
        nextLinkTarget,
      });

      nextCursor = nextPage.cursor;
      result.nextCursor = nextCursor;

      try {
        throwIfAborted(signal);
        await this.writeSyncCheckpoint(
          workspaceId,
          checkpointPath,
          {
            adapter: this.name,
            resourceName,
            checkpointKey,
            inputScope,
            cursor: nextCursor ?? undefined,
            nextCursor,
            watermark,
            updatedAt: new Date().toISOString(),
            pagesSynced,
            recordsSynced,
          },
          signal
        );
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        result.errors.push({
          path: checkpointPath,
          objectType,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }

      hasNextPage = nextPage.hasNext;
      cursor = nextPage.cursor ?? undefined;
      page = nextPage.page ?? page + 1;
      offset = nextPage.offset ?? offset + records.length;
      linkTarget = nextPage.linkTarget;
    }

    result.nextCursor = nextCursor;
    return result;
  }

  async ingestWebhook(
    workspaceId: string,
    event: AdapterWebhook
  ): Promise<IngestResult> {
    const mapping = this.resolveWebhookMapping(event);
    const path = interpolateTemplate(mapping.path, event.payload, { strict: true });
    const data = this.normalizePayload(event, mapping);

    await this.client.ingestWebhook({
      workspaceId,
      provider: this.name,
      event_type: event.eventType,
      path,
      data,
      delivery_id: event.metadata?.delivery_id ?? event.metadata?.deliveryId,
      timestamp: event.metadata?.timestamp ?? new Date().toISOString(),
    });

    return {
      filesWritten: 1,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [path],
      errors: [],
    };
  }

  matchWriteback(path: string): MatchedWriteback | null {
    for (const [name, mapping] of Object.entries(this.spec.writebacks ?? {})) {
      if (!minimatch(path, mapping.match, { dot: true })) {
        continue;
      }

      const wildcardValues = extractWildcardValues(mapping.match, path);
      const parsed = parseEndpointDescriptor(mapping.endpoint);
      const placeholders = extractEndpointParams(parsed.path);
      const params = Object.fromEntries(
        placeholders.map((placeholder, index) => [placeholder, wildcardValues[index] ?? ""])
      );

      return {
        name,
        mapping,
        method: parsed.method,
        endpointPath: interpolateEndpointParams(parsed.path, params),
        params,
      };
    }

    return null;
  }

  async handleWriteback(
    workspaceId: string,
    path: string,
    content: string
  ): Promise<ProxyResponse> {
    const match = this.matchWriteback(path);
    if (!match) {
      throw new Error(`No writeback mapping matched ${path}`);
    }

    const parsedContent = safeJsonParse(content);
    const connectionId = await this.resolveConnectionId({
      workspaceId,
      path,
      content,
      parsedContent,
      match,
    });

    return this.provider.proxy({
      method: match.method,
      baseUrl: match.mapping.baseUrl ?? this.spec.adapter.baseUrl ?? "",
      endpoint: match.endpointPath,
      connectionId,
      body: parsedContent ?? content,
      headers: {
        "Content-Type":
          parsedContent === undefined ? "text/plain" : "application/json",
      },
    });
  }

  async writeBack(
    workspaceId: string,
    path: string,
    content: string
  ): Promise<void> {
    const response = await this.handleWriteback(workspaceId, path, content);
    if (response.status >= 400) {
      throw new Error(
        `Writeback failed with ${response.status}: ${JSON.stringify(response.data)}`
      );
    }
  }

  private resolveWebhookMapping(event: AdapterWebhook): WebhookMapping {
    for (const key of webhookLookupKeys(event)) {
      const mapping = this.spec.webhooks[key];
      if (mapping) {
        return mapping;
      }
    }

    throw new Error(
      `No webhook mapping for event ${event.eventType} / objectType ${event.objectType}`
    );
  }

  private async resolveConnectionId(context: {
    workspaceId: string;
    path: string;
    content: string;
    parsedContent?: unknown;
    match: MatchedWriteback;
  }): Promise<string> {
    const parsedContent = context.parsedContent;
    if (typeof parsedContent === "object" && parsedContent !== null) {
      const record = parsedContent as Record<string, unknown>;
      const direct = readString(record.connectionId);
      const metadata =
        typeof record.metadata === "object" && record.metadata !== null
          ? readString((record.metadata as Record<string, unknown>).connectionId)
          : undefined;
      if (direct || metadata) {
        return direct ?? metadata ?? "";
      }
    }

    if (this.resolveConnectionIdFn) {
      const resolved = await this.resolveConnectionIdFn(context);
      if (resolved.trim()) {
        return resolved.trim();
      }
    }

    if (this.defaultConnectionId?.trim()) {
      return this.defaultConnectionId.trim();
    }

    throw new Error(
      `Missing connection id for writeback ${context.path}. Configure defaultConnectionId or resolveConnectionId.`
    );
  }

  private resolveSyncInvocation(
    first: string,
    second: string | SchemaSyncOptions,
    third: SchemaSyncOptions
  ): {
    workspaceId: string;
    resourceName: string;
    options: SchemaSyncOptions;
  } {
    const resourceNames = Object.keys(this.spec.resources ?? {});
    if (typeof second === "string") {
      return { workspaceId: first, resourceName: second, options: third };
    }

    const options = second;
    const optionWorkspaceId = readString(options.workspaceId);
    const optionResourceName = readString(options.resourceName);
    if (resourceNames.includes(first) && optionWorkspaceId) {
      return {
        workspaceId: optionWorkspaceId,
        resourceName: first,
        options,
      };
    }

    const resourceName =
      optionResourceName ??
      (resourceNames.length === 1 ? resourceNames[0] : undefined);
    if (!resourceName) {
      throw new Error(
        "Missing resourceName for sync. Pass sync(workspaceId, resourceName, options) or options.resourceName."
      );
    }

    return { workspaceId: first, resourceName, options };
  }

  private resolveSyncConnectionId(
    resourceName: string,
    options: SchemaSyncOptions
  ): string {
    const direct = readString(options.connectionId);
    if (direct?.trim()) {
      return direct.trim();
    }

    if (this.defaultConnectionId?.trim()) {
      return this.defaultConnectionId.trim();
    }

    throw new Error(
      `Missing connection id for sync ${resourceName}. Configure defaultConnectionId or pass options.connectionId.`
    );
  }

  private async readSyncCheckpoint(
    workspaceId: string,
    path: string,
    signal?: AbortSignal
  ): Promise<SyncCheckpoint | undefined> {
    const reader = this.client as RelayFileClient & {
      readFile?: (
        workspaceId: string,
        path: string,
        correlationId?: string,
        signal?: AbortSignal
      ) => Promise<{ content: string }>;
    };
    if (!reader.readFile) {
      return undefined;
    }

    try {
      const file = await reader.readFile(workspaceId, path, undefined, signal);
      const parsed = safeJsonParse(file.content);
      return isRecord(parsed) ? (parsed as SyncCheckpoint) : undefined;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return undefined;
    }
  }

  private async writeSyncCheckpoint(
    workspaceId: string,
    path: string,
    checkpoint: SyncCheckpoint,
    signal?: AbortSignal
  ): Promise<void> {
    const baseRevision = await this.resolveBaseRevision(
      workspaceId,
      path,
      signal
    );
    await this.client.writeFile({
      workspaceId,
      path,
      baseRevision,
      content: `${JSON.stringify(checkpoint, null, 2)}\n`,
      contentType: "application/json",
      encoding: "utf-8",
      signal,
    });
  }

  private async resolveBaseRevision(
    workspaceId: string,
    path: string,
    signal?: AbortSignal
  ): Promise<string> {
    const reader = this.client as RelayFileClient & {
      readFile?: (
        workspaceId: string,
        path: string,
        correlationId?: string,
        signal?: AbortSignal
      ) => Promise<{ revision?: string }>;
    };
    if (!reader.readFile) {
      return "0";
    }

    try {
      const file = await reader.readFile(workspaceId, path, undefined, signal);
      return readString(file.revision) ?? "0";
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return "0";
    }
  }
}

interface SyncCheckpoint {
  adapter?: string;
  resourceName?: string;
  checkpointKey?: string;
  inputScope?: string;
  cursor?: string;
  nextCursor?: string | null;
  watermark?: string;
  updatedAt?: string;
  pagesSynced?: number;
  recordsSynced?: number;
}

interface LinkTarget {
  raw?: string;
  baseUrl?: string;
  endpoint: string;
  query: Record<string, string>;
}

interface PageRequest {
  query?: Record<string, string>;
  limit?: number;
}

const DEFAULT_SYNC_MAX_PAGES = 1000;

function webhookLookupKeys(event: AdapterWebhook): string[] {
  const eventRoot = event.eventType.split(".")[0] ?? event.eventType;
  return [...new Set([event.eventType, event.objectType, eventRoot])];
}

function parseEndpointDescriptor(value: string): {
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path: string;
} {
  const match = value.match(/^(DELETE|GET|PATCH|POST|PUT)\s+(\/.+)$/);
  if (!match) {
    throw new Error(`Invalid endpoint descriptor "${value}"`);
  }

  return {
    method: match[1] as "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
    path: match[2],
  };
}

function extractEndpointParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function extractWildcardValues(pattern: string, path: string): string[] {
  const wildcardRegex = pattern
    .split("*")
    .map(escapeRegex)
    .join("(.+?)");
  const regex = new RegExp(`^${wildcardRegex}$`);
  const match = path.match(regex);
  return match ? match.slice(1).map(decodeURIComponent) : [];
}

function interpolateEndpointParams(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (!value) {
      throw new Error(`Missing writeback parameter "${name}"`);
    }
    return encodeURIComponent(value);
  });
}

function buildSyncInput(options: SchemaSyncOptions): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (isRecord(options.input)) {
    Object.assign(input, options.input);
  }
  if (isRecord(options.params)) {
    Object.assign(input, options.params);
  }

  for (const [key, value] of Object.entries(options)) {
    if (!SYNC_OPTION_KEYS.has(key) && value !== undefined) {
      input[key] = value;
    }
  }

  return input;
}

function buildPageRequest(input: {
  baseQuery?: Record<string, unknown>;
  pagination?: PaginationConfig;
  cursor?: string;
  page: number;
  offset: number;
  limit?: number;
  watermark?: string;
  watermarkParamName?: string;
  linkTarget?: LinkTarget;
}): PageRequest {
  const query = {
    ...stringifyQuery(input.baseQuery),
    ...(input.linkTarget?.query ?? {}),
  };
  const limit = resolvePageSize(input.pagination, input.limit);

  if (input.watermark) {
    query[input.watermarkParamName ?? "since"] = input.watermark;
  }

  switch (input.pagination?.strategy) {
    case "cursor":
      if (input.cursor) {
        query[input.pagination.paramName ?? "cursor"] = input.cursor;
      }
      if (limit !== undefined) {
        query.limit = String(limit);
      }
      break;
    case "next-token":
      if (input.cursor) {
        query[input.pagination.paramName ?? "page_token"] = input.cursor;
      }
      if (limit !== undefined) {
        query.limit = String(limit);
      }
      break;
    case "offset":
      query[input.pagination.paramName ?? "offset"] = String(input.offset);
      if (limit !== undefined) {
        query[input.pagination.limitParamName ?? "limit"] = String(limit);
      }
      break;
    case "page":
      query[input.pagination.paramName ?? "page"] = String(input.page);
      if (limit !== undefined) {
        query[input.pagination.limitParamName ?? "limit"] = String(limit);
      }
      break;
    case "link-header":
    case undefined:
      if (limit !== undefined) {
        query.limit = String(limit);
      }
      break;
  }

  return {
    query: Object.keys(query).length > 0 ? query : undefined,
    limit,
  };
}

function resolveNextPage(input: {
  pagination?: PaginationConfig;
  response: ProxyResponse;
  recordsRead: number;
  page: number;
  offset: number;
  limit?: number;
  cursor?: string;
  maxPages?: number;
  pagesSynced: number;
  nextLinkTarget?: LinkTarget;
}): {
  hasNext: boolean;
  cursor: string | null;
  page?: number;
  offset?: number;
  linkTarget?: LinkTarget;
} {
  const stopForMaxPages =
    input.maxPages !== undefined &&
    input.pagesSynced >= input.maxPages;

  switch (input.pagination?.strategy) {
    case "cursor": {
      const nextCursor = stringifyScalar(
        readTemplateValue(input.response.data, input.pagination.cursorPath)
      );
      return {
        hasNext: Boolean(
          !stopForMaxPages && nextCursor && nextCursor !== input.cursor
        ),
        cursor: nextCursor ?? null,
      };
    }
    case "next-token": {
      const nextCursor = stringifyScalar(
        readTemplateValue(input.response.data, input.pagination.tokenPath)
      );
      return {
        hasNext: Boolean(
          !stopForMaxPages && nextCursor && nextCursor !== input.cursor
        ),
        cursor: nextCursor ?? null,
      };
    }
    case "offset": {
      const nextOffset = input.offset + input.recordsRead;
      const hasMore =
        input.recordsRead > 0 &&
        input.limit !== undefined &&
        input.limit > 0 &&
        input.recordsRead >= input.limit &&
        nextOffset > input.offset;
      const hasNext =
        !stopForMaxPages && hasMore;
      return {
        hasNext,
        cursor: hasMore ? String(nextOffset) : null,
        offset: nextOffset,
      };
    }
    case "page": {
      const nextPage = input.page + 1;
      const hasMore =
        input.recordsRead > 0 &&
        input.limit !== undefined &&
        input.limit > 0 &&
        input.recordsRead >= input.limit;
      const hasNext =
        !stopForMaxPages && hasMore;
      return {
        hasNext,
        cursor: hasMore ? String(nextPage) : null,
        page: nextPage,
      };
    }
    case "link-header": {
      const target = input.nextLinkTarget;
      return {
        hasNext:
          !stopForMaxPages &&
          target !== undefined &&
          target.raw !== input.cursor,
        cursor: target?.raw ?? null,
        linkTarget: target,
      };
    }
    case undefined:
      return { hasNext: false, cursor: null };
  }
}

function resolvePageSize(
  pagination: PaginationConfig | undefined,
  limit: number | undefined
): number | undefined {
  if (pagination?.strategy === "offset" || pagination?.strategy === "page") {
    return pagination.pageSize ?? limit;
  }
  return limit;
}

function syncPageSignature(
  pagination: PaginationConfig | undefined,
  records: unknown[]
): string | undefined {
  if (
    records.length === 0 ||
    (pagination?.strategy !== "offset" &&
      pagination?.strategy !== "page" &&
      pagination?.strategy !== "link-header")
  ) {
    return undefined;
  }

  return stableStringify(records);
}

function repeatedLinkHeaderTarget(
  pagination: PaginationConfig | undefined,
  target: LinkTarget | undefined,
  cursor: string | undefined
): string | undefined {
  if (pagination?.strategy !== "link-header" || !cursor) {
    return undefined;
  }

  return target?.raw === cursor ? cursor : undefined;
}

function extractSyncRecords(
  data: unknown,
  mapping: ResourceMapping
): unknown[] {
  if (!mapping.iterate) {
    return data === undefined || data === null ? [] : [data];
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (!isRecord(data)) {
    return [];
  }

  for (const key of ["items", "data", "results", "records"]) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeSyncRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function interpolateResourcePath(
  template: string,
  input: Record<string, unknown>
): string {
  return interpolateBracedTemplate(
    interpolateTemplate(template, input, { strict: true }),
    input,
    "resource path"
  );
}

function interpolateBracedTemplate(
  template: string,
  input: Record<string, unknown>,
  label: string
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
    const name = rawName.trim();
    const value = readTemplateValue(input, name);
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing ${label} parameter "${name}"`);
    }
    return encodePathValue(value);
  });
}

function resolveObjectId(
  record: Record<string, unknown>,
  cursorField: string | undefined,
  path: string
): string {
  for (const field of ["objectId", "object_id", "id", "uuid", "key"]) {
    const value = stringifyScalar(readTemplateValue(record, field));
    if (value) {
      return value;
    }
  }

  if (cursorField) {
    const value = stringifyScalar(readTemplateValue(record, cursorField));
    if (value) {
      return value;
    }
  }

  return path;
}

function checkpointCursor(
  checkpoint: SyncCheckpoint | undefined
): string | undefined {
  return (
    stringifyScalar(checkpoint?.cursor) ??
    stringifyScalar(checkpoint?.nextCursor)
  );
}

function advanceWatermark(
  current: string | undefined,
  candidate: unknown
): string | undefined {
  const value = stringifyScalar(candidate);
  if (!value) {
    return current;
  }
  if (!current) {
    return value;
  }

  const currentNumber = Number(current);
  const nextNumber = Number(value);
  if (Number.isFinite(currentNumber) && Number.isFinite(nextNumber)) {
    return nextNumber > currentNumber ? value : current;
  }

  return value > current ? value : current;
}

function parseNextLink(
  headers: Record<string, string> | undefined
): LinkTarget | undefined {
  const link = readHeader(headers, "link");
  if (!link) {
    return undefined;
  }

  for (const part of link.split(",")) {
    const target = part.match(/<([^>]+)>/);
    if (!target) {
      continue;
    }

    const params = part.slice((target.index ?? 0) + target[0].length).split(";");
    if (params.some((param) => isNextLinkRelation(param))) {
      return parseLinkTarget(target[1]);
    }
  }

  return undefined;
}

function isNextLinkRelation(value: string): boolean {
  const [rawName, rawValue] = value.split("=", 2);
  if (rawName?.trim().toLowerCase() !== "rel") {
    return false;
  }

  return rawValue?.trim().replace(/^"|"$/g, "").toLowerCase() === "next";
}

function parseLinkTarget(value: string): LinkTarget {
  try {
    const url = new URL(value, "https://relayfile.local");
    const query: Record<string, string> = {};
    url.searchParams.forEach((item, key) => {
      query[key] = item;
    });
    return {
      raw: value,
      baseUrl: value.startsWith("http") ? url.origin : undefined,
      endpoint: url.pathname,
      query,
    };
  } catch {
    return { raw: value, endpoint: value, query: {} };
  }
}

function stringifyQuery(
  input: Record<string, unknown> | undefined
): Record<string, string> {
  const query: Record<string, string> = {};
  if (!input) {
    return query;
  }

  for (const [key, value] of Object.entries(input)) {
    const scalar = stringifyScalar(value);
    if (scalar !== undefined) {
      query[key] = scalar;
    }
  }

  return query;
}

function stringifyScalar(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
}

function encodePathValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => encodePathValue(item)).join("/");
  }

  return encodeURIComponent(
    stringifyScalar(value) ?? JSON.stringify(value)
  );
}

function syncCheckpointPath(
  adapterName: string,
  resourceName: string,
  checkpointKey: string,
  inputScope: string
): string {
  return [
    ".sync-state",
    encodeCheckpointSegment(adapterName),
    encodeCheckpointSegment(resourceName),
    `${encodeCheckpointSegment(checkpointKey)}-${inputScope}.json`,
  ].join("/");
}

function checkpointScope(input: Record<string, unknown>): string {
  return hashString(stableStringify(input));
}

function encodeCheckpointSegment(value: string): string {
  return encodeURIComponent(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function readHeader(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }

  return undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    return undefined;
  }
  return number;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    return undefined;
  }
  return number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

const SYNC_OPTION_KEYS = new Set([
  "connectionId",
  "cursor",
  "input",
  "limit",
  "maxPages",
  "params",
  "query",
  "resourceName",
  "resume",
  "signal",
  "since",
  "sinceParamName",
  "watermark",
  "watermarkParamName",
  "workspaceId",
]);
