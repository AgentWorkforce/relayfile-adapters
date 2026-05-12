import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const attributes = readRecord(payload.attributes);
  const title = truncateText(
    readString(payload.Subject) ?? readString(payload.Name) ?? readString(payload.Title),
    MAX_TITLE_LENGTH,
  );
  const status = readString(payload.Status) ?? readString(payload.State);
  const priority = readString(payload.Priority);
  const fieldsChanged = limitStrings(Object.keys(readRecord(payload.changes) ?? {}), MAX_FIELDS_CHANGED);
  const tags = limitStrings([
    ...(readString(attributes?.type) ? [`object:${readString(attributes?.type)}`] : []),
    ...(readString(payload.RecordTypeId) ? [`record_type:${readString(payload.RecordTypeId)}`] : []),
  ], MAX_TAGS);
  const actor = buildActor(payload);

  return {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(actor ? { actor } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function buildActor(payload: Record<string, unknown>): EventSummary['actor'] | undefined {
  const id = readString(payload.LastModifiedById) ?? readString(payload.CreatedById) ?? readString(payload.OwnerId);
  return id ? { id } : undefined;
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
