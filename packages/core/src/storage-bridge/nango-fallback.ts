import {
  type CreateStorageBridgeEventInput,
  type JsonValue,
  type StorageBridgeChangeType,
  type StorageBridgeEvent,
  type StorageBridgeSource,
  buildStorageBridgeEventId,
  createStorageBridgeEvent,
} from "./event.js";

export const NANGO_FALLBACK_PROVIDER_CONFIG_KEYS = [
  "google-drive",
  "sharepoint-online",
  "sharepoint",
  "one-drive",
  "onedrive",
  "dropbox",
  "box",
  "google-mail",
  "gmail",
] as const;

export type NangoFallbackProviderConfigKey =
  (typeof NANGO_FALLBACK_PROVIDER_CONFIG_KEYS)[number];

export interface NangoSyncWebhookPayload {
  readonly providerConfigKey: string;
  readonly connectionId?: string;
  readonly syncName?: string;
  readonly model?: string;
  readonly responseResults?: {
    readonly added?: number;
    readonly updated?: number;
    readonly deleted?: number;
  };
  readonly records?: readonly NangoSyncRecord[];
  readonly modifiedAfter?: string;
  readonly metadata?: Record<string, JsonValue>;
}

export type NangoSyncRecord = Record<string, unknown>;

export interface MapNangoSyncRecordInput {
  readonly providerConfigKey: string;
  readonly record: NangoSyncRecord;
  readonly workspaceId?: string | null;
  readonly accountId?: string;
  readonly connectionId?: string;
  readonly syncName?: string;
  readonly detectedAt?: string | Date;
}

export function mapNangoProviderToSource(
  providerConfigKey: string,
): StorageBridgeSource {
  switch (providerConfigKey) {
    case "google-drive":
      return "google-drive";
    case "sharepoint":
    case "sharepoint-online":
      return "sharepoint";
    case "one-drive":
    case "onedrive":
      return "onedrive";
    case "dropbox":
      return "dropbox";
    case "box":
      return "box";
    case "google-mail":
    case "gmail":
      return "gmail";
    default:
      throw new Error(`Unsupported Nango providerConfigKey "${providerConfigKey}"`);
  }
}

export function mapNangoSyncRecord(
  input: MapNangoSyncRecordInput,
): StorageBridgeEvent {
  const source = mapNangoProviderToSource(input.providerConfigKey);
  const resourceId = computeResourceId(source, input.record);
  const relayfilePath = computeRelayfilePath({
    source,
    record: input.record,
    accountId: input.accountId ?? input.connectionId ?? "default",
  });
  const occurredAt = readString(input.record, "updatedAt") ??
    readString(input.record, "updated_at") ??
    readString(input.record, "modifiedTime") ??
    readString(input.record, "lastModifiedDateTime") ??
    new Date().toISOString();
  const changeType = computeNangoChangeType(input.record);
  const fingerprint =
    readString(input.record, "etag") ??
    readString(input.record, "eTag") ??
    readString(input.record, "rev") ??
    readString(input.record, "sha1") ??
    null;
  const sizeBytes =
    readNumber(input.record, "size") ??
    readNumber(input.record, "sizeBytes") ??
    null;

  const eventInput: CreateStorageBridgeEventInput = {
    eventId: buildStorageBridgeEventId({
      source,
      changeType,
      relayfilePath,
      resourceId,
      occurredAt,
      fingerprint,
    }),
    occurredAt,
    detectedAt: input.detectedAt,
    source,
    changeType,
    relayfilePath,
    resourceId,
    sizeBytes,
    fingerprint,
    workspaceId: input.workspaceId ?? null,
    metadata: {
      nango: toJsonObject({
        providerConfigKey: input.providerConfigKey,
        connectionId: input.connectionId,
        syncName: input.syncName,
        record: sanitizeJson(input.record),
      }),
    },
    sourceMetadata: {
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
      accountId: input.accountId,
      raw: sanitizeJson(input.record),
    },
  };

  return createStorageBridgeEvent(eventInput);
}

export function computeResourceId(
  source: StorageBridgeSource,
  record: NangoSyncRecord,
): string {
  const direct =
    readString(record, "id") ??
    readString(record, "fileId") ??
    readString(record, "itemId") ??
    readString(record, "threadId") ??
    readString(record, "messageId") ??
    readString(record, "path_lower") ??
    readString(record, "path") ??
    readString(record, "name");
  if (direct) return direct;

  const stableRecord = JSON.stringify(sanitizeJson(record));
  if (stableRecord && stableRecord !== "{}") {
    return `${source}:${stableRecord}`;
  }

  throw new Error(`Cannot compute resource id for ${source} Nango record`);
}

export function computeRelayfilePath(input: {
  readonly source: StorageBridgeSource;
  readonly record: NangoSyncRecord;
  readonly accountId: string;
}): string {
  const { source, record, accountId } = input;
  switch (source) {
    case "google-drive": {
      const id = encodeSegment(computeResourceId(source, record));
      const filePath = readString(record, "path") ?? readString(record, "name");
      return filePath
        ? `/google-drive/${encodeSegment(accountId)}/${trimLeadingSlash(filePath)}`
        : `/google-drive/${encodeSegment(accountId)}/files/${id}.json`;
    }
    case "sharepoint": {
      const siteId = encodeSegment(readString(record, "siteId") ?? "default-site");
      const driveId = encodeSegment(readString(record, "driveId") ?? "default-drive");
      const id = encodeSegment(computeResourceId(source, record));
      return `/sharepoint/${siteId}/${driveId}/items/${id}.json`;
    }
    case "onedrive": {
      const id = encodeSegment(computeResourceId(source, record));
      return `/onedrive/${encodeSegment(accountId)}/items/${id}.json`;
    }
    case "dropbox": {
      const path =
        readString(record, "path_display") ??
        readString(record, "path_lower") ??
        readString(record, "path") ??
        `${computeResourceId(source, record)}.json`;
      return `/dropbox/${encodeSegment(accountId)}/files/${trimLeadingSlash(path)}`;
    }
    case "box": {
      const id = encodeSegment(computeResourceId(source, record));
      return `/box/files/${id}.json`;
    }
    case "gmail": {
      const threadId = encodeSegment(
        readString(record, "threadId") ?? computeResourceId(source, record),
      );
      return `/gmail/${encodeSegment(accountId)}/threads/${threadId}.json`;
    }
    default:
      throw new Error(`Nango fallback is not supported for ${source}`);
  }
}

function computeNangoChangeType(record: NangoSyncRecord): StorageBridgeChangeType {
  const deleted =
    readBoolean(record, "deleted") ??
    readBoolean(record, "_deleted") ??
    readBoolean(record, "isDeleted");
  if (deleted) return "deleted";
  const createdAt = readString(record, "createdAt") ?? readString(record, "created_at");
  const updatedAt = readString(record, "updatedAt") ?? readString(record, "updated_at");
  return createdAt && updatedAt && createdAt === updatedAt ? "created" : "updated";
}

function readString(record: NangoSyncRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(record: NangoSyncRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: NangoSyncRecord, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function trimLeadingSlash(path: string): string {
  return path.replace(/^\/+/, "");
}

function toJsonObject(input: Record<string, unknown>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, sanitizeJson(value)]),
  );
}

function sanitizeJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (typeof value === "object" && value !== null) {
    return toJsonObject(value as Record<string, unknown>);
  }
  return String(value);
}
