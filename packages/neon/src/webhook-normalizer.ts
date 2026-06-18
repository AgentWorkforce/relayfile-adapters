import { computeNeonPath, normalizeNangoNeonModel } from "./path-mapper.js";

export interface NormalizedNeonWebhook {
  eventType: string;
  path: string;
  payload: Record<string, unknown>;
}

export function normalizeNeonWebhook(): NormalizedNeonWebhook | null {
  return null;
}

export type NeonSyncDeltaAction = "ADDED" | "UPDATED";

export type NormalizedNeonSyncDeltaObjectType = "operation" | "endpoint" | "advisor-issue";

export interface NormalizedNeonSyncDelta {
  provider: "neon";
  eventType:
    | "operation.failed"
    | "operation.cancelled"
    | "operation.succeeded"
    | "endpoint.state_changed"
    | "advisor.issue_raised";
  objectType: NormalizedNeonSyncDeltaObjectType;
  objectId: string;
  path: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  metadata: {
    action: NeonSyncDeltaAction;
    firstSeenAt?: string;
    lastModifiedAt?: string;
    cursor?: string;
  };
}

type NeonSyncRecordMetadata = {
  last_action?: unknown;
  changedFields?: unknown;
  changed_fields?: unknown;
  fieldsChanged?: unknown;
  fields_changed?: unknown;
  previous?: unknown;
  previousValues?: unknown;
  previous_values?: unknown;
  before?: unknown;
  old?: unknown;
  firstSeenAt?: unknown;
  first_seen_at?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  lastModifiedAt?: unknown;
  last_modified_at?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
  syncedAt?: unknown;
  synced_at?: unknown;
  cursor?: unknown;
};

type NeonSyncTransitionEvidence = {
  previous?: unknown;
  current?: unknown;
  changedFields?: unknown;
  changed_fields?: unknown;
};

const FIELD_ALIASES: Record<string, string[]> = {
  id: ["id"],
  cache_key: ["cache_key", "cacheKey"],
  status: ["status"],
  current_state: ["current_state", "currentState"],
};

export function normalizeNeonSyncDelta(
  modelName: string,
  records: readonly Record<string, unknown>[],
): NormalizedNeonSyncDelta[] {
  if (!Array.isArray(records)) {
    return [];
  }

  const model = normalizeNangoNeonModel(modelName);
  if (model !== "operation" && model !== "endpoint" && model !== "advisor-issue") {
    return [];
  }

  const events: NormalizedNeonSyncDelta[] = [];
  for (const record of records) {
    const metadata = readMetadata(record);
    if (!metadata) {
      continue;
    }

    const action = normalizeAction(metadata.last_action);
    if (!action) {
      continue;
    }

    const payload = stripInternalMetadata(record);
    const firstSeenAt = readTimestamp(metadata.firstSeenAt, metadata.first_seen_at, metadata.createdAt, metadata.created_at);
    const lastModifiedAt = readTimestamp(
      metadata.lastModifiedAt,
      metadata.last_modified_at,
      metadata.updatedAt,
      metadata.updated_at,
      metadata.syncedAt,
      metadata.synced_at,
      record.updatedAt,
      record.updated_at,
      record.occurredAt,
      record.occurred_at,
      record.createdAt,
      record.created_at,
    );
    const occurredAt = lastModifiedAt ?? firstSeenAt;
    if (!occurredAt) {
      continue;
    }

    const event = normalizeRecordDelta(model, record, payload, metadata, action, {
      firstSeenAt,
      lastModifiedAt,
      occurredAt,
      cursor: readString(metadata.cursor),
    });
    if (event) {
      events.push(event);
    }
  }

  return events;
}

