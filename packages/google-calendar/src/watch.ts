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
    calendarId?: string;
    apiBaseUrl?: string;
    expirationMs?: number;
  },
): Promise<GoogleCalendarWatchChannelMetadata> {
  const calendarId = options.calendarId ?? 'primary';
  const channelId = randomUUID();
  const expiration = String(Date.now() + (options.expirationMs ?? GOOGLE_CALENDAR_WATCH_RENEWAL_WINDOW_MS));
  const body: GoogleCalendarWatchRequest = {
    id: channelId,
    type: 'webhook',
    address: options.webhookUrl,
    expiration,
  };

  const baseUrl = options.apiBaseUrl ?? GOOGLE_CALENDAR_DEFAULT_BASE_URL;
  const response = await provider.proxy<GoogleCalendarWatchResponse>({
    method: 'POST',
    baseUrl,
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    connectionId: calendarId,
    body,
  });

  return {
    googleCalendarChannelId: channelId,
    ...(response.data?.resourceId ? { googleCalendarResourceId: response.data.resourceId } : {}),
    googleCalendarChannelExpiration: response.data?.expiration ?? expiration,
  };
}

export async function stopGoogleCalendarWatch(
  provider: ConnectionProvider,
  metadata: GoogleCalendarWatchChannelMetadata,
  options: { apiBaseUrl?: string } = {},
): Promise<void> {
  if (!metadata.googleCalendarChannelId || !metadata.googleCalendarResourceId) {
    return;
  }

  const body: GoogleCalendarChannelStopRequest = {
    id: metadata.googleCalendarChannelId,
    resourceId: metadata.googleCalendarResourceId,
  };

  await provider.proxy({
    method: 'POST',
    baseUrl: options.apiBaseUrl ?? GOOGLE_CALENDAR_DEFAULT_BASE_URL,
    endpoint: '/calendar/v3/channels/stop',
    connectionId: metadata.googleCalendarChannelId,
    body,
  });
}

export async function renewGoogleCalendarWatch(
  provider: ConnectionProvider,
  metadata: GoogleCalendarWatchChannelMetadata,
  options: {
    webhookUrl: string;
    calendarId?: string;
    apiBaseUrl?: string;
    expirationMs?: number;
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
