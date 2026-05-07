import type { MixpanelReadRequest } from './types.js';

const MIXPANEL_READ_TRACK_ANCHOR = '/track';
const MIXPANEL_READ_ENGAGE_ANCHOR = '/engage';

const DEFAULT_LIMIT = '100';

export function resolveReadRequest(path: string): MixpanelReadRequest {
  if (path === '/mixpanel/events' || path === '/mixpanel/events/') {
    return {
      method: 'GET',
      endpoint: '/api/2.0/events/names',
      query: { limit: DEFAULT_LIMIT },
    };
  }

  const eventMatch = path.match(/^\/mixpanel\/events\/([^/]+)\.json$/);
  if (eventMatch?.[1]) {
    return {
      method: 'GET',
      endpoint: '/api/2.0/segmentation',
      query: {
        event: extractEventName(eventMatch[1]),
        unit: 'day',
      },
    };
  }

  if (path === '/mixpanel/profiles' || path === '/mixpanel/profiles/') {
    return {
      method: 'GET',
      endpoint: '/api/2.0/engage',
      query: { limit: DEFAULT_LIMIT },
    };
  }

  const profileMatch = path.match(/^\/mixpanel\/profiles\/([^/]+)\.json$/);
  if (profileMatch?.[1]) {
    return {
      method: 'GET',
      endpoint: '/api/2.0/engage',
      query: {
        where: `properties["$distinct_id"] == "${escapeQueryString(decodeURIComponent(profileMatch[1]))}"`,
      },
    };
  }

  if (path === '/mixpanel/cohorts' || path === '/mixpanel/cohorts/') {
    return {
      method: 'GET',
      endpoint: '/api/2.0/cohorts/list',
      query: {},
    };
  }

  const cohortMembersMatch = path.match(/^\/mixpanel\/cohorts\/([^/]+)\/members\.json$/);
  if (cohortMembersMatch?.[1]) {
    return {
      method: 'GET',
      endpoint: '/api/2.0/cohorts/members',
      query: { id: decodeURIComponent(cohortMembersMatch[1]) },
    };
  }

  throw new Error(`No Mixpanel read rule matched ${path}`);
}

function extractEventName(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const slugged = /^(.+)--[a-z0-9]+$/i.exec(decoded);
  if (!slugged?.[1]) {
    return decoded;
  }
  return slugged[1].replace(/-/g, ' ');
}

function escapeQueryString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
