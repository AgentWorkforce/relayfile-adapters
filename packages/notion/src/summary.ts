import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_TITLE_LENGTH = 120;
const MAX_LABELS = 8;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const properties = readRecord(payload.properties);
  const actor = buildActor(
    readRecord(payload.last_edited_by)
      ?? readRecord(payload.lastEditedBy)
      ?? readRecord(payload.created_by)
      ?? readRecord(payload.createdBy),
  );
  const fieldsChanged = resolveFieldsChanged(payload, properties);
  const tags = limitStrings(
    [
      ...(readString(payload.object) ? [`object:${readString(payload.object)}`] : []),
      ...resolveParentTags(readRecord(payload.parent)),
    ],
    MAX_TAGS,
  );
  const summary: EventSummary = {};
  const title = truncateText(resolveTitle(payload, properties), MAX_TITLE_LENGTH);
  const status = truncateText(resolveStatus(properties), MAX_TITLE_LENGTH);
  const labels = resolveLabels(properties);

  if (title) summary.title = title;
  if (status) summary.status = status;
  if (labels.length > 0) summary.labels = labels;
  if (actor) summary.actor = actor;
  if (fieldsChanged.length > 0) summary.fieldsChanged = fieldsChanged;
  if (tags.length > 0) summary.tags = tags;

  return summary;
}

function buildActor(record: Record<string, unknown> | undefined): EventSummary['actor'] | undefined {
  if (!record) {
    return undefined;
  }

  const id = readString(record.id);
  if (!id) {
    return undefined;
  }

  const displayName = cleanDisplayName(readString(record.name));
  return displayName ? { id, displayName } : { id };
}

function cleanDisplayName(value: string | undefined): string | undefined {
  if (!value || looksLikeEmail(value)) {
    return undefined;
  }

  return value.trim() || undefined;
}

function diffProperties(
  previousProperties: Record<string, unknown> | undefined,
  currentProperties: Record<string, unknown> | undefined,
): string[] {
  if (!previousProperties || !currentProperties) {
    return [];
  }

  const changed: string[] = [];
  for (const key of Object.keys(previousProperties)) {
    if (!isSameValue(previousProperties[key], currentProperties[key])) {
      changed.push(key);
    }
    if (changed.length >= MAX_FIELDS_CHANGED) {
      break;
    }
  }
  return changed;
}

function isSameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function limitStrings(values: string[], max: number): string[] {
  const results: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || results.includes(normalized)) {
      continue;
    }
    results.push(normalized);
    if (results.length >= max) {
      break;
    }
  }
  return results;
}

function resolveParentTags(parent: Record<string, unknown> | undefined): string[] {
  if (!parent) {
    return [];
  }

  const tags: string[] = [];
  const type = readString(parent.type);
  if (type) {
    tags.push(`parent_type:${type}`);
  }
  const databaseId = readString(parent.database_id);
  if (databaseId) {
    tags.push(`parent:${databaseId}`);
  }
  const pageId = readString(parent.page_id);
  if (pageId) {
    tags.push(`parent:${pageId}`);
  }
  return tags;
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

function redactFreeText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
    .replace(/\b\d{9,}\b/g, '[redacted-number]');
}

function resolveFieldsChanged(
  payload: Record<string, unknown>,
  properties: Record<string, unknown> | undefined,
): string[] {
  const explicit =
    readArray(payload.changedProperties)
    ?? readArray(payload.changed_properties)
    ?? readArray(payload.propertiesChanged)
    ?? readArray(readRecord(payload._webhook)?.changedProperties);
  if (explicit) {
    return limitStrings(
      explicit.map((value) => readString(value)).filter((value): value is string => Boolean(value)),
      MAX_FIELDS_CHANGED,
    );
  }

  const previousProperties =
    readRecord(payload.previousProperties)
    ?? readRecord(payload.previous_properties)
    ?? readRecord(readRecord(payload.before)?.properties)
    ?? readRecord(readRecord(payload._webhook)?.previousProperties);

  return diffProperties(previousProperties, properties);
}

function resolvePropertyDisplayValue(property: Record<string, unknown>): string | undefined {
  const displayValue = readString(property.displayValue);
  if (displayValue) {
    return displayValue;
  }

  const type = readString(property.type);
  if (type === 'title') {
    return richTextToPlainText(readArray(property.title) ?? readArray(property.value));
  }
  if (type === 'status') {
    return readString(readRecord(property.status)?.name) ?? readString(readRecord(property.value)?.name) ?? readString(property.value);
  }

  return undefined;
}

function resolveStatus(properties: Record<string, unknown> | undefined): string | undefined {
  if (!properties) {
    return undefined;
  }

  const statusProperty = readRecord(properties.Status);
  if (statusProperty) {
    return resolvePropertyDisplayValue(statusProperty);
  }

  for (const property of Object.values(properties)) {
    const record = readRecord(property);
    if (record && readString(record.type) === 'status') {
      return resolvePropertyDisplayValue(record);
    }
  }

  return undefined;
}

function resolveLabels(properties: Record<string, unknown> | undefined): string[] {
  if (!properties) {
    return [];
  }

  const labels: string[] = [];
  for (const property of Object.values(properties)) {
    const record = readRecord(property);
    if (!record) {
      continue;
    }

    if (readString(record.type) === 'multi_select') {
      for (const entry of readArray(record.multi_select) ?? []) {
        const name = readString(readRecord(entry)?.name);
        if (name) {
          labels.push(name);
        }
      }
      continue;
    }

    if (readString(record.type) === 'select') {
      const name = readString(readRecord(record.select)?.name);
      if (name && /tag|label|area|team/i.test(readString(record.name) ?? '')) {
        labels.push(name);
      }
    }
  }

  return limitStrings(labels, MAX_LABELS);
}

function resolveTitle(
  payload: Record<string, unknown>,
  properties: Record<string, unknown> | undefined,
): string | undefined {
  const normalizedTitle = readString(payload.title);
  if (normalizedTitle) {
    return normalizedTitle;
  }

  if (!properties) {
    return undefined;
  }

  const nameProperty = readRecord(properties.Name);
  if (nameProperty) {
    const title = resolvePropertyDisplayValue(nameProperty);
    if (title) {
      return title;
    }
  }

  for (const property of Object.values(properties)) {
    const record = readRecord(property);
    if (record && readString(record.type) === 'title') {
      return resolvePropertyDisplayValue(record);
    }
  }

  return undefined;
}

function richTextToPlainText(value: unknown[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const text = value
    .map((entry) => readString(readRecord(entry)?.plain_text))
    .filter((entry): entry is string => Boolean(entry))
    .join('');
  return text || undefined;
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = redactFreeText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
