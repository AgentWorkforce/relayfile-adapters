import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeGoogleCalendarPath,
  googleCalendarCalendarPath,
  googleCalendarEventPath,
  normalizeGoogleCalendarObjectType,
} from './path-mapper.js';
import { ingestGoogleCalendarEvents, listGoogleCalendarEventChanges } from './sync.js';
import {
  GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
  GOOGLE_CALENDAR_PROVIDER_NAME,
  type FileSemantics,
  type GoogleCalendarAdapterConfig,
  type GoogleCalendarEvent,
  type GoogleCalendarNormalizedWebhook,
  type GoogleCalendarSyncCheckpoint,
  type GoogleCalendarSyncResult,
  type RelayFileClientLike,
} from './types.js';
import { normalizeGoogleCalendarWebhook } from './webhook-normalizer.js';
import { resolveGoogleCalendarWritebackRequest } from './writeback.js';

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: Array<{ path: string; error: string }>;
}

export class GoogleCalendarAdapter {
  readonly name = GOOGLE_CALENDAR_PROVIDER_NAME;
  readonly version = '0.1.0';

  constructor(
    protected readonly client: RelayFileClientLike,
    protected readonly provider: ConnectionProvider,
    readonly config: GoogleCalendarAdapterConfig = {},
  ) {}

  supportedEvents(): string[] {
    return ['calendar.exists', 'calendar.sync', 'calendar.not_exists'];
  }

  normalizeWebhook(
    payload: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): GoogleCalendarNormalizedWebhook {
    const options: { connectionId?: string; providerConfigKey?: string; calendarId?: string } = {};
    if (this.config.connectionId) options.connectionId = this.config.connectionId;
    if (this.config.providerConfigKey) options.providerConfigKey = this.config.providerConfigKey;
    if (this.config.calendarId) options.calendarId = this.config.calendarId;
    return normalizeGoogleCalendarWebhook(payload, headers, options);
  }

  computePath(objectType: string, objectId: string, calendarId?: string): string {
    return computeGoogleCalendarPath(objectType, objectId, calendarId ?? this.config.calendarId);
  }

  computeSemantics(objectType: string, objectId: string, payload: Record<string, unknown>): FileSemantics {
    const normalizedType = normalizeGoogleCalendarObjectType(objectType);
    const calendarId = readString(payload.calendarId) ?? this.config.calendarId ?? GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID;
    const properties: Record<string, string> = {
      provider: GOOGLE_CALENDAR_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'google_calendar.calendar_id': calendarId,
    };
    const relations = [googleCalendarCalendarPath(calendarId)];
    const comments: string[] = [];

    if (normalizedType === 'event') {
      addString(properties, 'google_calendar.status', payload.status);
      addString(properties, 'google_calendar.summary', payload.summary);
      addString(properties, 'google_calendar.updated', payload.updated);
      const description = readString(payload.description);
      if (description) comments.push(description);
    }

    return { properties, relations, comments };
  }

  async ingestWebhook(workspaceId: string, event: GoogleCalendarNormalizedWebhook): Promise<IngestResult> {
    if (!event.shouldSync) {
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: [],
        errors: [],
      };
    }

    const syncResult = await this.sync(workspaceId, {
      calendarId: event.objectId,
    });

    return {
      filesWritten: syncResult.filesWritten,
      filesUpdated: syncResult.filesUpdated,
      filesDeleted: syncResult.filesDeleted,
      paths: syncResult.paths,
      errors: syncResult.errors,
    };
  }

  async sync(
    workspaceId: string,
    options: {
      checkpoint?: GoogleCalendarSyncCheckpoint;
      calendarId?: string;
    } = {},
  ): Promise<GoogleCalendarSyncResult> {
    const config = {
      ...this.config,
      ...(options.calendarId ? { calendarId: options.calendarId } : {}),
    };
    const changes = await listGoogleCalendarEventChanges(this.provider, options.checkpoint, config);
    const ingestResult = await ingestGoogleCalendarEvents(this.client, workspaceId, changes.events, config);
    return changes.nextSyncToken
      ? {
          ...ingestResult,
          syncToken: changes.nextSyncToken,
        }
      : ingestResult;
  }

  async writeBack(path: string, content: string) {
    return resolveGoogleCalendarWritebackRequest(path, content);
  }

  materializeCalendarMetadata(calendarId?: string): { path: string; payload: Record<string, unknown> } {
    const resolvedCalendarId = calendarId ?? this.config.calendarId ?? GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID;
    return {
      path: googleCalendarCalendarPath(resolvedCalendarId),
      payload: {
        provider: GOOGLE_CALENDAR_PROVIDER_NAME,
        objectType: 'calendar',
        objectId: resolvedCalendarId,
        calendarId: resolvedCalendarId,
      },
    };
  }

  materializeEvent(event: GoogleCalendarEvent, calendarId?: string): { path: string; payload: Record<string, unknown> } {
    const resolvedCalendarId = event.calendarId ?? calendarId ?? this.config.calendarId ?? GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID;
    return {
      path: googleCalendarEventPath(event.id, resolvedCalendarId),
      payload: {
        provider: GOOGLE_CALENDAR_PROVIDER_NAME,
        objectType: 'event',
        objectId: event.id,
        calendarId: resolvedCalendarId,
        payload: event,
      },
    };
  }
}

function addString(target: Record<string, string>, key: string, value: unknown): void {
  const normalized = readString(value);
  if (normalized) target[key] = normalized;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
