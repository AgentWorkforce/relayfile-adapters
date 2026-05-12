import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const ticket = readRecord(payload.ticket) ?? payload;
  const title = truncateText(readString(ticket.subject) ?? readString(ticket.title), MAX_TITLE_LENGTH);
  const status = readString(ticket.status);
  const priority = readString(ticket.priority);
  const labels = limitStrings(readStringArray(ticket.tags), MAX_LABELS);
  const fieldsChanged = limitStrings(Object.keys(readRecord(payload.changes) ?? {}), MAX_FIELDS_CHANGED);
  const tags = limitStrings([
    ...(readString(ticket.type) ? [`type:${readString(ticket.type)}`] : []),
    ...(readString(ticket.group_id) ? [`group:${readString(ticket.group_id)}`] : []),
    ...(readString(ticket.brand_id) ? [`brand:${readString(ticket.brand_id)}`] : []),
  ], MAX_TAGS);
  const actor = buildActor(
    readRecord(payload.current_user)
      ?? readRecord(payload.requester)
      ?? readRecord(ticket.requester)
      ?? readRecord(ticket.submitter)
      ?? readRecord(ticket.assignee),
  );

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
  const id = readString(record.id) ?? readString(record.user_id) ?? readString(record.email);
  if (!id) return undefined;
  const displayName = readString(record.name);
  return displayName ? { id, displayName } : { id };
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
