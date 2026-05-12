import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 80;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const ticket = readRecord(payload.ticket) ?? payload;
  const title = truncateText(readString(ticket.subject), MAX_TITLE_LENGTH);
  const status = truncateText(readString(ticket.status), MAX_TEXT_FIELD_LENGTH);
  const priority = truncateText(readString(ticket.priority), MAX_TEXT_FIELD_LENGTH);
  const labels = limitStrings(readStringArray(ticket.tags), MAX_LABELS);
  const fieldsChanged = resolveFieldsChanged(payload, ticket);
  const tags = limitStrings(
    [
      ...(readString(ticket.type) ? [`type:${readString(ticket.type)}`] : []),
      ...(stringifyId(ticket.group_id) ? [`group:${stringifyId(ticket.group_id)}`] : []),
      ...(stringifyId(ticket.brand_id) ? [`brand:${stringifyId(ticket.brand_id)}`] : []),
    ],
    MAX_TAGS,
  );
  const actor = buildActor(
    readRecord(payload.current_user)
      ?? readRecord(payload.requester)
      ?? readRecord(ticket.requester)
      ?? readRecord(ticket.submitter)
      ?? readRecord(ticket.assignee),
  );

  return finalizeSummary({
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(actor ? { actor } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  });
}

function resolveFieldsChanged(
  payload: Record<string, unknown>,
  ticket: Record<string, unknown>,
): string[] {
  const changeKeys = [
    ...Object.keys(readRecord(payload.changes) ?? {}),
    ...Object.keys(readRecord(payload.previous) ?? {}).filter((key) => key !== 'comments'),
    ...(readArray(readRecord(payload.audit)?.changes) ?? [])
      .map((entry) => readString(readRecord(entry)?.field_name))
      .filter((entry): entry is string => Boolean(entry)),
  ];
  const changed = limitStrings(
    [
      ...changeKeys,
      ...(commentsChanged(payload, ticket) ? ['comments'] : []),
    ],
    MAX_FIELDS_CHANGED,
  );

  if (changed.length > 0) {
    return changed;
  }

  for (const comment of readArray(ticket.comments) ?? []) {
    if (readRecord(comment)) {
      return ['comments'];
    }
  }

  return [];
}

function commentsChanged(payload: Record<string, unknown>, ticket: Record<string, unknown>): boolean {
  const currentComments = readArray(ticket.comments);
  const previousTicket = readRecord(payload.previous);
  const previousComments =
    readArray(previousTicket?.comments)
    ?? readArray(readRecord(readRecord(payload.before)?.ticket)?.comments)
    ?? readArray(readRecord(payload.before)?.comments);
  if (!currentComments || currentComments.length === 0) {
    return Array.isArray(previousComments) && previousComments.length > 0;
  }

  if (!previousComments) {
    return true;
  }

  return !isSameValue(currentComments, previousComments);
}

function buildActor(record: Record<string, unknown> | undefined): EventSummary['actor'] | undefined {
  if (!record) return undefined;

  const id = stringifyId(record.id) ?? stringifyId(record.user_id);
  if (!id) return undefined;

  const displayName = cleanDisplayName(readString(record.name));
  return displayName ? { id, displayName } : { id };
}

function finalizeSummary(summary: EventSummary): EventSummary {
  const next: EventSummary = {
    ...summary,
    ...(summary.actor ? { actor: { ...summary.actor } } : {}),
    ...(summary.labels ? { labels: [...summary.labels] } : {}),
    ...(summary.fieldsChanged ? { fieldsChanged: [...summary.fieldsChanged] } : {}),
    ...(summary.tags ? { tags: [...summary.tags] } : {}),
  };

  while (JSON.stringify(next).length >= MAX_SUMMARY_JSON_LENGTH) {
    if (trimArray(next, 'labels')) continue;
    if (trimArray(next, 'fieldsChanged')) continue;
    if (trimArray(next, 'tags')) continue;
    if (next.actor?.displayName) {
      next.actor = { id: next.actor.id };
      continue;
    }
    if (trimText(next, 'title', 24)) continue;
    if (trimText(next, 'status', 16)) continue;
    if (trimText(next, 'priority', 16)) continue;
    if (next.actor) {
      delete next.actor;
      continue;
    }
    break;
  }

  return next;
}

function trimArray(summary: EventSummary, key: 'labels' | 'fieldsChanged' | 'tags'): boolean {
  const current = summary[key];
  if (!current || current.length === 0) {
    return false;
  }

  if (current.length === 1) {
    delete summary[key];
    return true;
  }

  summary[key] = current.slice(0, -1);
  return true;
}

function trimText(summary: EventSummary, key: 'title' | 'status' | 'priority', minLength: number): boolean {
  const current = summary[key];
  if (typeof current !== 'string') {
    return false;
  }

  if (current.length <= minLength) {
    delete summary[key];
    return true;
  }

  const nextLength = Math.max(minLength, current.length - 16);
  const nextValue = truncateText(current, nextLength);
  if (nextValue) {
    summary[key] = nextValue;
  } else {
    delete summary[key];
  }
  return true;
}

function cleanDisplayName(value: string | undefined): string | undefined {
  if (!value || looksLikeEmail(value)) {
    return undefined;
  }

  return value.trim() || undefined;
}

function isSameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
}

function stringifyId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return readString(value);
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

function redactFreeText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
    .replace(/\b\d{9,}\b/g, '[redacted-number]');
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = redactFreeText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
