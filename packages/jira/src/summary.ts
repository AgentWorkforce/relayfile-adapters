import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const issue = readRecord(payload.issue) ?? payload;
  const fields = readRecord(issue.fields) ?? readRecord(payload.fields);
  const actor = buildActor(readRecord(fields?.reporter) ?? readRecord(payload.reporter));
  const labels = limitStrings(readStringArray(fields?.labels), MAX_LABELS);
  const fieldsChanged = extractChangedFields(readRecord(payload.changelog) ?? readRecord(readRecord(payload._webhook)?.changelog));
  const tags = limitStrings(
    [
      ...(readString(readRecord(fields?.issuetype)?.name)
        ? [`issue_type:${readString(readRecord(fields?.issuetype)?.name)}`]
        : []),
      ...extractProjectTags(issue, fields),
    ],
    MAX_TAGS,
  );
  const summary: EventSummary = {};
  const title = truncateText(readString(fields?.summary) ?? readString(issue.summary), MAX_TITLE_LENGTH);
  const status = truncateText(readString(readRecord(fields?.status)?.name), MAX_TITLE_LENGTH);
  const priority = truncateText(readString(readRecord(fields?.priority)?.name), MAX_TITLE_LENGTH);

  if (title) summary.title = title;
  if (status) summary.status = status;
  if (priority) summary.priority = priority;
  if (labels.length > 0) summary.labels = labels;
  if (actor) summary.actor = actor;
  if (fieldsChanged.length > 0) summary.fieldsChanged = fieldsChanged;
  if (tags.length > 0) summary.tags = tags;

  return summary;
}

function extractProjectTags(
  issue: Record<string, unknown>,
  fields: Record<string, unknown> | undefined,
): string[] {
  const explicitProject = readString(readRecord(fields?.project)?.key);
  if (explicitProject) {
    return [`project:${explicitProject}`];
  }

  const issueKey = readString(issue.key);
  if (!issueKey || !issueKey.includes('-')) {
    return [];
  }

  return [`project:${issueKey.split('-', 1)[0]}`];
}

function buildActor(record: Record<string, unknown> | undefined): EventSummary['actor'] | undefined {
  if (!record) {
    return undefined;
  }

  const id = readString(record.accountId) ?? readString(record.account_id) ?? readString(record.name);
  if (!id) {
    return undefined;
  }

  const displayName = cleanDisplayName(readString(record.displayName) ?? readString(record.display_name));
  return displayName ? { id, displayName } : { id };
}

function cleanDisplayName(value: string | undefined): string | undefined {
  if (!value || looksLikeEmail(value)) {
    return undefined;
  }

  return value.trim() || undefined;
}

function extractChangedFields(changelog: Record<string, unknown> | undefined): string[] {
  if (!changelog) {
    return [];
  }

  const changed: string[] = [];
  const items = readArray(changelog.items);
  if (items) {
    collectChangeItems(items, changed);
  }

  const histories = readArray(changelog.histories);
  if (histories) {
    for (const history of histories) {
      const historyItems = readArray(readRecord(history)?.items);
      if (!historyItems) {
        continue;
      }
      collectChangeItems(historyItems, changed);
      if (changed.length >= MAX_FIELDS_CHANGED) {
        break;
      }
    }
  }

  return changed;
}

function collectChangeItems(items: unknown[], changed: string[]): void {
  for (const item of items) {
    const field = readString(readRecord(item)?.field) ?? readString(readRecord(item)?.fieldId);
    if (!field || changed.includes(field)) {
      continue;
    }
    changed.push(field);
    if (changed.length >= MAX_FIELDS_CHANGED) {
      break;
    }
  }
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
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry));
}

function redactFreeText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
    .replace(/\b\d{9,}\b/g, '[redacted-number]');
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
