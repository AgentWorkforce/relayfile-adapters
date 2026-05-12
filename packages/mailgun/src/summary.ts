import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_TAGS = 8;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const eventData =
    readRecord(payload.eventData)
    ?? readRecord(payload['event-data'])
    ?? readRecord(payload.data)
    ?? payload;
  const eventType = readString(eventData.event) ?? readString(payload.event);
  const status =
    readString(eventData.severity)
    ?? readString(readRecord(eventData.delivery_status)?.description)
    ?? eventType;
  const labels = limitStrings(readStringArray(eventData.tags), MAX_LABELS);
  const tags = limitStrings([
    ...(readString(eventData.domain) ? [`domain:${readString(eventData.domain)}`] : []),
    ...(eventType ? [`event:${eventType}`] : []),
  ], MAX_TAGS);

  return {
    ...(eventType ? { title: eventType } : {}),
    ...(status ? { status } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
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
