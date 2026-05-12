import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_TITLE_LENGTH = 120;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const data = readRecord(payload.data) ?? payload;
  const distinctId =
    readString(readRecord(data.properties)?.distinct_id)
    ?? readString(readRecord(data.properties)?.$distinct_id)
    ?? readString(data.distinct_id)
    ?? readString(data.$distinct_id);
  const title = truncateText(stripDistinctId(
    readString(data.event) ?? readString(data.name) ?? readString(payload.event) ?? readString(payload.name),
    distinctId,
  ), MAX_TITLE_LENGTH);

  return finalizeSummary({
    ...(title ? { title } : {}),
  });
}

function stripDistinctId(value: string | undefined, distinctId: string | undefined): string | undefined {
  if (!value || !distinctId) {
    return value;
  }

  const escaped = distinctId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = value.replace(new RegExp(escaped, 'g'), ' ').replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function finalizeSummary(summary: EventSummary): EventSummary {
  const next: EventSummary = { ...summary };

  while (JSON.stringify(next).length >= MAX_SUMMARY_JSON_LENGTH) {
    if (trimText(next, 'title', 24)) continue;
    break;
  }

  return next;
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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
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
