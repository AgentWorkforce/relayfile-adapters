import type { SegmentReadRequest } from './types.js';

const ROOT = '/segment';
const DELIVERY_OVERVIEW_FILTERED_AT_SOURCE_ENDPOINT = '/delivery-overview/filtered-at-source';

export function resolveReadRequest(path: string): SegmentReadRequest {
  const normalizedPath = normalizePath(path);

  const identifyMatch = normalizedPath.match(/^\/segment\/identify\/([^/]+)\.json$/);
  if (identifyMatch?.[1]) {
    return buildDeliveryOverviewRead('identify');
  }

  const trackMatch = normalizedPath.match(/^\/segment\/track\/([^/]+)\.json$/);
  if (trackMatch?.[1]) {
    return buildDeliveryOverviewRead('track', extractEventName(trackMatch[1]));
  }

  const pageMatch = normalizedPath.match(/^\/segment\/page\/([^/]+)\.json$/);
  if (pageMatch?.[1]) {
    return buildDeliveryOverviewRead('page', extractEventName(pageMatch[1]));
  }

  const groupMatch = normalizedPath.match(/^\/segment\/groups\/([^/]+)\.json$/);
  if (groupMatch?.[1]) {
    return buildDeliveryOverviewRead('group');
  }

  if (normalizedPath === `${ROOT}/identify/` || normalizedPath === `${ROOT}/identify`) {
    return buildDeliveryOverviewRead('identify');
  }
  if (normalizedPath === `${ROOT}/track/` || normalizedPath === `${ROOT}/track`) {
    return buildDeliveryOverviewRead('track');
  }
  if (normalizedPath === `${ROOT}/page/` || normalizedPath === `${ROOT}/page`) {
    return buildDeliveryOverviewRead('page');
  }
  if (normalizedPath === `${ROOT}/groups/` || normalizedPath === `${ROOT}/groups`) {
    return buildDeliveryOverviewRead('group');
  }

  throw new Error(`No Segment read rule matched ${path}`);
}

function buildDeliveryOverviewRead(eventType: string, eventName?: string): SegmentReadRequest {
  return {
    method: 'GET',
    endpoint: DELIVERY_OVERVIEW_FILTERED_AT_SOURCE_ENDPOINT,
    query: dropUndefined({
      'filter.eventName': eventName,
      'filter.eventType': eventType,
      'groupBy.0': 'eventName',
      'groupBy.1': 'eventType',
      granularity: 'DAY',
    }),
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function extractEventName(segment: string): string | undefined {
  const decoded = decodePathSegment(segment);
  const slug = /^(.+)--[^-]+$/u.exec(decoded)?.[1];
  if (!slug) {
    return undefined;
  }
  return slug.replace(/-/g, ' ');
}

function decodePathSegment(segment: string): string {
  return decodeURIComponent(segment);
}

function dropUndefined(payload: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
