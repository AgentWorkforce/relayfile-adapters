import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 80;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const data = readRecord(payload.data);
  const event = readRecord(payload._stripe_event);
  const object = readRecord(data?.object) ?? payload;
  const title = truncateText(readString(object.description), MAX_TITLE_LENGTH);
  const status = truncateText(
    readString(object.status) ?? readString(payload.type) ?? readString(event?.eventType),
    MAX_TEXT_FIELD_LENGTH,
  );
  const fieldsChanged = limitStrings(
    Object.keys(readRecord(data?.previous_attributes) ?? readRecord(event?.previousAttributes) ?? {}),
    MAX_FIELDS_CHANGED,
  );
  const actor = buildActor(payload, event, object);
  const tags = limitStrings(
    [
      ...(readString(object.object) ? [`object:${readString(object.object)}`] : []),
      ...(readString(payload.type) ? [`event:${readString(payload.type)}`] : []),
      ...(readString(event?.eventType) ? [`event:${readString(event?.eventType)}`] : []),
    ],
    MAX_TAGS,
  );

  return finalizeSummary({
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(actor ? { actor } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  });
}

function buildActor(
  payload: Record<string, unknown>,
  event: Record<string, unknown> | undefined,
  object: Record<string, unknown>,
): EventSummary['actor'] | undefined {
  const id =
    readString(readRecord(payload.request)?.id)
    ?? readString(readRecord(event?.request)?.id)
    ?? readString(payload.account)
    ?? readString(object.account);
  if (!id) {
    return undefined;
  }

  return { id };
}

function finalizeSummary(summary: EventSummary): EventSummary {
  const next: EventSummary = {
    ...summary,
    ...(summary.actor ? { actor: { ...summary.actor } } : {}),
    ...(summary.fieldsChanged ? { fieldsChanged: [...summary.fieldsChanged] } : {}),
    ...(summary.tags ? { tags: [...summary.tags] } : {}),
  };

  while (JSON.stringify(next).length >= MAX_SUMMARY_JSON_LENGTH) {
    if (trimArray(next, 'fieldsChanged')) continue;
    if (trimArray(next, 'tags')) continue;
    if (next.actor) {
      delete next.actor;
      continue;
    }
    if (trimText(next, 'title', 24)) continue;
    if (trimText(next, 'status', 16)) continue;
    break;
  }

  return next;
}

function trimArray(summary: EventSummary, key: 'fieldsChanged' | 'tags'): boolean {
  const current = summary[key];
  if (!current || current.length === 0) {
    return false;
  }

  if (current.length === 1) {
    delete summary[key];
    return true;
  }

  summary[key] = current.slice(0, -1);
  return true;
}

function trimText(summary: EventSummary, key: 'title' | 'status', minLength: number): boolean {
  const current = summary[key];
  if (typeof current !== 'string') {
    return false;
  }

  if (current.length <= minLength) {
    delete summary[key];
    return true;
  }

  const nextLength = Math.max(minLength, current.length - 16);
  const nextValue = truncateText(current, nextLength);
  if (nextValue) {
    summary[key] = nextValue;
  } else {
    delete summary[key];
  }
  return true;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function limitStrings(values: string[], max: number): string[] {
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || output.includes(normalized)) continue;
    output.push(normalized);
    if (output.length >= max) break;
  }
  return output;
}

function redactCardLikeNumbers(value: string): string {
  return value.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 ? '[redacted-card]' : match;
  });
}

function redactFreeText(value: string): string {
  return redactCardLikeNumbers(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
    .replace(/\b\d{9,}\b/g, '[redacted-number]');
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = redactFreeText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
