import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const data = readRecord(payload.data) ?? payload;
  const attributes = readRecord(data.attributes) ?? readRecord(payload.attributes);
  const title = truncateText(
    readString(data.Subject) ?? readString(data.Name) ?? readString(data.Title),
    MAX_TITLE_LENGTH,
  );
  const status = readString(data.Status) ?? readString(data.State);
  const priority = readString(data.Priority);
  const fieldsChanged = resolveFieldsChanged(payload, data);
  const tags = limitStrings([
    ...(readString(attributes?.type) ? [`object:${readString(attributes?.type)}`] : []),
    ...(readString(data.RecordTypeId) ? [`record_type:${readString(data.RecordTypeId)}`] : []),
  ], MAX_TAGS);
  const actor = buildActor(data);

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

function resolveFieldsChanged(
  payload: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] {
  const explicit = limitStrings([
    ...Object.keys(readRecord(payload.changes) ?? {}),
    ...readStringArray(payload.changedFields),
    ...readStringArray(readRecord(payload.ChangeEventHeader)?.changedFields),
  ], MAX_FIELDS_CHANGED);
  if (explicit.length > 0) {
    return explicit;
  }

  const previous =
    readRecord(payload.previous)
    ?? readRecord(payload.previousData)
    ?? readRecord(readRecord(payload.before)?.data);
  if (!previous) {
    return [];
  }

  return limitStrings(
    Object.keys({ ...previous, ...data }).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(data[key])),
    MAX_FIELDS_CHANGED,
  );
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

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
