import { computeGcpPath } from "./path-mapper.js";
import { GCP_WEBHOOK_EVENTS, type GcpWebhookEvent } from "./types.js";

export type GcpWebhookObjectType = "monitoring-alert";

export interface NormalizedGcpWebhook {
  provider: "gcp";
  eventType: GcpWebhookEvent;
  objectType: GcpWebhookObjectType;
  objectId: string;
  policyId: string;
  displayName: string;
  conditionName?: string;
  resourceName?: string;
  state: "open" | "closed";
  firing: boolean;
  timestamp: string;
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

function readNestedRecord(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = payload[key];
  return isRecord(value) ? value : undefined;
}

/**
 * GCP Monitoring alert notifications arrive via Pub/Sub -> an HTTP push
 * subscription. The body carries an `incident` object with:
 * `incident.policy_name`, `incident.state` (open|closed), `incident.condition_name`,
 * `incident.started_at`, `incident.resource_name`.
 */
function readState(incident: Record<string, unknown>): "open" | "closed" | undefined {
  const raw = readString(incident.state)?.toLowerCase();
  if (raw === "open" || raw === "closed") {
    return raw;
  }
  return undefined;
}

/** Derive the policy id (last path segment) from incident.policy_name. */
function readPolicyId(incident: Record<string, unknown>): string | undefined {
  const policyName =
    readString(incident.policy_name) ??
    readString(incident.policyName) ??
    readString(incident.policy_user_label) ??
    readString(incident.condition_name);
  if (!policyName) {
    return undefined;
  }
  const segments = policyName.split("/").filter(Boolean);
  return segments.at(-1) ?? policyName;
}

function unwrapPubSubEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  const message = payload.message;
  if (!isRecord(message)) {
    return payload;
  }
  const data = readString(message.data);
  if (!data) {
    return payload;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as unknown;
    return isRecord(parsed) ? parsed : payload;
  } catch {
    return payload;
  }
}

function readDisplayName(incident: Record<string, unknown>): string | undefined {
  return (
    readString(incident.policy_name) ??
    readString(incident.condition_name) ??
    readString(incident.summary)
  );
}

function readTimestamp(incident: Record<string, unknown>): string {
  const seconds =
    typeof incident.started_at === "number"
      ? incident.started_at
      : typeof incident.ended_at === "number"
        ? incident.ended_at
        : undefined;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return new Date(seconds * 1000).toISOString();
  }
  return (
    readString(incident.started_at) ??
    readString(incident.ended_at) ??
    new Date().toISOString()
  );
}

export function normalizeGcpWebhook(
  payload: unknown,
  _headers: Record<string, unknown> = {},
): NormalizedGcpWebhook | null {
  const body = unwrapPubSubEnvelope(isRecord(payload) ? payload : {});
  const incident = readNestedRecord(body, "incident") ?? body;

  const state = readState(incident);
  if (!state) {
    return null;
  }

  const policyId = readPolicyId(incident);
  if (!policyId) {
    return null;
  }

  const eventType: GcpWebhookEvent =
    state === "open" ? "monitoring.incident.open" : "monitoring.incident.closed";
  if (!GCP_WEBHOOK_EVENTS.includes(eventType)) {
    return null;
  }

  const displayName = readDisplayName(incident) ?? policyId;
  const conditionName = readString(incident.condition_name);
  const resourceName = readString(incident.resource_name);
  const firing = state === "open";
  const fileEventType = firing ? "file.created" : "file.updated";

  return {
    provider: "gcp",
    eventType,
    objectType: "monitoring-alert",
    objectId: policyId,
    policyId,
    displayName,
    ...(conditionName ? { conditionName } : {}),
    ...(resourceName ? { resourceName } : {}),
    state,
    firing,
    timestamp: readTimestamp(incident),
    payload: body,
    fileEventType,
    shouldDelete: false,
    path: computeGcpPath("monitoring-alert", policyId),
  };
}
