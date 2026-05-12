import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const firstEvent = readRecord(readArray(payload.events)[0]);
  const resource = readRecord(firstEvent?.resource);
  const task = readRecord(payload.data) ?? readRecord(payload.task) ?? resource ?? payload;
  const title = truncateText(readString(task.name) ?? readString(resource?.name), MAX_TITLE_LENGTH);
  const status =
    typeof task.completed === 'boolean'
      ? task.completed ? 'done' : 'open'
      : readString(task.status);
  const labels = limitStrings(readLabelNames(task.tags), MAX_LABELS);
  const actor = buildActor(readRecord(firstEvent?.user));
  const fieldsChanged = resolveFieldsChanged(readArray(payload.events));
  const tags = limitStrings([
    ...(readString(firstEvent?.action) ? [`action:${readString(firstEvent?.action)}`] : []),
    ...(readString(resource?.resource_type) ? [`resource:${readString(resource?.resource_type)}`] : []),
  ], MAX_TAGS);

  return {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(actor ? { actor } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function buildActor(record: Record<string, unknown> | undefined): EventSummary['actor'] | undefined {
  if (!record) return undefined;
  const id = readString(record.gid);
  if (!id) return undefined;
  const displayName = readString(record.name);
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

function resolveFieldsChanged(events: unknown[]): string[] {
  return limitStrings(
    events
      .map((entry) => {
        const record = readRecord(entry);
        const change = readRecord(record?.change);
        return readString(change?.field) ?? readString(change?.action) ?? readString(record?.action);
      })
      .filter((entry): entry is string => Boolean(entry)),
    MAX_FIELDS_CHANGED,
  );
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
