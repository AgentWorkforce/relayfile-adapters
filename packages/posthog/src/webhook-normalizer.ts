import { computePostHogPath } from "./path-mapper.js";

type FileEventType = "file.created" | "file.updated";

export interface NormalizedPostHogWebhook {
  provider: "posthog";
  eventType: string;
  objectType: "alert-event";
  objectId: string;
  projectId: string;
  payload: Record<string, unknown>;
  record: Record<string, unknown>;
  fileEventType: FileEventType;
  shouldDelete: false;
  path: string;
  state?: "triggered" | "resolved";
  severity?: string;
  timestamp: string;
}

export function normalizePostHogWebhook(
  payload: Record<string, unknown>,
): NormalizedPostHogWebhook | null {
  const projectId =
    readIdentifier(payload.project_id) ?? readIdentifier(payload.projectId);
  const objectId =
    readIdentifier(payload.id) ?? readIdentifier(payload.alert_id);
  const explicitEventType =
    readString(payload.event_type) ??
    readString(payload.eventType) ??
    readString(payload.type);
  if (!projectId || !objectId) {
    return null;
  }

  const state = normalizeState(
    readString(payload.state) ??
      readString(payload.status) ??
      explicitEventType,
  );
  const eventType =
    explicitEventType ??
    (state === "resolved"
      ? "posthog.alert.resolved"
      : "posthog.alert.triggered");
  const timestamp =
    readString(payload.occurred_at) ??
    readString(payload.timestamp) ??
    new Date().toISOString();
  const title =
    readString(payload.title) ??
    readString(payload.name) ??
    `PostHog alert ${objectId}`;
  const severity = readString(payload.severity) ?? undefined;

  const record: Record<string, unknown> = {
    ...payload,
    id: objectId,
    project_id: projectId,
    source: "posthog",
    kind: "advisory",
    title,
    occurred_at: timestamp,
    event_type: eventType,
    ...(state ? { state } : {}),
    ...(severity ? { severity } : {}),
  };

  return {
    provider: "posthog",
    eventType,
    objectType: "alert-event",
    objectId,
    projectId,
    payload,
    record,
    fileEventType: state === "resolved" ? "file.updated" : "file.created",
    shouldDelete: false,
    path: computePostHogPath("alert-event", objectId, {
      projectId,
      displayName: title,
    }),
    ...(state ? { state } : {}),
    ...(severity ? { severity } : {}),
    timestamp,
  };
}

function normalizeState(
  value: string | undefined,
): "triggered" | "resolved" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized.includes("resolved") ||
    normalized.includes("closed")
  ) {
    return "resolved";
  }
  if (
    normalized.includes("trigger") ||
    normalized.includes("fire") ||
    normalized.includes("open")
  ) {
    return "triggered";
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readIdentifier(value: unknown): string | undefined {
  const text = readString(value);
  if (text) {
    return text;
  }
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}
