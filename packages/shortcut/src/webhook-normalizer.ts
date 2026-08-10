import type { ShortcutWebhookAction } from "./types.js";

export const SHORTCUT_PROVIDER = "shortcut";

export interface ShortcutWebhookHeaders {
  [key: string]: string | number | boolean | readonly string[] | null | undefined;
}

export interface ShortcutNormalizedWebhookAction {
  provider: typeof SHORTCUT_PROVIDER;
  eventType: string;
  action: "create" | "update" | "delete" | string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
  connectionId?: string;
  deliveryId?: string;
}

export interface ShortcutNormalizedWebhook {
  provider: typeof SHORTCUT_PROVIDER;
  eventId?: string;
  changedAt?: string;
  actions: ShortcutNormalizedWebhookAction[];
  headers: Record<string, string>;
  connectionId?: string;
  deliveryId?: string;
}

export function normalizeShortcutWebhook(
  rawPayload: unknown,
  headers: ShortcutWebhookHeaders = {},
  options: { connectionId?: string; deliveryId?: string } = {},
): ShortcutNormalizedWebhook {
  const payload = asRecord(rawPayload);
  if (!payload) throw new Error("Shortcut webhook payload must be a JSON object");

  const normalizedHeaders = normalizeHeaders(headers);
  const actions = readActions(payload).map((action) => {
    const objectType = String(action.entity_type ?? "").trim().toLowerCase();
    const verb = String(action.action ?? "").trim().toLowerCase();
    const objectId = String(action.id ?? "").trim();
    if (!objectType || !verb || !objectId) {
      throw new Error("Shortcut webhook action must include entity_type, action, and id");
    }
    return {
      provider: SHORTCUT_PROVIDER as typeof SHORTCUT_PROVIDER,
      eventType: `${objectType}.${verb}`,
      action: verb,
      objectType,
      objectId,
      payload: { ...payload, action: { ...action } },
      ...(options.connectionId ? { connectionId: options.connectionId } : {}),
      ...(options.deliveryId ? { deliveryId: options.deliveryId } : {}),
    };
  });

  return {
    provider: SHORTCUT_PROVIDER,
    eventId: readString(payload, "id"),
    changedAt: readString(payload, "changed_at"),
    actions,
    headers: normalizedHeaders,
    ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    ...(options.deliveryId ? { deliveryId: options.deliveryId } : {}),
  };
}

function readActions(payload: Record<string, unknown>): ShortcutWebhookAction[] {
  if (Array.isArray(payload.actions)) {
    return payload.actions.filter((value): value is ShortcutWebhookAction => {
      const record = asRecord(value);
      return Boolean(record && (typeof record.id === "string" || typeof record.id === "number") && typeof record.entity_type === "string" && typeof record.action === "string");
    });
  }
  const single = asRecord(payload.action);
  if (single && (typeof single.id === "string" || typeof single.id === "number")) {
    return [single as ShortcutWebhookAction];
  }
  return [];
}

function normalizeHeaders(headers: ShortcutWebhookHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") result[key.toLowerCase()] = value;
    else if (typeof value === "number" || typeof value === "boolean") result[key.toLowerCase()] = String(value);
  }
  return result;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] as string : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
