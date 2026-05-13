import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_LABELS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_FIELDS_CHANGED = 12;
const MAX_TAGS = 8;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const pullRequest = readRecord(payload.pull_request);
  const issue = readRecord(payload.issue);
  const subject = pullRequest ?? issue ?? payload;
  const actor = buildActor(readRecord(payload.sender) ?? readRecord(subject.user));
  const labels = limitStrings(readLabelNames(subject.labels), MAX_LABELS);
  const fieldsChanged = limitStrings(Object.keys(readRecord(payload.changes) ?? {}), MAX_FIELDS_CHANGED);
  const tags = limitStrings(
    [
      ...(pullRequest ? ['kind:pull_request'] : issue ? ['kind:issue'] : []),
      ...(readString(readRecord(payload.repository)?.full_name)
        ? [`repo:${readString(readRecord(payload.repository)?.full_name)}`]
        : []),
    ],
    MAX_TAGS,
  );
  const summary: EventSummary = {};
  const title = truncateText(readString(subject.title), MAX_TITLE_LENGTH);
  const status = resolveStatus(subject, pullRequest !== undefined);

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

  const id = readNumber(record.id);
  const login = readString(record.login);
  const actorId = id !== undefined ? String(id) : login;
  if (!actorId) {
    return undefined;
  }

  return login ? { id: actorId, displayName: login } : { id: actorId };
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

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function resolveStatus(subject: Record<string, unknown>, isPullRequest: boolean): string | undefined {
  if (isPullRequest && subject.draft === true) {
    return 'draft';
  }

  const state = readString(subject.state);
  if (state === 'open' || state === 'closed') {
    return state;
  }

  return state;
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
