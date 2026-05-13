import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const subject =
    readRecord(payload.object_attributes)
    ?? readRecord(payload.merge_request)
    ?? readRecord(payload.issue)
    ?? payload;
  const title = truncateText(readString(subject.title), MAX_TITLE_LENGTH);
  const status = readString(subject.state) ?? (subject.work_in_progress === true ? 'draft' : undefined);
  const labels = limitStrings(
    readArray(subject.labels)
      .map((entry) => readString(entry) ?? readString(readRecord(entry)?.title) ?? readString(readRecord(entry)?.name))
      .filter((entry): entry is string => Boolean(entry)),
    MAX_LABELS,
  );
  const fieldsChanged = limitStrings(Object.keys(readRecord(payload.changes) ?? {}), MAX_FIELDS_CHANGED);
  const tags = limitStrings([
    ...(readString(payload.object_kind) ? [`kind:${readString(payload.object_kind)}`] : []),
    ...(readString(readRecord(payload.project)?.path_with_namespace)
      ? [`project:${readString(readRecord(payload.project)?.path_with_namespace)}`]
      : []),
  ], MAX_TAGS);
  const actor = buildActor(readRecord(payload.user) ?? readRecord(subject.author));

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
  const id = readString(record.id) ?? readString(record.username) ?? readString(record.name);
  if (!id) return undefined;
  const displayName = readString(record.username) ?? readString(record.name);
  return displayName ? { id, displayName } : { id };
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
