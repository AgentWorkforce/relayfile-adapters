import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const data = readRecord(payload.data);
  const object = readRecord(data?.object) ?? payload;
  const title = truncateText(readString(object.description) ?? readString(object.name), MAX_TITLE_LENGTH);
  const status = readString(object.status) ?? readString(payload.type);
  const fieldsChanged = limitStrings(Object.keys(readRecord(data?.previous_attributes) ?? {}), MAX_FIELDS_CHANGED);
  const tags = limitStrings([
    ...(readString(object.object) ? [`object:${readString(object.object)}`] : []),
    ...(readString(payload.type) ? [`event:${readString(payload.type)}`] : []),
  ], MAX_TAGS);

  return {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
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
