import type { EventSummary as SharedEventSummary } from '@agent-relay/events';

export type EventSummary = SharedEventSummary;

const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 80;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const actor = buildActor(payload);
  const tags = buildTags(payload);
  const summary: EventSummary = {};
  const title = truncateText(
    readString(payload.text)
      ?? readString(readRecord(payload.previous_message)?.text)
      ?? readString(readRecord(payload.message)?.text),
    MAX_TITLE_LENGTH,
  );

  if (title) summary.title = title;
  if (actor) summary.actor = actor;
  if (tags.length > 0) summary.tags = tags;

  return summary;
}

function buildActor(payload: Record<string, unknown>): EventSummary['actor'] | undefined {
  const user = payload.user;

  if (typeof user === 'string' && user.trim().length > 0) {
    const displayName = cleanDisplayName(readString(payload.user_name) ?? readString(payload.userName));
    return displayName ? { id: user, displayName } : { id: user };
  }

  const userRecord = readRecord(user);
  if (!userRecord) {
    return undefined;
  }

  const id = readString(userRecord.id) ?? readString(userRecord.user_id) ?? readString(userRecord.name);
  if (!id) {
    return undefined;
  }

  const displayName = cleanDisplayName(
    readString(userRecord.real_name)
      ?? readString(userRecord.name)
      ?? readString(readRecord(userRecord.profile)?.display_name)
      ?? readString(readRecord(userRecord.profile)?.real_name),
  );

  return displayName ? { id, displayName } : { id };
}

function buildTags(payload: Record<string, unknown>): string[] {
  const tags: string[] = [];
  const channel = payload.channel;
  const channelRecord = readRecord(channel);
  const channelId = typeof channel === 'string' ? channel : readString(channelRecord?.id);
  const channelName = readString(channelRecord?.name);
  const channelType = readString(payload.channel_type);

  if (channelId) {
    tags.push(`channel:${channelId}`);
  }
  if (channelName) {
    tags.push(`channel_name:${channelName}`);
  }
  if (channelType) {
    tags.push(`channel_type:${channelType}`);
  }

  return limitStrings(tags, MAX_TAGS);
}

function cleanDisplayName(value: string | undefined): string | undefined {
  if (!value || looksLikeEmail(value)) {
    return undefined;
  }

  return value.trim() || undefined;
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
