import { createHash } from "node:crypto";

export const STORAGE_BRIDGE_SOURCES = [
  "google-drive",
  "gcs",
  "sharepoint",
  "onedrive",
  "azure-blob",
  "dropbox",
  "gmail",
  "s3",
  "box",
  "postgres",
  "redis",
] as const;

export type StorageBridgeSource = (typeof STORAGE_BRIDGE_SOURCES)[number];

export const STORAGE_BRIDGE_CHANGE_TYPES = [
  "created",
  "updated",
  "deleted",
] as const;

export type StorageBridgeChangeType =
  (typeof STORAGE_BRIDGE_CHANGE_TYPES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue =
  | JsonPrimitive
  | JsonObject
  | readonly JsonValue[];

export type StorageBridgeMetadata = Record<string, JsonValue>;

export interface EventSummary {
  readonly title?: string;
  readonly status?: string;
  readonly priority?: string;
  readonly labels?: readonly string[];
  readonly actor?: {
    readonly id: string;
    readonly displayName?: string;
  };
  readonly fieldsChanged?: readonly string[];
  readonly tags?: readonly string[];
}

export interface StorageBridgeEvent {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly detectedAt: string;
  readonly source: StorageBridgeSource;
  readonly changeType: StorageBridgeChangeType;
  readonly relayfilePath: string;
  readonly resourceId: string;
  readonly sizeBytes: number | null;
  readonly fingerprint: string | null;
  readonly digest?: string;
  readonly metadata: StorageBridgeMetadata;
  readonly summary?: EventSummary;
  readonly workspaceId: string | null;
}

export type StorageBridgeEventForSource<Source extends StorageBridgeSource> =
  StorageBridgeEvent & {
    readonly source: Source;
  };

export interface StorageBridgeSourceMetadata {
  readonly source: StorageBridgeSource;
  readonly providerConfigKey?: string;
  readonly accountId?: string;
  readonly connectionId?: string;
  readonly subscriptionId?: string;
  readonly nativeEventId?: string;
  readonly cursor?: string;
  readonly raw?: JsonValue;
}

export interface CreateStorageBridgeEventInput<
  Source extends StorageBridgeSource = StorageBridgeSource,
> {
  readonly eventId?: string;
  readonly occurredAt?: string | Date;
  readonly detectedAt?: string | Date;
  readonly source: Source;
  readonly changeType: StorageBridgeChangeType;
  readonly relayfilePath: string;
  readonly resourceId: string;
  readonly sizeBytes?: number | null;
  readonly fingerprint?: string | null;
  readonly digest?: string;
  readonly metadata?: StorageBridgeMetadata;
  readonly summary?: EventSummary;
  readonly workspaceId?: string | null;
  readonly sourceMetadata?: Omit<StorageBridgeSourceMetadata, "source">;
}

export class StorageBridgeEventValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid StorageBridgeEvent: ${issues.join("; ")}`);
    this.name = "StorageBridgeEventValidationError";
    this.issues = issues;
  }
}

export function createStorageBridgeEvent<Source extends StorageBridgeSource>(
  input: CreateStorageBridgeEventInput<Source>,
): StorageBridgeEventForSource<Source> {
  const occurredAt = toIsoTimestamp(input.occurredAt ?? new Date());
  const detectedAt = toIsoTimestamp(input.detectedAt ?? new Date());
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.sourceMetadata
      ? {
          source: storageBridgeSourceMetadataToJson(
            createStorageBridgeSourceMetadata(input.source, input.sourceMetadata),
          ),
        }
      : {}),
  };
  const event: StorageBridgeEvent = {
    eventId:
      input.eventId ??
      buildStorageBridgeEventId({
        source: input.source,
        changeType: input.changeType,
        relayfilePath: input.relayfilePath,
        resourceId: input.resourceId,
        occurredAt,
        fingerprint: input.fingerprint ?? null,
      }),
    occurredAt,
    detectedAt,
    source: input.source,
    changeType: input.changeType,
    relayfilePath: input.relayfilePath,
    resourceId: input.resourceId,
    sizeBytes: input.sizeBytes ?? null,
    fingerprint: input.fingerprint ?? null,
    ...(input.digest?.trim()
      ? { digest: input.digest.trim() }
      : input.fingerprint?.trim()
        ? { digest: input.fingerprint.trim() }
        : {}),
    metadata,
    ...(input.summary
      ? { summary: input.summary }
      : { summary: buildDefaultSummary(input) }),
    workspaceId: input.workspaceId ?? null,
  };

  return validateStorageBridgeEvent(event) as StorageBridgeEventForSource<Source>;
}

export function createStorageBridgeSourceMetadata(
  source: StorageBridgeSource,
  metadata: Omit<StorageBridgeSourceMetadata, "source"> = {},
): StorageBridgeSourceMetadata {
  return compactObject({
    source,
    providerConfigKey: metadata.providerConfigKey,
    accountId: metadata.accountId,
    connectionId: metadata.connectionId,
    subscriptionId: metadata.subscriptionId,
    nativeEventId: metadata.nativeEventId,
    cursor: metadata.cursor,
    raw: metadata.raw,
  }) as unknown as StorageBridgeSourceMetadata;
}

export function storageBridgeSourceMetadataToJson(
  metadata: StorageBridgeSourceMetadata,
): Record<string, JsonValue> {
  return compactObject({
    source: metadata.source,
    providerConfigKey: metadata.providerConfigKey,
    accountId: metadata.accountId,
    connectionId: metadata.connectionId,
    subscriptionId: metadata.subscriptionId,
    nativeEventId: metadata.nativeEventId,
    cursor: metadata.cursor,
    raw: metadata.raw,
  }) as Record<string, JsonValue>;
}

export function storageBridgeWebhookEventType(
  changeType: StorageBridgeChangeType,
): "file.created" | "file.updated" | "file.deleted" {
  return `file.${changeType}` as "file.created" | "file.updated" | "file.deleted";
}

export function validateStorageBridgeEvent(
  value: unknown,
): StorageBridgeEvent {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new StorageBridgeEventValidationError(["event must be an object"]);
  }

  requireNonEmptyString(value, "eventId", issues);
  requireIsoTimestamp(value, "occurredAt", issues);
  requireIsoTimestamp(value, "detectedAt", issues);
  requireOneOf(value, "source", STORAGE_BRIDGE_SOURCES, issues);
  requireOneOf(value, "changeType", STORAGE_BRIDGE_CHANGE_TYPES, issues);
  requireAbsolutePath(value, "relayfilePath", issues);
  requireNonEmptyString(value, "resourceId", issues);

  if (value.sizeBytes !== null) {
    if (
      typeof value.sizeBytes !== "number" ||
      !Number.isFinite(value.sizeBytes) ||
      value.sizeBytes < 0
    ) {
      issues.push("sizeBytes must be a non-negative number or null");
    }
  }

  if (value.fingerprint !== null && typeof value.fingerprint !== "string") {
    issues.push("fingerprint must be a string or null");
  }

  if (
    value.digest !== undefined &&
    (typeof value.digest !== "string" || value.digest.trim().length === 0)
  ) {
    issues.push("digest must be a non-empty string when provided");
  }

  if (!isRecord(value.metadata)) {
    issues.push("metadata must be an object");
  }

  if (value.summary !== undefined && !isRecord(value.summary)) {
    issues.push("summary must be an object when provided");
  }

  if (value.workspaceId !== null && typeof value.workspaceId !== "string") {
    issues.push("workspaceId must be a string or null");
  }

  if (issues.length > 0) {
    throw new StorageBridgeEventValidationError(issues);
  }

  return value as unknown as StorageBridgeEvent;
}

export function isStorageBridgeEvent(value: unknown): value is StorageBridgeEvent {
  try {
    validateStorageBridgeEvent(value);
    return true;
  } catch {
    return false;
  }
}

export function buildStorageBridgeEventId(input: {
  readonly source: StorageBridgeSource;
  readonly changeType: StorageBridgeChangeType;
  readonly relayfilePath: string;
  readonly resourceId: string;
  readonly occurredAt: string;
  readonly fingerprint?: string | null;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.source,
        input.changeType,
        input.relayfilePath,
        input.resourceId,
        input.occurredAt,
        input.fingerprint ?? "",
      ].join("\0"),
    )
    .digest("hex")
    .slice(0, 32);

  return `${input.source}:${digest}`;
}

function buildDefaultSummary(
  input: CreateStorageBridgeEventInput,
): EventSummary {
  const title = summarizeRelayfilePath(input.relayfilePath);
  return {
    ...(title ? { title } : {}),
    status: input.changeType,
    tags: [input.source],
  };
}

function summarizeRelayfilePath(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed) {
    return undefined;
  }

  const segments = trimmed.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1] ?? trimmed;
  const normalized = leaf.replace(/\.json$/i, "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function toIsoTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new StorageBridgeEventValidationError(["timestamp is not a valid date"]);
  }
  return date.toISOString();
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
  value: Record<string, unknown>,
  key: string,
  issues: string[],
): void {
  if (typeof value[key] !== "string" || value[key].trim() === "") {
    issues.push(`${key} must be a non-empty string`);
  }
}

function requireAbsolutePath(
  value: Record<string, unknown>,
  key: string,
  issues: string[],
): void {
  if (typeof value[key] !== "string" || !value[key].startsWith("/")) {
    issues.push(`${key} must be an absolute relayfile path`);
  }
}

function requireIsoTimestamp(
  value: Record<string, unknown>,
  key: string,
  issues: string[],
): void {
  if (typeof value[key] !== "string" || Number.isNaN(Date.parse(value[key]))) {
    issues.push(`${key} must be an ISO timestamp string`);
  }
}

function requireOneOf<T extends readonly string[]>(
  value: Record<string, unknown>,
  key: string,
  allowed: T,
  issues: string[],
): void {
  if (typeof value[key] !== "string" || !allowed.includes(value[key] as T[number])) {
    issues.push(`${key} must be one of ${allowed.join(", ")}`);
  }
}
