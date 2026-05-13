import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 80;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const record = resolvePrimaryRecord(payload);
  const title = truncateText(readString(record.event), MAX_TITLE_LENGTH);
  const subject = resolveSubject(record);
  const tags = limitTexts(subject ? [subject] : [], MAX_TAGS, MAX_TEXT_FIELD_LENGTH);
  const fieldsChanged = limitStrings(
    [readString(record.sg_event_id)].filter((value): value is string => Boolean(value)),
    MAX_FIELDS_CHANGED,
  );

  return finalizeSummary({
    ...(title ? { title } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
  });
}

function resolvePrimaryRecord(payload: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(payload)) {
    return readRecord(payload[0]) ?? {};
  }

  const events = readArray(payload.events);
  if (events.length > 0) {
    return readRecord(events[0]) ?? {};
  }

  return payload;
}

function resolveSubject(record: Record<string, unknown>): string | undefined {
  const mail = readRecord(record.mail);
  const personalizations = readArray(mail?.personalizations);
  const firstPersonalization = readRecord(personalizations[0]);
  return (
    readString(record.subject)
    ?? readString(mail?.subject)
    ?? readString(firstPersonalization?.subject)
  );
}

function finalizeSummary(summary: EventSummary): EventSummary {
  const next: EventSummary = {
    ...summary,
    ...(summary.fieldsChanged ? { fieldsChanged: [...summary.fieldsChanged] } : {}),
    ...(summary.tags ? { tags: [...summary.tags] } : {}),
  };

  while (JSON.stringify(next).length >= MAX_SUMMARY_JSON_LENGTH) {
    if (trimArray(next, 'fieldsChanged')) continue;
    if (trimArray(next, 'tags')) continue;
    if (trimText(next, 'title', 24)) continue;
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

function trimText(summary: EventSummary, key: 'title', minLength: number): boolean {
  const current = summary[key];
  if (typeof current !== 'string') {
    return false;
  }

  if (current.length <= minLength) {
    delete summary[key];
    return true;
  }

  const nextValue = truncateText(current, Math.max(minLength, current.length - 16));
  if (nextValue) {
    summary[key] = nextValue;
  } else {
    delete summary[key];
  }
  return true;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function limitTexts(values: string[], max: number, maxLength: number): string[] {
  const output: string[] = [];
  for (const value of values) {
    const normalized = truncateText(value, maxLength);
    if (!normalized || output.includes(normalized)) continue;
    output.push(normalized);
    if (output.length >= max) break;
  }
  return output;
}

function redactFreeText(value: string): string {
  return value
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
