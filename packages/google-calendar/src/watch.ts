import { randomUUID } from 'node:crypto';

import {
  GOOGLE_CALENDAR_DEFAULT_BASE_URL,
  GOOGLE_CALENDAR_WATCH_RENEWAL_WINDOW_MS,
  type ConnectionProvider,
  type GoogleCalendarChannelStopRequest,
  type GoogleCalendarWatchChannelMetadata,
  type GoogleCalendarWatchRequest,
  type GoogleCalendarWatchResponse,
} from './types.js';

export async function registerGoogleCalendarWatch(
  provider: ConnectionProvider,
  options: {
    webhookUrl: string;
    connectionId?: string;
    calendarId?: string;
    apiBaseUrl?: string;
    expirationMs?: number;
    token?: string;
  },
): Promise<GoogleCalendarWatchChannelMetadata> {
  const connectionId = resolveConnectionId(provider, options.connectionId);
  const calendarId = options.calendarId ?? 'primary';
  const channelId = randomUUID();
  const expiration = String(Date.now() + (options.expirationMs ?? GOOGLE_CALENDAR_WATCH_RENEWAL_WINDOW_MS));
  const body: GoogleCalendarWatchRequest = {
    id: channelId,
    type: 'webhook',
    address: options.webhookUrl,
    expiration,
    ...(options.token ? { token: options.token } : {}),
  };

  const baseUrl = options.apiBaseUrl ?? GOOGLE_CALENDAR_DEFAULT_BASE_URL;
  const response = await provider.proxy<GoogleCalendarWatchResponse>({
    method: 'POST',
    baseUrl,
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    connectionId,
    body,
  });

  return {
    googleCalendarConnectionId: connectionId,
    googleCalendarChannelId: channelId,
    ...(response.data?.resourceId ? { googleCalendarResourceId: response.data.resourceId } : {}),
    googleCalendarChannelExpiration: response.data?.expiration ?? expiration,
  };
}

export async function stopGoogleCalendarWatch(
  provider: ConnectionProvider,
  metadata: GoogleCalendarWatchChannelMetadata,
  options: { apiBaseUrl?: string; connectionId?: string } = {},
): Promise<void> {
  if (!metadata.googleCalendarChannelId || !metadata.googleCalendarResourceId) {
    return;
  }
  const connectionId = resolveConnectionId(provider, options.connectionId ?? metadata.googleCalendarConnectionId);

  const body: GoogleCalendarChannelStopRequest = {
    id: metadata.googleCalendarChannelId,
    resourceId: metadata.googleCalendarResourceId,
  };

  await provider.proxy({
    method: 'POST',
    baseUrl: options.apiBaseUrl ?? GOOGLE_CALENDAR_DEFAULT_BASE_URL,
    endpoint: '/calendar/v3/channels/stop',
    connectionId,
    body,
  });
}

export async function renewGoogleCalendarWatch(
  provider: ConnectionProvider,
  metadata: GoogleCalendarWatchChannelMetadata,
  options: {
    webhookUrl: string;
    connectionId?: string;
    calendarId?: string;
    apiBaseUrl?: string;
    expirationMs?: number;
    token?: string;
  },
): Promise<GoogleCalendarWatchChannelMetadata> {
  const next = await registerGoogleCalendarWatch(provider, options);
  try {
    await stopGoogleCalendarWatch(provider, metadata, options);
  } catch {
    // best effort, old channel may already be expired
  }
  return next;
}

function resolveConnectionId(provider: ConnectionProvider, explicitConnectionId?: string): string {
  const direct = explicitConnectionId?.trim();
  if (direct) return direct;

  const providerRecord = provider as unknown as {
    connectionId?: string;
    defaultConnectionId?: string;
    getConnectionId?: () => string | undefined;
  };
  const providerConnectionId =
    providerRecord.connectionId?.trim() ??
    providerRecord.defaultConnectionId?.trim() ??
    providerRecord.getConnectionId?.()?.trim();
  if (providerConnectionId) return providerConnectionId;

  throw new Error(
    'Google Calendar watch helpers require a connectionId option or a provider with connectionId/defaultConnectionId',
  );
}
