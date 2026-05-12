import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 80;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const data =
    readRecord(payload.data)
    ?? readRecord(payload.sObject)
    ?? readRecord(payload.sobject)
    ?? payload;
  const attributes = readRecord(data.attributes) ?? readRecord(payload.attributes);
  const title = truncateText(
    readString(data.Name) ?? readString(data.Subject) ?? readString(data.Title),
    MAX_TITLE_LENGTH,
  );
  const status = truncateText(readString(data.Status__c) ?? readString(data.Status) ?? readString(data.State), MAX_TEXT_FIELD_LENGTH);
  const priority = truncateText(readString(data.Priority__c) ?? readString(data.Priority), MAX_TEXT_FIELD_LENGTH);
  const fieldsChanged = resolveFieldsChanged(payload, data);
  const tags = limitStrings(
    [
      ...(readString(attributes?.type) ? [`object:${readString(attributes?.type)}`] : []),
      ...(readString(data.RecordTypeId) ? [`record_type:${readString(data.RecordTypeId)}`] : []),
    ],
    MAX_TAGS,
  );
  const actor = buildActor(data);

  return finalizeSummary({
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(actor ? { actor } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  });
}

function buildActor(payload: Record<string, unknown>): EventSummary['actor'] | undefined {
  const id = readString(payload.LastModifiedById) ?? readString(payload.CreatedById) ?? readString(payload.OwnerId);
  return id ? { id } : undefined;
}

function finalizeSummary(summary: EventSummary): EventSummary {
  const next: EventSummary = {
    ...summary,
    ...(summary.actor ? { actor: { ...summary.actor } } : {}),
    ...(summary.fieldsChanged ? { fieldsChanged: [...summary.fieldsChanged] } : {}),
    ...(summary.tags ? { tags: [...summary.tags] } : {}),
  };

  while (JSON.stringify(next).length >= MAX_SUMMARY_JSON_LENGTH) {
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

function trimArray(summary: EventSummary, key: 'fieldsChanged' | 'tags'): boolean {
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

function resolveFieldsChanged(
  payload: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] {
  const explicit = prioritizeCustomFields(limitStrings(
    [
      ...Object.keys(readRecord(payload.changes) ?? {}),
      ...readStringArray(payload.changedFields),
      ...readStringArray(readRecord(payload.ChangeEventHeader)?.changedFields),
    ],
    MAX_FIELDS_CHANGED,
  ));
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

  return prioritizeCustomFields(limitStrings(
    Object.keys({ ...previous, ...data }).filter((key) => !isSameValue(previous[key], data[key])),
    MAX_FIELDS_CHANGED,
  ));
}

function isSameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  return JSON.stringify(left) === JSON.stringify(right);
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

function prioritizeCustomFields(values: string[]): string[] {
  const custom = values.filter((value) => isCustomFieldName(value));
  if (custom.length === 0 || custom.length === values.length) {
    return values;
  }

  return [...custom, ...values.filter((value) => !isCustomFieldName(value))];
}

function isCustomFieldName(value: string): boolean {
  return /__(?:c|r)$/u.test(value);
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