function normalizeRecordDelta(
  model: NormalizedNeonSyncDeltaObjectType,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  metadata: NeonSyncRecordMetadata,
  action: NeonSyncDeltaAction,
  timestamps: {
    firstSeenAt?: string;
    lastModifiedAt?: string;
    occurredAt: string;
    cursor?: string;
  },
): NormalizedNeonSyncDelta | null {
  if (model === "operation") {
    const objectId = readFieldString(record, "id");
    if (!objectId) return null;

    const status = readFieldString(record, "status")?.toLowerCase();
    if (
      status === "failed" &&
      (action === "ADDED" || hasTransitionEvidence(record, metadata, "status", "failed"))
    ) {
      return buildDelta("operation.failed", model, objectId, payload, action, timestamps);
    }
    if (
      status === "cancelled" &&
      (action === "ADDED" || hasTransitionEvidence(record, metadata, "status", "cancelled"))
    ) {
      return buildDelta("operation.cancelled", model, objectId, payload, action, timestamps);
    }
    if (
      action === "UPDATED" &&
      status === "finished" &&
      hasTransitionEvidence(record, metadata, "status", "finished")
    ) {
      return buildDelta("operation.succeeded", model, objectId, payload, action, timestamps);
    }
    return null;
  }

  if (model === "endpoint") {
    const objectId = readFieldString(record, "id");
    if (!objectId) return null;
    if (action !== "UPDATED") return null;
    const currentState = readFieldString(record, "current_state");
    if (!currentState) return null;
    if (!hasTransitionEvidence(record, metadata, "current_state", currentState)) return null;
    return buildDelta("endpoint.state_changed", model, objectId, payload, action, timestamps);
  }

  const objectId = readFieldString(record, "cache_key") ?? readFieldString(record, "id");
  if (!objectId) return null;
  if (action !== "ADDED") return null;
  return buildDelta("advisor.issue_raised", model, objectId, payload, action, timestamps);
}

function buildDelta(
  eventType: NormalizedNeonSyncDelta["eventType"],
  objectType: NormalizedNeonSyncDeltaObjectType,
  objectId: string,
  payload: Record<string, unknown>,
  action: NeonSyncDeltaAction,
  timestamps: {
    firstSeenAt?: string;
    lastModifiedAt?: string;
    occurredAt: string;
    cursor?: string;
  },
): NormalizedNeonSyncDelta {
  return {
    provider: "neon",
    eventType,
    objectType,
    objectId,
    path: computeNeonPath(objectType, objectId),
    occurredAt: timestamps.occurredAt,
    payload,
    metadata: {
      action,
      ...(timestamps.firstSeenAt ? { firstSeenAt: timestamps.firstSeenAt } : {}),
      ...(timestamps.lastModifiedAt ? { lastModifiedAt: timestamps.lastModifiedAt } : {}),
      ...(timestamps.cursor ? { cursor: timestamps.cursor } : {}),
    },
  };
}

function hasTransitionEvidence(
  record: Record<string, unknown>,
  metadata: NeonSyncRecordMetadata,
  field: "status" | "current_state",
  currentValue: string,
): boolean {
  const transition = readTransitionEvidence(record);
  if (changedFields(metadata, transition).has(field)) {
    return true;
  }

  const previous = readPreviousRecord(metadata, transition);
  if (!previous) {
    return false;
  }

  const previousValue = readFieldString(previous, field);
  return previousValue !== undefined && previousValue !== currentValue;
}

function changedFields(
  metadata: NeonSyncRecordMetadata,
  transition: NeonSyncTransitionEvidence | null,
): Set<string> {
  const values = [
    transition?.changedFields,
    transition?.changed_fields,
    metadata.changedFields,
    metadata.changed_fields,
    metadata.fieldsChanged,
    metadata.fields_changed,
  ];
  const fields = new Set<string>();
  for (const value of values) {
    for (const field of readStringArray(value)) {
      fields.add(normalizeFieldName(field));
    }
  }
  return fields;
}

function readPreviousRecord(
  metadata: NeonSyncRecordMetadata,
  transition: NeonSyncTransitionEvidence | null,
): Record<string, unknown> | null {
  const candidates = [
    transition?.previous,
    metadata.previous,
    metadata.previousValues,
    metadata.previous_values,
    metadata.before,
    metadata.old,
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readTransitionEvidence(record: Record<string, unknown>): NeonSyncTransitionEvidence | null {
  const transition = record._relayfile_transition;
  return isRecord(transition) ? transition : null;
}

function readMetadata(record: Record<string, unknown>): NeonSyncRecordMetadata | null {
  const metadata = record._nango_metadata;
  return isRecord(metadata) ? metadata : null;
}

function normalizeAction(action: unknown): NeonSyncDeltaAction | null {
  if (typeof action !== "string") {
    return null;
  }
  const normalized = action.trim().toUpperCase();
  return normalized === "ADDED" || normalized === "UPDATED" ? normalized : null;
}

function stripInternalMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...record };
  delete payload._nango_metadata;
  delete payload._relayfile_transition;
  return payload;
}

function readFieldString(record: Record<string, unknown>, field: keyof typeof FIELD_ALIASES): string | undefined {
  for (const alias of FIELD_ALIASES[field]) {
    const value = readString(record[alias]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeFieldName(field: string): string {
  const trimmed = field.trim();
  if (trimmed === "currentState") return "current_state";
  return trimmed.toLowerCase();
}

function readTimestamp(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    const text = readString(value);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
