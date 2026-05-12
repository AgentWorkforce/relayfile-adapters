export type EventSummary = {
  title?: string;
  status?: string;
  priority?: string;
  labels?: string[];
  actor?: { id: string; displayName?: string };
  fieldsChanged?: string[];
  tags?: string[];
};

const MAX_LABELS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const actor = buildActor(readRecord(payload.actionBy) ?? readRecord(readRecord(payload._webhook)?.actor));
  const labels = limitStrings(readLabelNames(payload.labels), MAX_LABELS);
  const fieldsChanged = diffPreviousData(readRecord(payload.previousData) ?? readRecord(readRecord(payload._webhook)?.previousData), payload);
  const summary: EventSummary = {};
  const title = truncateText(readString(payload.title) ?? readString(payload.name), MAX_TITLE_LENGTH);
  const status =
    truncateText(readString(readRecord(payload.state)?.name) ?? readString(payload.state_name), MAX_TITLE_LENGTH);
  const priority = resolvePriority(payload);
  const tags = limitStrings(
    [
      ...(status ? [`state:${status}`] : []),
      ...(priority ? [`priority:${priority}`] : []),
    ],
    MAX_TAGS,
  );

  if (title) summary.title = title;
  if (status) summary.status = status;
  if (priority) summary.priority = priority;
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

  const displayName = cleanDisplayName(
    readString(record.displayName)
      ?? readString(record.display_name)
      ?? readString(record.name)
      ?? readString(record.firstName)
      ?? readString(record.first_name),
  );

  return displayName ? { id, displayName } : { id };
}

function cleanDisplayName(value: string | undefined): string | undefined {
  if (!value || looksLikeEmail(value)) {
    return undefined;
  }

  return value.trim() || undefined;
}

function diffPreviousData(
  previousData: Record<string, unknown> | undefined,
  currentData: Record<string, unknown>,
): string[] {
  if (!previousData) {
    return [];
  }

  const changed: string[] = [];
  for (const key of Object.keys(previousData)) {
    if (key.startsWith('_')) {
      continue;
    }

    if (!isSameValue(previousData[key], currentData[key])) {
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

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function mapPriorityLabel(priority: number): string {
  switch (priority) {
    case 0:
      return 'none';
    case 1:
      return 'urgent';
    case 2:
      return 'high';
    case 3:
      return 'normal';
    case 4:
      return 'low';
    default:
      return 'custom';
  }
}

function readLabelNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];
  for (const entry of value) {
    const name = readString(readRecord(entry)?.name);
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function redactFreeText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
    .replace(/\b\d{9,}\b/g, '[redacted-number]');
}

function resolvePriority(payload: Record<string, unknown>): string | undefined {
  const explicit = readString(payload.priority_label);
  if (explicit) {
    return explicit;
  }

  const priority = readNumber(payload.priority);
  return priority === undefined ? undefined : mapPriorityLabel(priority);
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
