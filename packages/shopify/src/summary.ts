import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const data = readRecord(payload.data) ?? readRecord(payload.payload) ?? payload;
  const firstLineItem = readRecord(readArray(data.line_items)[0]);
  const title = truncateText(
    readString(data.name) ?? readString(data.title) ?? readString(firstLineItem?.title) ?? readString(firstLineItem?.name),
    MAX_TITLE_LENGTH,
  );
  const status = readString(data.fulfillment_status) ?? readString(data.status);
  const labels = limitStrings(parseDelimitedTags(readString(data.tags)), MAX_LABELS);
  const fieldsChanged = limitStrings([
    ...(readString(payload.topic) ? [readString(payload.topic)!] : []),
    ...(readString(payload.type) ? [readString(payload.type)!] : []),
  ], MAX_FIELDS_CHANGED);
  const tags = limitStrings([
    ...(readString(payload.objectType) ? [`object:${readString(payload.objectType)}`] : []),
    ...(readString(payload.shop_domain) ? [`shop:${readString(payload.shop_domain)}`] : []),
    ...(readString(payload.shopDomain) ? [`shop:${readString(payload.shopDomain)}`] : []),
  ], MAX_TAGS);

  return {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function parseDelimitedTags(value: string | undefined): string[] {
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
