import type { BulkWriteFile, ConnectionProvider } from '@relayfile/sdk';

export type { BulkWriteFile, ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

export const GOOGLE_CALENDAR_PROVIDER_NAME = 'google-calendar';
export const GOOGLE_CALENDAR_PATH_ROOT = '/google-calendar';
export const GOOGLE_CALENDAR_DEFAULT_BASE_URL = 'https://www.googleapis.com';
export const GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID = 'primary';
export const GOOGLE_CALENDAR_DEFAULT_PAGE_SIZE = 250;
export const GOOGLE_CALENDAR_WATCH_RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
export type JsonArray = JsonValue[];

export interface GoogleCalendarAdapterConfig {
  apiBaseUrl?: string;
  calendarId?: string;
  connectionId?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
  syncWindowDays?: number;
  pageSize?: number;
}

export interface GoogleCalendarDateTimeValue {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarPerson {
  email?: string;
  displayName?: string;
  self?: boolean;
}

export interface GoogleCalendarAttendee extends GoogleCalendarPerson {
  optional?: boolean;
  organizer?: boolean;
  resource?: boolean;
  responseStatus?: string;
}

export interface GoogleCalendarConferenceEntryPoint {
  entryPointType?: string;
  label?: string;
  meetingCode?: string;
  passcode?: string;
  pin?: string;
  uri?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  iCalUID?: string;
  etag?: string;
  sequence?: number;
  recurringEventId?: string;
  eventType?: string;
  visibility?: string;
  calendarId?: string;
  deleted?: boolean;
  start?: GoogleCalendarDateTimeValue;
  end?: GoogleCalendarDateTimeValue;
  organizer?: GoogleCalendarPerson;
  creator?: GoogleCalendarPerson;
  attendees?: GoogleCalendarAttendee[];
  conferenceData?: {
    entryPoints?: GoogleCalendarConferenceEntryPoint[];
  };
  [key: string]: unknown;
}

export interface GoogleCalendarEventsListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleCalendarSyncCheckpoint {
  syncToken?: string;
}

export interface GoogleCalendarSyncPage {
  events: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleCalendarSyncResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: Array<{ path: string; error: string }>;
  syncToken?: string | undefined;
}

export interface GoogleCalendarIncrementalSyncResult {
  events: GoogleCalendarEvent[];
  nextSyncToken?: string | undefined;
}

export interface GoogleCalendarWatchChannelMetadata {
  googleCalendarChannelId?: string | undefined;
  googleCalendarResourceId?: string | undefined;
  googleCalendarChannelExpiration?: string | undefined;
}

export interface GoogleCalendarWatchRequest {
  id: string;
  type: 'webhook';
  address: string;
  expiration: string;
}

export interface GoogleCalendarWatchResponse {
  id?: string;
  resourceId?: string;
  resourceUri?: string;
  expiration?: string;
}

export interface GoogleCalendarChannelStopRequest {
  id: string;
  resourceId: string;
}

export interface GoogleCalendarWebhookHeaders {
  'x-goog-channel-id'?: string;
  'x-goog-channel-expiration'?: string;
  'x-goog-message-number'?: string;
  'x-goog-resource-id'?: string;
  'x-goog-resource-state'?: string;
  'x-goog-resource-uri'?: string;
  'x-goog-channel-token'?: string;
}

export interface GoogleCalendarNormalizedWebhook {
  provider: string;
  connectionId?: string | undefined;
  providerConfigKey?: string | undefined;
  eventType: string;
  objectType: 'calendar' | 'event';
  objectId: string;
  payload: Record<string, unknown>;
  headers: GoogleCalendarWebhookHeaders;
  shouldSync: boolean;
}

export interface GoogleCalendarWritebackRequest {
  action: 'create_event' | 'update_event' | 'delete_event';
  method: 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  body?: Record<string, unknown>;
}

export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
}

export interface WriteFileInput {
  workspaceId: string;
  path: string;
  content: string;
  contentType?: string;
  semantics?: FileSemantics;
}

export interface WriteFileResult {
  created?: boolean;
  updated?: boolean;
  status?: 'created' | 'updated' | 'queued' | 'pending';
}

export interface DeleteFileInput {
  workspaceId: string;
  path: string;
}

export interface RelayFileClientLike {
  writeFile(input: WriteFileInput): Promise<WriteFileResult | void>;
  writeFiles?(workspaceId: string, files: BulkWriteFile[]): Promise<unknown>;
  deleteFile?(input: DeleteFileInput): Promise<void> | void;
}
