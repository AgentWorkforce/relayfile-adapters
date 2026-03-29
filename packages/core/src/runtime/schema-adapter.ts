import {
  computeCanonicalPath,
  type ConnectionProvider,
  type FileSemantics,
  type ProxyResponse,
  type RelayFileClient,
} from "@relayfile/sdk";
import { minimatch } from "minimatch";
import { interpolateTemplate, pickFields } from "../spec/template.js";
import type {
  MappingSpec,
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

export interface AdapterWebhookMetadata {
  deliveryId?: string;
  delivery_id?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface AdapterWebhook {
  provider: string;
  connectionId?: string;
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
  metadata?: AdapterWebhookMetadata;
  raw?: unknown;
}

export interface IngestError {
  path: string;
  error: string;
}

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: IngestError[];
}

abstract class IntegrationAdapter {
  protected readonly client: RelayFileClient;
  protected readonly provider: ConnectionProvider;

  abstract readonly name: string;
  abstract readonly version: string;

  constructor(client: RelayFileClient, provider: ConnectionProvider) {
    this.client = client;
    this.provider = provider;
  }

  abstract ingestWebhook(workspaceId: string, event: AdapterWebhook): Promise<IngestResult>;
  abstract computePath(objectType: string, objectId: string): string;
  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;
  supportedEvents?(): string[];
}

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
}

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
