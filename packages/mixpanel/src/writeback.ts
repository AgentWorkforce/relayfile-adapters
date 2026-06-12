import type { JsonValue, MixpanelWritebackRequest } from './types.js';

export const MIXPANEL_TRACK_ENDPOINT = '/track';
export const MIXPANEL_ENGAGE_ENDPOINT = '/engage';

export function resolveWritebackRequest(path: string, content: string): MixpanelWritebackRequest {
  const eventCreateMatch = path.match(/^\/mixpanel\/events\/([^/]+)\.json$/);
  if (path === '/mixpanel/events/' || (eventCreateMatch?.[1] && isDraftFilename(eventCreateMatch[1]))) {
    return buildTrackEvent(content);
  }

  const eventImportMatch = path.match(/^\/mixpanel\/events\/([^/]+)\/import\.json$/);
  if (eventImportMatch?.[1]) {
    return buildImportEvent(extractEventName(eventImportMatch[1]), content);
  }

  const profileCreateMatch = path.match(/^\/mixpanel\/profiles\/([^/]+)\.json$/);
  if (path === '/mixpanel/profiles/' || (profileCreateMatch?.[1] && isDraftFilename(profileCreateMatch[1]))) {
    return buildProfileSet(undefined, content);
  }

  const profileDeleteMatch = path.match(/^\/mixpanel\/profiles\/([^/]+)\/delete\.json$/);
  if (profileDeleteMatch?.[1]) {
    return buildProfileDelete(decodeURIComponent(profileDeleteMatch[1]));
  }

  const profileSetMatch = path.match(/^\/mixpanel\/profiles\/([^/]+)\.json$/);
  if (profileSetMatch?.[1]) {
    return buildProfileSet(decodeURIComponent(profileSetMatch[1]), content);
  }

  const cohortUpdateMatch = path.match(/^\/mixpanel\/cohorts\/([^/]+)\.json$/);
  if (cohortUpdateMatch?.[1]) {
    return buildCohortUpdate(decodeURIComponent(cohortUpdateMatch[1]), content);
  }

  throw new Error(`No Mixpanel writeback rule matched ${path}`);
}

function buildTrackEvent(content: string): MixpanelWritebackRequest {
  const payload = parseJsonObject(content);
  const event = readString(payload, 'event') ?? readString(payload, 'name');
  if (!event) {
    throw new Error('events/new.json writeback requires an `event` or `name`');
  }

  const properties = isRecord(payload.properties) ? { ...payload.properties } : {};
  const distinctId = readString(payload, 'distinct_id') ?? readString(properties, 'distinct_id');
  if (distinctId) {
    properties.distinct_id = distinctId;
  }
  const time = readNumber(payload, 'time') ?? readNumber(properties, 'time');
  if (time !== undefined) {
    properties.time = time;
  }

  return {
    action: 'track_event',
    method: 'POST',
    endpoint: '/track',
    body: {
      event,
      properties,
    },
  };
}

function buildImportEvent(eventNameFromPath: string, content: string): MixpanelWritebackRequest {
  const payload = parseJsonObject(content);
  const event = readString(payload, 'event') ?? eventNameFromPath;
  const properties = isRecord(payload.properties) ? { ...payload.properties } : {};
  return {
    action: 'import_event',
    method: 'POST',
    endpoint: '/import',
    body: {
      event,
      properties,
    },
  };
}

function buildProfileSet(profileId: string | undefined, content: string): MixpanelWritebackRequest {
  const payload = parseJsonObject(content);
  const distinctId = profileId ?? readString(payload, '$distinct_id') ?? readString(payload, 'distinct_id');
  if (!distinctId) {
    throw new Error('profile writeback requires a distinct id');
  }

  const setPayload =
    readJsonObject(payload, '$set') ??
    readJsonObject(payload, '$properties') ??
    readJsonObject(payload, 'properties') ??
    omitKeys(payload, ['$distinct_id', 'distinct_id']);

  return {
    action: 'set_profile',
    method: 'POST',
    endpoint: '/engage',
    body: {
      $distinct_id: distinctId,
      $set: setPayload,
    },
  };
}

function buildProfileDelete(profileId: string): MixpanelWritebackRequest {
  return {
    action: 'delete_profile',
    method: 'POST',
    endpoint: '/engage',
    body: {
      $distinct_id: profileId,
      $delete: '',
    },
  };
}

function buildCohortUpdate(cohortId: string, content: string): MixpanelWritebackRequest {
  const payload = parseJsonObject(content);
  const name = readString(payload, 'name');
  const description = readString(payload, 'description');
  const body: Record<string, unknown> = { id: cohortId };
  if (name) {
    body.name = name;
  }
  if (description) {
    body.description = description;
  }

  return {
    action: 'update_cohort',
    method: 'POST',
    endpoint: '/api/2.0/cohorts/update',
    body,
  };
}

function extractEventName(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const slugged = /^(.+)--[a-z0-9]+$/i.exec(decoded);
  if (!slugged?.[1]) {
    return decoded;
  }
  return slugged[1].replace(/-/g, ' ');
}

function isDraftFilename(encodedFilename: string): boolean {
  const filename = decodeURIComponent(encodedFilename);
  return /^(new|create|draft|track)(?:[-_\s].*)?$/iu.test(filename);
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error('Mixpanel writeback content must be a JSON object');
  }
  return parsed;
}

function readJsonObject(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function omitKeys(record: Record<string, unknown>, keys: readonly string[]): Record<string, JsonValue> {
  const blocked = new Set(keys);
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!blocked.has(key) && isJsonValue(value)) {
      result[key] = value;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}
