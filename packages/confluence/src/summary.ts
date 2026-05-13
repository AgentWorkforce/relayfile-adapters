import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const page = readRecord(payload.page) ?? readRecord(payload.content) ?? payload;
  const title = truncateText(readString(page.title), MAX_TITLE_LENGTH);
  const status =
    readString(page.status)
    ?? readString(readRecord(page.version)?.status)
    ?? readString(readRecord(page.history)?.status);
  const labels = limitStrings(
    readArray(readRecord(readRecord(page.metadata)?.labels)?.results)
      .map((entry) => readString(readRecord(entry)?.name))
      .filter((entry): entry is string => Boolean(entry)),
    MAX_LABELS,
  );
  const fieldsChanged = limitStrings(Object.keys(readRecord(payload.changes) ?? {}), MAX_FIELDS_CHANGED);
  const tags = limitStrings([
    ...(readString(readRecord(page.space)?.key) ? [`space:${readString(readRecord(page.space)?.key)}`] : []),
    ...(readString(page.type) ? [`type:${readString(page.type)}`] : []),
  ], MAX_TAGS);
  const actor = buildActor(
    readRecord(readRecord(page.version)?.by)
      ?? readRecord(readRecord(page.history)?.createdBy)
      ?? readRecord(payload.user),
  );

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
  const id = readString(record.accountId) ?? readString(record.account_id) ?? readString(record.publicName) ?? readString(record.username);
  if (!id) return undefined;
  const displayName = readString(record.displayName) ?? readString(record.publicName);
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
