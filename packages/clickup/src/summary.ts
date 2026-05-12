import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const data = readRecord(payload.data) ?? payload;
  const title = truncateText(readString(data.name), MAX_TITLE_LENGTH);
  const status = readString(readRecord(data.status)?.status) ?? readString(data.status);
  const priority = readString(readRecord(data.priority)?.priority) ?? readString(data.priority);
  const labels = limitStrings(readLabelNames(data.tags), MAX_LABELS);
  const actor = buildActor(readRecord(data.creator) ?? readRecord(readRecord(readArray(payload.history_items)[0])?.user));
  const fieldsChanged = limitStrings(
    readArray(payload.history_items)
      .map((entry) => {
        const record = readRecord(entry);
        return readString(record?.field) ?? readString(record?.field_name) ?? readString(record?.type);
      })
      .filter((entry): entry is string => Boolean(entry)),
    MAX_FIELDS_CHANGED,
  );
  const tags = limitStrings([
    ...(readString(payload.event) ? [`event:${readString(payload.event)}`] : []),
    ...(readString(readRecord(data.list)?.id) ? [`list:${readString(readRecord(data.list)?.id)}`] : []),
  ], MAX_TAGS);

  return {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(actor ? { actor } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function buildActor(record: Record<string, unknown> | undefined): EventSummary['actor'] | undefined {
  if (!record) return undefined;
  const id = readString(record.id);
  if (!id) return undefined;
  const displayName = readString(record.username) ?? readString(record.email);
  return displayName ? { id, displayName } : { id };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readLabelNames(value: unknown): string[] {
  return readArray(value)
    .map((entry) => readString(readRecord(entry)?.name))
    .filter((entry): entry is string => Boolean(entry));
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
