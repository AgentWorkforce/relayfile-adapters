import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 80;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const record = resolvePrimaryRecord(payload);
  const records = resolveRecords(payload);
  const properties = readRecord(record.properties) ?? record;
  const propertyNames = resolvePropertyNames(records);
  const title = truncateText(
    readString(properties.dealname) ?? readString(properties.firstname) ?? readString(properties.subject),
    MAX_TITLE_LENGTH,
  );
  const status = truncateText(readString(properties.dealstage) ?? readString(properties.hs_pipeline_stage), MAX_TEXT_FIELD_LENGTH);
  const priority = truncateText(readString(properties.priority) ?? readString(properties.hs_priority), MAX_TEXT_FIELD_LENGTH);
  const actor = buildActor(record);
  const tags = limitStrings(
    [
      ...(readString(record.subscriptionType) ? [`subscription:${readString(record.subscriptionType)}`] : []),
      ...(readString(record.objectType) ? [`object:${readString(record.objectType)}`] : []),
    ],
    MAX_TAGS,
  );

  return finalizeSummary({
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(actor ? { actor } : {}),
    ...(propertyNames.length > 0 ? { fieldsChanged: propertyNames } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  });
}

function resolvePrimaryRecord(payload: Record<string, unknown>): Record<string, unknown> {
  return resolveRecords(payload)[0] ?? payload;
}

function resolveRecords(payload: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.map((entry) => readRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  const batched =
    readArray(payload.records)
    ?? readArray(payload.events)
    ?? readArray(payload.results)
    ?? readArray(payload.batch);
  if (!batched || batched.length === 0) {
    return [payload];
  }

  return batched
    .map((entry) => readRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function resolvePropertyNames(records: Record<string, unknown>[]): string[] {
  return limitStrings(
    records.flatMap((record) => {
      const explicit = readString(record.propertyName) ?? readString(readRecord(record.change)?.propertyName);
      if (explicit) {
        return [explicit];
      }

      const changedProperties =
        readArray(record.changedProperties)
        ?? readArray(record.changed_properties)
        ?? readArray(readRecord(record._webhook)?.changedProperties);
      if (!changedProperties) {
        return [];
      }

      return changedProperties
        .map((entry) => readString(entry))
        .filter((entry): entry is string => Boolean(entry));
    }),
    MAX_FIELDS_CHANGED,
  );
}

function buildActor(record: Record<string, unknown>): EventSummary['actor'] | undefined {
  const id =
    readString(record.updatedByUserId)
    ?? readString(record.sourceId)
    ?? readString(record.portalId);
  if (!id) {
    return undefined;
  }

  const displayName = truncateText(
    readString(record.updatedByUserName) ?? readString(record.sourceName),
    MAX_TEXT_FIELD_LENGTH,
  );
  return displayName ? { id, displayName } : { id };
}

function finalizeSummary(summary: EventSummary): EventSummary {
  const next: EventSummary = {
    ...summary,
    ...(summary.fieldsChanged ? { fieldsChanged: [...summary.fieldsChanged] } : {}),
    ...(summary.tags ? { tags: [...summary.tags] } : {}),
  };

  while (JSON.stringify(next).length >= MAX_SUMMARY_JSON_LENGTH) {
    if (trimArray(next, 'fieldsChanged')) continue;
    if (trimArray(next, 'tags')) continue;
    if (trimText(next, 'title', 24)) continue;
    if (trimText(next, 'status', 16)) continue;
    if (trimText(next, 'priority', 16)) continue;
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
