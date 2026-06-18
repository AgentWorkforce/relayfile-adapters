import { computeCloudflarePath } from "./path-mapper.js";

type FileEventType = "file.created" | "file.updated";

export interface NormalizedCloudflareWebhook {
  provider: "cloudflare";
  eventType: string;
  objectType: "notification-event";
  objectId: string;
  payload: Record<string, unknown>;
  fileEventType: FileEventType;
  shouldDelete: false;
  path: string;
  alertType: string;
  alertEvent?: string;
  state?: "active" | "resolved";
  zoneId?: string;
  zoneName?: string;
  policyId?: string;
  policyName?: string;
  correlationId?: string;
  timestamp: string;
  text?: string;
}

export function normalizeCloudflareWebhook(
  payload: Record<string, unknown>,
): NormalizedCloudflareWebhook | null {
  const alertType = readString(payload.alert_type);
  if (!alertType) {
    return null;
  }
  const correlationId = readString(payload.alert_correlation_id);
  const policyId = readString(payload.policy_id);
  const alertEvent = readString(payload.alert_event);
  const objectId =
    correlationId ??
    [alertType, policyId, String(payload.ts ?? Date.now())].filter(Boolean).join(":");
  const data = asRecord(payload.data) ?? {};
  const zoneId = readString(data.zone_tag);
  const zoneName = readString(data.zone_name);
  const state = normalizeAlertState(alertEvent);

  return {
    provider: "cloudflare",
    eventType: alertType,
    objectType: "notification-event",
    objectId,
    payload,
    fileEventType: state === "resolved" ? "file.updated" : "file.created",
    shouldDelete: false,
    path: computeCloudflarePath("notification-event", objectId),
    alertType,
    ...(alertEvent ? { alertEvent } : {}),
    ...(state ? { state } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(zoneName ? { zoneName } : {}),
    ...(policyId ? { policyId } : {}),
    ...(readString(payload.policy_name) ? { policyName: readString(payload.policy_name) } : {}),
    ...(correlationId ? { correlationId } : {}),
    timestamp: normalizeTimestamp(payload.ts),
    ...(readString(payload.text) ? { text: readString(payload.text) } : {}),
  };
}

function normalizeAlertState(
  alertEvent: string | undefined,
): "active" | "resolved" | undefined {
  const normalized = alertEvent?.toUpperCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.endsWith("END")) {
    return "resolved";
  }
  if (normalized.endsWith("START")) {
    return "active";
  }
  return undefined;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
