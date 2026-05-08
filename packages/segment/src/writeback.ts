import type { SegmentWritebackRequest } from './types.js';

type SegmentWritebackMethod = SegmentWritebackRequest['method'];

export function resolveWritebackRequest(
  path: string,
  content: string,
  method: SegmentWritebackMethod = 'POST',
): SegmentWritebackRequest {
  const normalizedPath = normalizePath(path);
  const payload = parseJsonObject(content);

  if (normalizedPath === '/segment/identify/new.json' || normalizedPath === '/segment/identify/') {
    return buildIdentify(payload, method);
  }

  const identifyMatch = normalizedPath.match(/^\/segment\/identify\/([^/]+)\.json$/);
  if (identifyMatch?.[1]) {
    return buildIdentify({ ...payload, userId: payload.userId ?? decodeURIComponent(identifyMatch[1]) }, method);
  }

  if (normalizedPath === '/segment/track/new.json' || normalizedPath === '/segment/track/') {
    return buildTrack(payload, method);
  }

  const trackMatch = normalizedPath.match(/^\/segment\/track\/([^/]+)\.json$/);
  if (trackMatch?.[1]) {
    return buildTrack({ ...payload, messageId: payload.messageId ?? extractSuffix(trackMatch[1]) }, method);
  }

  if (normalizedPath === '/segment/page/new.json' || normalizedPath === '/segment/page/') {
    return buildPage(payload, method);
  }

  const pageMatch = normalizedPath.match(/^\/segment\/page\/([^/]+)\.json$/);
  if (pageMatch?.[1]) {
    return buildPage({ ...payload, messageId: payload.messageId ?? extractSuffix(pageMatch[1]) }, method);
  }

  if (normalizedPath === '/segment/groups/new.json' || normalizedPath === '/segment/groups/') {
    return buildGroup(payload, method);
  }

  const groupMatch = normalizedPath.match(/^\/segment\/groups\/([^/]+)\.json$/);
  if (groupMatch?.[1]) {
    return buildGroup({ ...payload, groupId: payload.groupId ?? decodeURIComponent(groupMatch[1]) }, method);
  }

  if (normalizedPath === '/segment/batch/new.json') {
    return buildBatch(payload, method);
  }

  throw new Error(`No Segment writeback rule matched ${path}`);
}

function buildIdentify(payload: Record<string, unknown>, method: SegmentWritebackMethod): SegmentWritebackRequest {
  const body = unwrapPayload(payload);
  const userId = readString(body, 'userId') ?? readString(body, 'user_id');
  const anonymousId = readString(body, 'anonymousId') ?? readString(body, 'anonymous_id');
  if (!userId && !anonymousId) {
    throw new Error('Segment identify writeback requires `userId` or `anonymousId`');
  }

  return {
    action: 'identify',
    method,
    endpoint: '/v1/identify',
    body: dropUndefined({
      anonymousId,
      context: readRecord(body, 'context'),
      integrations: readRecord(body, 'integrations'),
      messageId: readString(body, 'messageId') ?? readString(body, 'message_id'),
      timestamp: readString(body, 'timestamp'),
      traits: readRecord(body, 'traits') ?? {},
      userId,
    }),
  };
}

function buildTrack(payload: Record<string, unknown>, method: SegmentWritebackMethod): SegmentWritebackRequest {
  const body = unwrapPayload(payload);
  const event = readString(body, 'event');
  if (!event) {
    throw new Error('Segment track writeback requires `event`');
  }

  return {
    action: 'track',
    method,
    endpoint: '/v1/track',
    body: dropUndefined({
      anonymousId: readString(body, 'anonymousId') ?? readString(body, 'anonymous_id'),
      context: readRecord(body, 'context'),
      event,
      integrations: readRecord(body, 'integrations'),
      messageId: readString(body, 'messageId') ?? readString(body, 'message_id'),
      properties: readRecord(body, 'properties') ?? {},
      timestamp: readString(body, 'timestamp'),
      userId: readString(body, 'userId') ?? readString(body, 'user_id'),
    }),
  };
}

function buildPage(payload: Record<string, unknown>, method: SegmentWritebackMethod): SegmentWritebackRequest {
  const body = unwrapPayload(payload);
  const name = readString(body, 'name');
  const properties = readRecord(body, 'properties') ?? {};

  return {
    action: 'page',
    method,
    endpoint: '/v1/page',
    body: dropUndefined({
      anonymousId: readString(body, 'anonymousId') ?? readString(body, 'anonymous_id'),
      category: readString(body, 'category'),
      context: readRecord(body, 'context'),
      integrations: readRecord(body, 'integrations'),
      messageId: readString(body, 'messageId') ?? readString(body, 'message_id'),
      name,
      properties,
      timestamp: readString(body, 'timestamp'),
      userId: readString(body, 'userId') ?? readString(body, 'user_id'),
    }),
  };
}

function buildGroup(payload: Record<string, unknown>, method: SegmentWritebackMethod): SegmentWritebackRequest {
  const body = unwrapPayload(payload);
  const groupId = readString(body, 'groupId') ?? readString(body, 'group_id');
  if (!groupId) {
    throw new Error('Segment group writeback requires `groupId`');
  }

  return {
    action: 'group',
    method,
    endpoint: '/v1/group',
    body: dropUndefined({
      anonymousId: readString(body, 'anonymousId') ?? readString(body, 'anonymous_id'),
      context: readRecord(body, 'context'),
      groupId,
      integrations: readRecord(body, 'integrations'),
      messageId: readString(body, 'messageId') ?? readString(body, 'message_id'),
      timestamp: readString(body, 'timestamp'),
      traits: readRecord(body, 'traits') ?? {},
      userId: readString(body, 'userId') ?? readString(body, 'user_id'),
    }),
  };
}

function buildBatch(payload: Record<string, unknown>, method: SegmentWritebackMethod): SegmentWritebackRequest {
  const batch = payload.batch;
  if (!Array.isArray(batch)) {
    throw new Error('Segment batch writeback requires a `batch` array');
  }

  return {
    action: 'batch',
    method,
    endpoint: '/v1/batch',
    body: {
      batch,
      context: readRecord(payload, 'context'),
      integrations: readRecord(payload, 'integrations'),
    },
  };
}

function unwrapPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.payload) && ('provider' in payload || 'objectType' in payload || 'workspaceId' in payload)) {
    return payload.payload;
  }
  return payload;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error('Segment writeback content must be a JSON object');
  }
  return parsed;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function extractSuffix(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const suffix = /--(.+)$/u.exec(decoded);
  return suffix?.[1] ?? decoded;
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dropUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
