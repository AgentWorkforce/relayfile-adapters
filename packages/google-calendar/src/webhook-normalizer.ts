import {
  GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
  GOOGLE_CALENDAR_PROVIDER_NAME,
  type GoogleCalendarNormalizedWebhook,
  type GoogleCalendarWebhookHeaders,
} from './types.js';

export function normalizeGoogleCalendarWebhook(
  payload: unknown,
  headers: Record<string, string | string[] | undefined>,
  options: { connectionId?: string; providerConfigKey?: string; calendarId?: string } = {},
): GoogleCalendarNormalizedWebhook {
  const normalizedHeaders = {
    ...normalizeHeaders(headers),
    ...normalizeHeaders(extractForwardedHeaders(payload)),
  };
  const payloadRecord = isRecord(payload) ? payload : {};
  const resourceState = normalizedHeaders['x-goog-resource-state'] ?? 'unknown';
  const calendarId =
    readCalendarId(payload) ??
    readCalendarIdFromResourceUri(normalizedHeaders['x-goog-resource-uri']) ??
    options.calendarId ??
    GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID;

  return {
    provider: GOOGLE_CALENDAR_PROVIDER_NAME,
    connectionId: readOptionalString(payloadRecord.connectionId) ?? options.connectionId,
    providerConfigKey: readOptionalString(payloadRecord.providerConfigKey) ?? options.providerConfigKey,
    eventType: `calendar.${resourceState}`,
    objectType: resourceState === 'sync' ? 'calendar' : 'event',
    objectId: calendarId,
    shouldSync: isSyncWorthyResourceState(resourceState),
    headers: normalizedHeaders,
    payload: {
      ...(isRecord(payload) ? payload : {}),
      _webhook: {
        calendarId,
        resourceState,
        channelId: normalizedHeaders['x-goog-channel-id'],
        channelExpiration: normalizedHeaders['x-goog-channel-expiration'],
        messageNumber: normalizedHeaders['x-goog-message-number'],
        resourceId: normalizedHeaders['x-goog-resource-id'],
        resourceUri: normalizedHeaders['x-goog-resource-uri'],
      },
    },
  };
}

function extractForwardedHeaders(payload: unknown): Record<string, string | string[] | undefined> {
  if (!isRecord(payload)) return {};
  const forwardedPayload = isRecord(payload.payload) ? payload.payload : undefined;
  const forwardedHeaders = isRecord(payload.headers) ? payload.headers : undefined;
  const source = forwardedPayload ?? forwardedHeaders;
  if (!source) return {};

  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' || Array.isArray(value)) {
      headers[key] = value as string | string[];
    }
  }
  return headers;
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): GoogleCalendarWebhookHeaders {
  const normalized: GoogleCalendarWebhookHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const headerValue = Array.isArray(value) ? value[0] : value;
    if (!headerValue) continue;
    normalized[key.toLowerCase() as keyof GoogleCalendarWebhookHeaders] = headerValue;
  }
  return normalized;
}

function readCalendarId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const direct = readOptionalString(payload.calendarId) ?? readOptionalString(payload.calendar_id);
  if (direct) return direct;
  const metadata = isRecord(payload.metadata) ? payload.metadata : undefined;
  const metadataCalendarId = readOptionalString(metadata?.calendarId) ?? readOptionalString(metadata?.calendar_id);
  if (metadataCalendarId) return metadataCalendarId;
  return isRecord(payload.payload) ? readCalendarId(payload.payload) : undefined;
}

function readCalendarIdFromResourceUri(resourceUri: string | undefined): string | undefined {
  if (!resourceUri) return undefined;
  const match = resourceUri.match(/\/calendar\/v3\/calendars\/([^/]+)\/events/u);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isSyncWorthyResourceState(resourceState: string): boolean {
  return resourceState === 'exists' || resourceState === 'not_exists' || resourceState === 'sync';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
