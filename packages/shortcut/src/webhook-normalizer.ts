import type { ShortcutWebhookAction } from "./types.js";

export const SHORTCUT_PROVIDER = "shortcut";

export const SHORTCUT_SUPPORTED_EVENTS = [
  "story.create",
  "story.update",
  "story.delete",
  "epic.create",
  "epic.update",
  "epic.delete",
] as const;

const NESTED_PARENT_TYPES: Readonly<Record<string, "story" | "epic">> = {
  "story-comment": "story",
  "story-link": "story",
  "story-task": "story",
  "epic-comment": "epic",
};

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
  /**
   * Valid Shortcut actions that do not produce a Relayfile trigger. These are
   * retained so callers can log an otherwise partial webhook delivery.
   *
   * Required, not optional: `normalizeShortcutWebhook` always populates it, and
   * a consumer reading the result must be able to rely on that. Adding it was
   * released as a breaking change (0.2.0) for anyone constructing this type
   * by hand.
   */
  skippedEventTypes: string[];
  headers: Record<string, string>;
  connectionId?: string;
  deliveryId?: string;
}

/**
 * Creates the error used when a Shortcut webhook contains actions but none
 * match the events this adapter supports.
 */
export function unsupportedShortcutWebhookEventError(unsupportedEventTypes: readonly string[]): Error {
  const [firstUnsupported] = unsupportedEventTypes;
  return new Error(
    `Unsupported Shortcut webhook event: ${firstUnsupported}; no supported actions; skipped event types: ${unsupportedEventTypes.join(", ")}`,
  );
}

export function normalizeShortcutWebhook(
  rawPayload: unknown,
  headers: ShortcutWebhookHeaders = {},
  options: { connectionId?: string; deliveryId?: string } = {},
): ShortcutNormalizedWebhook {
  const payload = asRecord(rawPayload);
  if (!payload) throw new Error("Shortcut webhook payload must be a JSON object");

  const normalizedHeaders = normalizeHeaders(headers);
  const skippedEventTypes: string[] = [];
  const actions = readActions(payload).flatMap((action) => {
    const objectType = String(action.entity_type ?? "").trim().toLowerCase();
    const verb = String(action.action ?? "").trim().toLowerCase();
    const objectId = String(action.id ?? "").trim();
    if (!objectType || !verb || !objectId) {
      throw new Error("Shortcut webhook action must include entity_type, action, and id");
    }
    const eventType = normalizeEventType(objectType, verb);
    if (!eventType) {
      skippedEventTypes.push(`${objectType}.${verb}`);
      return [];
    }
    return [{
      provider: SHORTCUT_PROVIDER as typeof SHORTCUT_PROVIDER,
      eventType,
      action: verb,
      objectType,
      objectId,
      payload: { ...payload, action: { ...action } },
      ...(options.connectionId ? { connectionId: options.connectionId } : {}),
      ...(options.deliveryId ? { deliveryId: options.deliveryId } : {}),
    }];
  });

  if (actions.length === 0 && skippedEventTypes.length > 0) {
    throw unsupportedShortcutWebhookEventError(skippedEventTypes);
  }

  return {
    provider: SHORTCUT_PROVIDER,
    eventId: readString(payload, "id"),
    changedAt: readString(payload, "changed_at"),
    actions,
    skippedEventTypes,
    headers: normalizedHeaders,
    ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    ...(options.deliveryId ? { deliveryId: options.deliveryId } : {}),
  };
}

function readActions(payload: Record<string, unknown>): ShortcutWebhookAction[] {
  const values = Array.isArray(payload.actions)
    ? payload.actions
    : payload.action === undefined
      ? []
      : [payload.action];
  return values.map((value) => {
    const record = asRecord(value);
    if (!record || !isWebhookAction(record)) {
      throw new Error("Shortcut webhook action must include id, entity_type, and action");
    }
    return record as ShortcutWebhookAction;
  });
}

function normalizeEventType(objectType: string, verb: string): string | undefined {
  const direct = `${objectType}.${verb}`;
  if ((SHORTCUT_SUPPORTED_EVENTS as readonly string[]).includes(direct)) return direct;
  const parentType = NESTED_PARENT_TYPES[objectType];
  if (parentType && ["create", "update", "delete"].includes(verb)) {
    return `${parentType}.update`;
  }
  return undefined;
}

function isWebhookAction(value: Record<string, unknown>): boolean {
  return (
    (typeof value.id === "string" || typeof value.id === "number") &&
    typeof value.entity_type === "string" &&
    value.entity_type.trim().length > 0 &&
    typeof value.action === "string" &&
    value.action.trim().length > 0
  );
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
