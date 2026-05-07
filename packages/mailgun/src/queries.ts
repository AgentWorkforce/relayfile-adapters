import type { MailgunApiRequest } from './types.js';

export const MAILGUN_MESSAGES_ROUTE = '/v3/{domain}/messages';
export const MAILGUN_EVENTS_ROUTE = '/v3/{domain}/events';
export const MAILGUN_LISTS_ROUTE = '/v3/lists';

function encodeEndpointSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Mailgun endpoint segment must be a non-empty string');
  }
  return encodeURIComponent(trimmed);
}

function interpolateDomain(route: string, domain: string): string {
  return route.replace('{domain}', encodeEndpointSegment(domain));
}

export function resolveQueryRequest(path: string): MailgunApiRequest {
  const messagesMatch = /^\/mailgun\/domains\/([^/]+)\/messages(?:\/([^/]+)\.json)?$/.exec(path);
  if (messagesMatch?.[1]) {
    const domain = decodeURIComponent(messagesMatch[1]);
    const messageId = messagesMatch[2] ? decodeURIComponent(messagesMatch[2]) : undefined;
    const request: MailgunApiRequest = {
      method: 'GET',
      endpoint: interpolateDomain(MAILGUN_MESSAGES_ROUTE, domain),
    };
    if (messageId) {
      request.query = { 'message-id': messageId };
    }
    return request;
  }

  const eventsMatch = /^\/mailgun\/domains\/([^/]+)\/events(?:\/([^/]+)\.json)?$/.exec(path);
  if (eventsMatch?.[1]) {
    const domain = decodeURIComponent(eventsMatch[1]);
    const eventId = eventsMatch[2] ? decodeURIComponent(eventsMatch[2]) : undefined;
    const request: MailgunApiRequest = {
      method: 'GET',
      endpoint: interpolateDomain(MAILGUN_EVENTS_ROUTE, domain),
    };
    if (eventId) {
      request.query = { id: eventId };
    }
    return request;
  }

  if (path === '/mailgun/lists' || path === '/mailgun/lists/') {
    return {
      method: 'GET',
      endpoint: MAILGUN_LISTS_ROUTE,
    };
  }

  const listMatch = /^\/mailgun\/lists\/([^/]+)\.json$/.exec(path);
  if (listMatch?.[1]) {
    return {
      method: 'GET',
      endpoint: `${MAILGUN_LISTS_ROUTE}/${encodeEndpointSegment(decodeURIComponent(listMatch[1]))}`,
    };
  }

  throw new Error(`No Mailgun query rule matched ${path}`);
}
