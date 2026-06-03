import { computeDaytonaPath } from "./path-mapper.js";
import { DAYTONA_WEBHOOK_EVENTS, type DaytonaWebhookEvent } from "./types.js";

export type DaytonaWebhookObjectType = "sandbox" | "snapshot" | "volume";

export interface NormalizedDaytonaWebhook {
  provider: "daytona";
  eventType: DaytonaWebhookEvent;
  objectType: DaytonaWebhookObjectType;
  objectId: string;
  organizationId: string;
  timestamp: string;
  state?: string;
  payload: Record<string, unknown>;
  fileEventType: "file.created" | "file.updated" | "file.deleted";
  shouldDelete: boolean;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readObjectId(payload: Record<string, unknown>): string | undefined {
  return (
    readString(payload.id) ??
    readString(payload.sandboxId) ??
    readString(payload.snapshotId) ??
    readString(payload.volumeId) ??
    readString(payload.objectId) ??
    readString(payload.resourceId) ??
    readString(readNestedRecord(payload, "sandbox")?.id) ??
    readString(readNestedRecord(payload, "snapshot")?.id) ??
    readString(readNestedRecord(payload, "volume")?.id)
  );
}

function readOrganizationId(payload: Record<string, unknown>): string | undefined {
  return (
    readString(payload.organizationId) ??
    readString(payload.organization_id) ??
    readString(payload.organizationID) ??
    readString(payload.orgId) ??
    readString(readNestedRecord(payload, "organization")?.id) ??
    readString(readNestedRecord(payload, "organization")?.organizationId)
  );
}

function readNestedRecord(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = payload[key];
  return isRecord(value) ? value : undefined;
}

function readTimestamp(payload: Record<string, unknown>): string {
  return (
    readString(payload.timestamp) ??
    readString(payload.createdAt) ??
    readString(payload.created_at) ??
    readString(payload.updatedAt) ??
    readString(payload.updated_at) ??
    new Date().toISOString()
  );
}

function readState(payload: Record<string, unknown>): string | undefined {
  return (
    readString(payload.newState) ??
    readString(payload.new_state) ??
    readString(payload.state) ??
    readString(readNestedRecord(payload, "sandbox")?.state) ??
    readString(readNestedRecord(payload, "snapshot")?.state) ??
    readString(readNestedRecord(payload, "volume")?.state)
  );
}

function readEvent(payload: Record<string, unknown>): DaytonaWebhookEvent | null {
  const candidate = readString(payload.event) ?? readString(payload.eventType);
  if (!candidate) {
    return null;
  }
  const normalized = candidate.toLowerCase().trim() as DaytonaWebhookEvent;
  return DAYTONA_WEBHOOK_EVENTS.includes(normalized) ? normalized : null;
}

function objectTypeFromEvent(eventType: DaytonaWebhookEvent): DaytonaWebhookObjectType {
  return eventType.split(".", 1)[0] as DaytonaWebhookObjectType;
}

export function normalizeDaytonaWebhook(
  payload: unknown,
  headers: Record<string, unknown> = {},
): NormalizedDaytonaWebhook | null {
  const body = isRecord(payload) ? payload : {};
  const eventType = readEvent(body);
  if (!eventType) {
    return null;
  }

  const objectType = objectTypeFromEvent(eventType);
  const objectId = readObjectId(body);
  const organizationId = readOrganizationId(body);
  if (!objectId || !organizationId) {
    return null;
  }

  const state = readState(body);
  const shouldDelete = eventType === "snapshot.removed";
  const fileEventType = shouldDelete
    ? "file.deleted"
    : eventType.endsWith(".created")
      ? "file.created"
      : "file.updated";

  return {
    provider: "daytona",
    eventType,
    objectType,
    objectId,
    organizationId,
    timestamp: readTimestamp(body),
    ...(state ? { state } : {}),
    payload: body,
    fileEventType,
    shouldDelete,
    path: computeDaytonaPath(objectType, objectId),
  };
}
