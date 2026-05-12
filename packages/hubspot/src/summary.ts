import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const properties = readRecord(payload.properties) ?? payload;
  const propertyName = readString(payload.propertyName) ?? readString(readRecord(payload.change)?.propertyName);
  const title = truncateText(
    readString(properties.dealname) ?? readString(properties.firstname) ?? readString(properties.subject),
    MAX_TITLE_LENGTH,
  );
  const status = readString(properties.dealstage) ?? readString(properties.hs_pipeline_stage);
  const priority = readString(properties.priority) ?? readString(properties.hs_priority);
  const fieldsChanged = propertyName ? [propertyName] : [];
  const tags = limitStrings([
    ...(readString(payload.subscriptionType) ? [`subscription:${readString(payload.subscriptionType)}`] : []),
    ...(readString(payload.objectType) ? [`object:${readString(payload.objectType)}`] : []),
  ], MAX_TAGS);

  return {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
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
