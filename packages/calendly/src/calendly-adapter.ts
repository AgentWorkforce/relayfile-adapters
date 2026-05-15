import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  calendlyEventTypePath,
  calendlyInviteePath,
  calendlyScheduledEventPath,
  computeCalendlyPath,
  normalizeCalendlyObjectType,
} from './path-mapper.js';
import { CALENDLY_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  CalendlyAdapterConfig,
  CalendlyEventType,
  CalendlyInvitee,
  CalendlyLocation,
  CalendlyQuestionAndAnswer,
  CalendlyScheduledEvent,
  CalendlyTracking,
  CalendlyUriReference,
  CalendlyUserReference,
  CalendlyWebhookPayload,
} from './types.js';

export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
}

export interface IngestError {
  path: string;
  error: string;
}

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: IngestError[];
}

export interface NormalizedWebhook {
  provider: string;
  connectionId?: string;
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
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
  deleteFile?(input: DeleteFileInput): Promise<void> | void;
}

export abstract class IntegrationAdapter {
  protected readonly client: RelayFileClientLike;
  protected readonly provider: ConnectionProvider;

  abstract readonly name: string;
  abstract readonly version: string;

  constructor(client: RelayFileClientLike, provider: ConnectionProvider) {
    this.client = client;
    this.provider = provider;
  }

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | CalendlyWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type CalendlyRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const CALENDLY_PROVIDER_NAME = 'calendly';
const SUPPORTED_EVENTS = CALENDLY_WEBHOOK_OBJECT_TYPES;

export class CalendlyAdapter extends IntegrationAdapter {
  override readonly name = CALENDLY_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: CalendlyAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: CalendlyAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.created`,
      `${objectType}.updated`,
      `${objectType}.canceled`,
      `${objectType}.deleted`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | CalendlyWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = computeCalendlyPath(normalized.objectType, normalized.objectId);
      const semantics = this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload);

      if (this.isDeleteEvent(normalized)) {
        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path });
          return {
            filesWritten: 0,
            filesUpdated: 0,
            filesDeleted: 1,
            paths: [path],
            errors: [],
          };
        }

        const deleteResult = await this.client.writeFile({
          workspaceId,
          path,
          content: this.renderContent(workspaceId, normalized, true),
          contentType: JSON_CONTENT_TYPE,
          semantics,
        });
        const counts = inferWriteCounts(deleteResult, true);
        return {
          filesWritten: counts.filesWritten,
          filesUpdated: counts.filesUpdated,
          filesDeleted: counts.filesDeleted,
          paths: [path],
          errors: [],
        };
      }

      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content: this.renderContent(workspaceId, normalized, false),
        contentType: JSON_CONTENT_TYPE,
        semantics,
      });
      const counts = inferWriteCounts(writeResult, false);
      return {
        filesWritten: counts.filesWritten,
        filesUpdated: counts.filesUpdated,
        filesDeleted: 0,
        paths: [path],
        errors: [],
      };
    } catch (error) {
      const fallbackPath = inferFallbackPath(event);
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: fallbackPath ? [fallbackPath] : [],
        errors: [
          {
            path: fallbackPath,
            error: toErrorMessage(error),
          },
        ],
      };
    }
  }

  override computePath(objectType: string, objectId: string): string {
    return computeCalendlyPath(objectType, objectId);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeCalendlyObjectType(objectType);
    const properties: Record<string, string> = {
      provider: CALENDLY_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'calendly.id': objectId,
      'calendly.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addStringProperty(properties, 'calendly.uri', payload.uri);
    addFirstStringProperty(properties, 'calendly.created_at', payload.created_at, payload.createdAt);
    addFirstStringProperty(properties, 'calendly.updated_at', payload.updated_at, payload.updatedAt);

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'calendly.webhook.action', webhook.action);
      addStringProperty(properties, 'calendly.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'calendly.webhook.object_id', webhook.objectId);
      addStringProperty(properties, 'calendly.webhook.delivery_id', webhook.deliveryId);
      addStringProperty(properties, 'calendly.webhook.created_at', webhook.createdAt);
    }

    switch (normalizedType) {
      case 'scheduled_event':
        applyScheduledEventSemantics(properties, relations, comments, payload as CalendlyRecord);
        break;
      case 'invitee':
        applyInviteeSemantics(properties, relations, comments, payload as CalendlyRecord);
        break;
      case 'event_type':
        applyEventTypeSemantics(properties, comments, payload as CalendlyRecord);
        break;
    }

    const semantics: FileSemantics = {
      properties,
      relations: sortStrings(relations),
    };
    if (comments.length > 0) {
      semantics.comments = comments;
    }
    return compactSemantics(semantics);
  }

  private normalizeEvent(event: NormalizedWebhook | CalendlyWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || CALENDLY_PROVIDER_NAME,
        eventType: event.eventType,
        objectType: normalizeCalendlyObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const payload = normalizePayloadRecord(event.payload);
    const objectType = inferObjectTypeFromEvent(event.event, payload);
    const objectId = extractPayloadId(payload);
    if (!objectId) {
      throw new Error(`Calendly ${objectType} webhook is missing payload uuid or uri`);
    }

    const normalizedPayload = mergeCalendlyPayload(event, payload, objectType, objectId);
    const normalized: NormalizedWebhook = {
      provider: this.config.provider || CALENDLY_PROVIDER_NAME,
      eventType: `${objectType}.${inferActionFromEvent(event.event)}`,
      objectType,
      objectId,
      payload: normalizedPayload,
    };
    if (this.config.connectionId) {
      normalized.connectionId = this.config.connectionId;
    }
    return normalized;
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'deleted';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeCalendlyObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyScheduledEventSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: CalendlyRecord,
): void {
  const event = payload as Partial<CalendlyScheduledEvent> & CalendlyRecord;

  addStringProperty(properties, 'calendly.name', event.name);
  addStringProperty(properties, 'calendly.status', event.status);
  addFirstStringProperty(properties, 'calendly.start_time', event.start_time, event.startTime);
  addFirstStringProperty(properties, 'calendly.end_time', event.end_time, event.endTime);
  addFirstStringProperty(properties, 'calendly.created_at', event.created_at, event.createdAt);
  addFirstStringProperty(properties, 'calendly.updated_at', event.updated_at, event.updatedAt);

  const eventTypeId = extractReferenceId(event.event_type);
  if (eventTypeId) {
    relations.add(calendlyEventTypePath(eventTypeId));
    addStringProperty(properties, 'calendly.event_type_id', eventTypeId);
  }

  const memberships = asUserReferences(event.event_memberships);
  if (memberships.length > 0) {
    addStringListProperty(properties, 'calendly.host_uris', memberships.map((member) => member.uri));
    addStringListProperty(properties, 'calendly.host_names', memberships.map((member) => member.name).filter(isString));
    addStringListProperty(properties, 'calendly.host_emails', memberships.map((member) => member.email).filter(isString));
  }

  const location = getRecord(event.location) as Partial<CalendlyLocation> | undefined;
  if (location) {
    addStringProperty(properties, 'calendly.location_type', location.type);
    addStringProperty(properties, 'calendly.location', location.location);
    addStringProperty(properties, 'calendly.join_url', location.join_url);
    addStringProperty(properties, 'calendly.location_status', location.status);
    addStringProperty(properties, 'calendly.location_info', location.additional_info);
  }

  const calendarEvent = getRecord(event.calendar_event);
  if (calendarEvent) {
    addStringProperty(properties, 'calendly.calendar_event_kind', calendarEvent.kind);
    addStringProperty(properties, 'calendly.calendar_event_external_id', calendarEvent.external_id);
  }

  const counter = getRecord(event.invitees_counter);
  if (counter) {
    addNumberProperty(properties, 'calendly.invitees_total', counter.total);
    addNumberProperty(properties, 'calendly.invitees_active', counter.active);
    addNumberProperty(properties, 'calendly.invitees_limit', counter.limit);
  }

  const guests = asInvitees(event.event_guests);
  if (guests.length > 0) {
    for (const guest of guests) {
      const guestId = extractPayloadId(guest as unknown as CalendlyRecord);
      if (guestId) {
        relations.add(calendlyInviteePath(guestId));
      }
    }
    addStringListProperty(properties, 'calendly.guest_emails', guests.map((guest) => guest.email).filter(isString));
    addStringListProperty(properties, 'calendly.guest_names', guests.map((guest) => guest.name).filter(isString));
  }

  const cancellation = getRecord(event.cancellation);
  if (cancellation) {
    addStringProperty(properties, 'calendly.canceled_by', cancellation.canceled_by);
    addStringProperty(properties, 'calendly.canceler_type', cancellation.canceler_type);
    addStringProperty(properties, 'calendly.canceled_at', cancellation.created_at);
    const reason = asString(cancellation.reason);
    if (reason) {
      properties['calendly.cancellation_reason_length'] = String(reason.length);
      comments.push(`Cancellation reason: ${reason}`);
    }
  }
}

function applyInviteeSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: CalendlyRecord,
): void {
  const invitee = payload as Partial<CalendlyInvitee> & CalendlyRecord;

  addStringProperty(properties, 'calendly.email', invitee.email);
  addStringProperty(properties, 'calendly.name', invitee.name);
  addStringProperty(properties, 'calendly.first_name', invitee.first_name);
  addStringProperty(properties, 'calendly.last_name', invitee.last_name);
  addStringProperty(properties, 'calendly.status', invitee.status);
  addStringProperty(properties, 'calendly.timezone', invitee.timezone);
  addFirstStringProperty(properties, 'calendly.created_at', invitee.created_at, invitee.createdAt);
  addFirstStringProperty(properties, 'calendly.updated_at', invitee.updated_at, invitee.updatedAt);
  addBooleanProperty(properties, 'calendly.canceled', invitee.canceled);
  addBooleanProperty(properties, 'calendly.rescheduled', invitee.rescheduled);
  addStringProperty(properties, 'calendly.cancel_url', invitee.cancel_url);
  addStringProperty(properties, 'calendly.reschedule_url', invitee.reschedule_url);
  addStringProperty(properties, 'calendly.old_invitee', invitee.old_invitee);
  addStringProperty(properties, 'calendly.new_invitee', invitee.new_invitee);

  const eventId = extractReferenceId(invitee.event);
  if (eventId) {
    relations.add(calendlyScheduledEventPath(eventId));
    addStringProperty(properties, 'calendly.scheduled_event_id', eventId);
  }

  const payment = getRecord(invitee.payment);
  if (payment) {
    addStringProperty(properties, 'calendly.payment_external_id', payment.external_id);
    addStringProperty(properties, 'calendly.payment_provider', payment.provider);
    addStringProperty(properties, 'calendly.payment_currency', payment.currency);
    addNumberProperty(properties, 'calendly.payment_amount', payment.amount);
    addBooleanProperty(properties, 'calendly.payment_successful', payment.successful);
  }

  const questionsAndAnswers = asQuestionAndAnswers(invitee.questions_and_answers);
  if (questionsAndAnswers.length > 0) {
    properties['calendly.question_count'] = String(questionsAndAnswers.length);
    for (const qa of questionsAndAnswers) {
      const question = asString(qa.question);
      const answer = asString(qa.answer);
      if (question && answer) {
        comments.push(`${question}: ${answer}`);
      }
    }
  }

  const tracking = getRecord(invitee.tracking) as Partial<CalendlyTracking> | undefined;
  if (tracking) {
    addStringProperty(properties, 'calendly.utm_campaign', tracking.utm_campaign);
    addStringProperty(properties, 'calendly.utm_source', tracking.utm_source);
    addStringProperty(properties, 'calendly.utm_medium', tracking.utm_medium);
    addStringProperty(properties, 'calendly.utm_content', tracking.utm_content);
    addStringProperty(properties, 'calendly.utm_term', tracking.utm_term);
    addStringProperty(properties, 'calendly.salesforce_uuid', tracking.salesforce_uuid);
  }
}

function applyEventTypeSemantics(
  properties: Record<string, string>,
  comments: string[],
  payload: CalendlyRecord,
): void {
  const eventType = payload as Partial<CalendlyEventType> & CalendlyRecord;

  addStringProperty(properties, 'calendly.name', eventType.name);
  addStringProperty(properties, 'calendly.slug', eventType.slug);
  addStringProperty(properties, 'calendly.color', eventType.color);
  addStringProperty(properties, 'calendly.kind', eventType.kind);
  addStringProperty(properties, 'calendly.pooling_type', eventType.pooling_type);
  addStringProperty(properties, 'calendly.type', eventType.type);
  addStringProperty(properties, 'calendly.scheduling_url', eventType.scheduling_url);
  addFirstStringProperty(properties, 'calendly.created_at', eventType.created_at, eventType.createdAt);
  addFirstStringProperty(properties, 'calendly.updated_at', eventType.updated_at, eventType.updatedAt);
  addBooleanProperty(properties, 'calendly.active', eventType.active);
  addNumberProperty(properties, 'calendly.duration_minutes', eventType.duration);

  const profile = getRecord(eventType.profile);
  if (profile) {
    addStringProperty(properties, 'calendly.profile_type', profile.type);
    addStringProperty(properties, 'calendly.profile_name', profile.name);
    addStringProperty(properties, 'calendly.profile_owner', profile.owner);
  }

  const description = asString(eventType.description_plain);
  if (description) {
    properties['calendly.description_length'] = String(description.length);
    comments.push(description);
  }

  const internalNote = asString(eventType.internal_note);
  if (internalNote) {
    comments.push(`Internal note: ${internalNote}`);
  }
}

function inferObjectTypeFromEvent(event: string, payload: CalendlyRecord): 'event_type' | 'invitee' | 'scheduled_event' {
  const eventPrefix = event.split('.')[0];
  if (eventPrefix) {
    return normalizeCalendlyObjectType(eventPrefix);
  }
  if (payload.email !== undefined && payload.event !== undefined) {
    return 'invitee';
  }
  if (payload.duration !== undefined || payload.scheduling_url !== undefined) {
    return 'event_type';
  }
  return 'scheduled_event';
}

function inferActionFromEvent(event: string): string {
  const action = event.split('.').at(-1);
  if (!action) {
    return 'updated';
  }
  if (action === 'create') return 'created';
  if (action === 'update') return 'updated';
  if (action === 'cancel') return 'canceled';
  if (action === 'delete') return 'deleted';
  return action.toLowerCase();
}

function mergeCalendlyPayload(
  event: CalendlyWebhookPayload,
  payload: CalendlyRecord,
  objectType: string,
  objectId: string,
): CalendlyRecord {
  const merged: CalendlyRecord = {
    ...payload,
    _webhook: {
      action: inferActionFromEvent(event.event),
      createdAt: event.created_at,
      eventType: `${objectType}.${inferActionFromEvent(event.event)}`,
      objectId,
      objectType,
    },
  };
  return merged;
}

function normalizePayloadRecord(payload: CalendlyWebhookPayload['payload']): CalendlyRecord {
  if (!isRecord(payload)) {
    throw new Error('Calendly webhook payload payload must be an object');
  }
  return payload;
}

function getWebhookAction(payload: Record<string, unknown>): string | undefined {
  const webhook = getRecord(payload._webhook);
  const action = asString(webhook?.action);
  return action ? action.toLowerCase() : undefined;
}

function getEventAction(eventType: string): string | undefined {
  const parts = eventType.split('.');
  const action = parts.at(-1);
  return action ? action.toLowerCase() : undefined;
}

function inferFallbackPath(event: NormalizedWebhook | CalendlyWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeCalendlyPath(event.objectType, event.objectId);
    }
    const payload = normalizePayloadRecord(event.payload);
    const objectType = inferObjectTypeFromEvent(event.event, payload);
    const objectId = extractPayloadId(payload);
    return objectId ? computeCalendlyPath(objectType, objectId) : '/calendly/unresolved-webhook.json';
  } catch {
    return '/calendly/unresolved-webhook.json';
  }
}

function extractPayloadId(payload: CalendlyRecord): string | undefined {
  const direct =
    asString(payload.uuid) ??
    asString(payload.id) ??
    asString(payload.objectId) ??
    asString(payload.object_id);
  if (direct) {
    return direct;
  }
  const uri = asString(payload.uri);
  if (uri) {
    return extractLastUriSegment(uri);
  }
  return undefined;
}

function extractReferenceId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return extractLastUriSegment(value) ?? value;
  }
  const record = getRecord(value);
  if (!record) {
    return undefined;
  }
  return extractPayloadId(record) ?? asString(record.uri);
}

function extractLastUriSegment(uri: string): string | undefined {
  const parts = uri.split('/').map((part) => part.trim()).filter((part) => part.length > 0);
  return parts.at(-1);
}

function inferWriteCounts(
  writeResult: WriteFileResult | void,
  deleted: boolean,
): { filesDeleted: number; filesUpdated: number; filesWritten: number } {
  if (deleted) {
    return { filesDeleted: 1, filesUpdated: 0, filesWritten: 0 };
  }
  if (writeResult?.updated || writeResult?.status === 'updated') {
    return { filesDeleted: 0, filesUpdated: 1, filesWritten: 0 };
  }
  return { filesDeleted: 0, filesUpdated: 0, filesWritten: 1 };
}

function isNormalizedWebhook(event: NormalizedWebhook | CalendlyWebhookPayload): event is NormalizedWebhook {
  return (
    isRecord(event) &&
    typeof event.eventType === 'string' &&
    typeof event.objectType === 'string' &&
    typeof event.objectId === 'string' &&
    isRecord(event.payload)
  );
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function compactSemantics(semantics: FileSemantics): FileSemantics {
  const compacted: FileSemantics = {};
  if (semantics.properties && Object.keys(semantics.properties).length > 0) {
    compacted.properties = semantics.properties;
  }
  if (semantics.relations && semantics.relations.length > 0) {
    compacted.relations = semantics.relations;
  }
  if (semantics.permissions && semantics.permissions.length > 0) {
    compacted.permissions = semantics.permissions;
  }
  if (semantics.comments && semantics.comments.length > 0) {
    compacted.comments = semantics.comments;
  }
  return compacted;
}

function addStringProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const stringValue = asString(value);
  if (stringValue) {
    properties[key] = stringValue;
  }
}

function addFirstStringProperty(properties: Record<string, string>, key: string, ...values: unknown[]): void {
  for (const value of values) {
    const stringValue = asString(value);
    if (stringValue) {
      properties[key] = stringValue;
      return;
    }
  }
}

function addNumberProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const numberValue = asNumber(value);
  if (numberValue !== undefined) {
    properties[key] = String(numberValue);
  }
}

function addBooleanProperty(properties: Record<string, string>, key: string, value: unknown): void {
  if (typeof value === 'boolean') {
    properties[key] = String(value);
  }
}

function addStringListProperty(properties: Record<string, string>, key: string, values: readonly string[]): void {
  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (cleaned.length > 0) {
    properties[key] = cleaned.sort((left, right) => left.localeCompare(right)).join(', ');
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asUserReferences(value: unknown): CalendlyUserReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isCalendlyUriReference);
}

function asInvitees(value: unknown): CalendlyInvitee[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isCalendlyUriReference) as CalendlyInvitee[];
}

function asQuestionAndAnswers(value: unknown): CalendlyQuestionAndAnswer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord) as CalendlyQuestionAndAnswer[];
}

function isCalendlyUriReference(value: unknown): value is CalendlyUriReference {
  return isRecord(value) && typeof value.uri === 'string' && value.uri.trim().length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getRecord(value: unknown): CalendlyRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is CalendlyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortStrings(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
