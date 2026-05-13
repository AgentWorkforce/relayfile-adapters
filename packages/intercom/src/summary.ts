import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_TITLE_LENGTH = 80;
const MAX_TEXT_FIELD_LENGTH = 80;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const conversation = resolveConversation(payload);
  const title = truncateText(resolveConversationMessage(conversation), MAX_TITLE_LENGTH);
  const status = truncateText(readString(conversation.state), MAX_TEXT_FIELD_LENGTH);

  return finalizeSummary({
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
  });
}

function resolveConversation(payload: Record<string, unknown>): Record<string, unknown> {
  const item = readRecord(payload.item) ?? readRecord(readRecord(payload.data)?.item);
  if (item) {
    return item;
  }
  return payload;
}

function resolveConversationMessage(conversation: Record<string, unknown>): string | undefined {
  const source = readRecord(conversation.source);
  const parts = readArray(readRecord(conversation.conversation_parts)?.data);

  return (
    readString(source?.body)
    ?? readString(source?.subject)
    ?? readString(readRecord(parts[0])?.body)
  );
}

function finalizeSummary(summary: EventSummary): EventSummary {
  const next: EventSummary = { ...summary };

  while (JSON.stringify(next).length >= MAX_SUMMARY_JSON_LENGTH) {
    if (trimText(next, 'title', 24)) continue;
    if (trimText(next, 'status', 16)) continue;
    break;
  }

  return next;
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
