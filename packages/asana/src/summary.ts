import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 80;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const firstEvent = readRecord(readArray(payload.events)?.[0]);
  const resource = readRecord(firstEvent?.resource);
  const task = readRecord(payload.data) ?? readRecord(payload.task) ?? resource ?? payload;
  const title = truncateText(readString(task.name) ?? readString(resource?.name), MAX_TITLE_LENGTH);
  const status =
    typeof task.completed === 'boolean'
      ? task.completed ? 'done' : 'open'
      : truncateText(readString(task.status), MAX_TEXT_FIELD_LENGTH);
  const labels = limitStrings(readLabelNames(task.tags), MAX_LABELS);
  const actor = buildActor(readRecord(firstEvent?.user));
  const fieldsChanged = resolveFieldsChanged(readArray(payload.events) ?? []);
  const tags = limitStrings(
    [
      ...(readString(firstEvent?.action) ? [`action:${readString(firstEvent?.action)}`] : []),
      ...(readString(resource?.resource_type) ? [`resource:${readString(resource?.resource_type)}`] : []),
    ],
    MAX_TAGS,
  );

  return finalizeSummary({
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(actor ? { actor } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  });
}

function buildActor(record: Record<string, unknown> | undefined): EventSummary['actor'] | undefined {
  if (!record) return undefined;
  const id = readString(record.gid);
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

function trimText(summary: EventSummary, key: 'title' | 'status', minLength: number): boolean {
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

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readLabelNames(value: unknown): string[] {
  return (readArray(value) ?? [])
    .map((entry) => readString(readRecord(entry)?.name))
    .filter((entry): entry is string => Boolean(entry));
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function resolveFieldsChanged(events: unknown[]): string[] {
  return limitStrings(
    events
      .map((entry) => {
        const record = readRecord(entry);
        const change = readRecord(record?.change);
        const action = readString(change?.action);
        const actionRecord = readRecord(change?.action);
        if (actionRecord) {
          const added = readRecord(actionRecord.added_resource);
          const removed = readRecord(actionRecord.removed_resource);
          const resource =
            readString(added?.resource_type)
            ?? readString(removed?.resource_type)
            ?? readString(added?.gid)
            ?? readString(removed?.gid);
          if (resource) {
            return `resource:${resource}`;
          }
        }

        return readString(change?.field) ?? action ?? readString(record?.action);
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
