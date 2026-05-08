import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeSendGridPath,
  normalizeSendGridObjectType,
  sendGridContactPath,
  sendGridMailPath,
} from './path-mapper.js';
import { SENDGRID_WEBHOOK_OBJECT_TYPES } from './types.js';
import { normalizeSendGridWebhookEvents } from './webhook-normalizer.js';
import type {
  SendGridAdapterConfig,
  SendGridContact,
  SendGridEvent,
  SendGridMail,
  SendGridMailAddress,
  SendGridMailPersonalization,
  SendGridWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | SendGridWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type SendGridRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SENDGRID_PROVIDER_NAME = 'sendgrid';
const SUPPORTED_EVENTS = SENDGRID_WEBHOOK_OBJECT_TYPES;

export class SendGridAdapter extends IntegrationAdapter {
  override readonly name = SENDGRID_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: SendGridAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: SendGridAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => {
      if (objectType === 'event') {
        return [
          'event.bounce',
          'event.click',
          'event.deferred',
          'event.delivered',
          'event.dropped',
          'event.group_resubscribe',
          'event.group_unsubscribe',
          'event.open',
          'event.processed',
          'event.spamreport',
          'event.unsubscribe',
        ];
      }
      return [`${objectType}.create`, `${objectType}.update`, `${objectType}.delete`];
    });
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | SendGridWebhookPayload,
  ): Promise<IngestResult> {
    let normalizedEvents: NormalizedWebhook[];
    try {
      normalizedEvents = this.normalizeEvents(event);
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

    const results: IngestResult[] = [];
    for (const normalized of normalizedEvents) {
      try {
        results.push(await this.ingestNormalizedWebhook(workspaceId, normalized));
      } catch (error) {
        const path = computeSendGridPath(normalized.objectType, normalized.objectId);
        results.push({
          filesWritten: 0,
          filesUpdated: 0,
          filesDeleted: 0,
          paths: [path],
          errors: [
            {
              path,
              error: toErrorMessage(error),
            },
          ],
        });
      }
    }

    return aggregateIngestResults(results);
  }

  override computePath(objectType: string, objectId: string): string {
    return computeSendGridPath(objectType, objectId);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeSendGridObjectType(objectType);
    const properties: Record<string, string> = {
      provider: SENDGRID_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'sendgrid.id': objectId,
      'sendgrid.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'sendgrid.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'sendgrid.webhook.object_type', webhook.objectType);
      addStringProperty(properties, 'sendgrid.webhook.timestamp', webhook.timestamp);
      addStringProperty(properties, 'sendgrid.webhook.delivery_id', webhook.deliveryId);
    }

    switch (normalizedType) {
      case 'mail':
        applyMailSemantics(properties, relations, payload as SendGridRecord);
        break;
      case 'event':
        applyEventSemantics(properties, relations, comments, payload as SendGridRecord);
        break;
      case 'contact':
        applyContactSemantics(properties, relations, payload as SendGridRecord);
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

  private normalizeEvents(event: NormalizedWebhook | SendGridWebhookPayload): NormalizedWebhook[] {
    if (isNormalizedWebhook(event)) {
      const objectType = normalizeSendGridObjectType(event.objectType);
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || SENDGRID_PROVIDER_NAME,
        eventType: event.eventType,
        objectType,
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return [normalized];
    }

    return normalizeSendGridWebhookEvents(event).map((normalizedEvent) => {
      const provider = this.config.provider || normalizedEvent.provider || SENDGRID_PROVIDER_NAME;
      const normalized: NormalizedWebhook = {
        provider,
        eventType: normalizedEvent.eventType,
        objectType: normalizeSendGridObjectType(normalizedEvent.objectType),
        objectId: normalizedEvent.objectId.trim(),
        payload: buildAdapterPayload(normalizedEvent.payload, {
          action: getEventAction(normalizedEvent.eventType),
          objectId: normalizedEvent.objectId,
          objectType: normalizedEvent.objectType,
          provider,
        }),
      };
      const connectionId = normalizedEvent.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    });
  }

  private async ingestNormalizedWebhook(
    workspaceId: string,
    normalized: NormalizedWebhook,
  ): Promise<IngestResult> {
    const path = computeSendGridPath(normalized.objectType, normalized.objectId);
    const semantics = this.computeSemantics(
      normalized.objectType,
      normalized.objectId,
      normalized.payload,
    );

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
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const webhook = getRecord(event.payload._webhook);
    const action = asString(webhook?.action) ?? getEventAction(event.eventType);
    return action === 'delete' || action === 'remove';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeSendGridObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyMailSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: SendGridRecord,
): void {
  const mail = unwrapObjectPayload(payload) as Partial<SendGridMail> & SendGridRecord;

  addFirstStringProperty(properties, 'sendgrid.mail_id', mail.id, mail.message_id, mail.sg_message_id);
  addStringProperty(properties, 'sendgrid.batch_id', mail.batch_id);
  addStringProperty(properties, 'sendgrid.subject', mail.subject);
  addStringProperty(properties, 'sendgrid.template_id', mail.template_id);
  addNumberProperty(properties, 'sendgrid.send_at', mail.send_at);
  addFirstStringProperty(properties, 'sendgrid.created_at', mail.created_at, mail.createdAt);
  addFirstStringProperty(properties, 'sendgrid.updated_at', mail.updated_at, mail.updatedAt);

  const from = getRecord(mail.from);
  if (from) {
    addStringProperty(properties, 'sendgrid.from_email', from.email);
    addStringProperty(properties, 'sendgrid.from_name', from.name);
    const fromEmail = asString(from.email);
    if (fromEmail) {
      relations.add(sendGridContactPath(fromEmail));
    }
  }

  const replyTo = getRecord(mail.reply_to);
  if (replyTo) {
    addStringProperty(properties, 'sendgrid.reply_to_email', replyTo.email);
    addStringProperty(properties, 'sendgrid.reply_to_name', replyTo.name);
  }

  const categories = uniqueStrings(asStringArray(mail.categories));
  if (categories.length > 0) {
    properties['sendgrid.categories'] = categories.join(', ');
    properties['sendgrid.category_count'] = String(categories.length);
  }

  const personalizations = asPersonalizations(mail.personalizations);
  if (personalizations.length > 0) {
    properties['sendgrid.personalization_count'] = String(personalizations.length);
  }

  const recipients = collectRecipients(personalizations);
  if (recipients.length > 0) {
    properties['sendgrid.recipient_emails'] = recipients.join(', ');
    properties['sendgrid.recipient_count'] = String(recipients.length);
    for (const email of recipients) {
      relations.add(sendGridContactPath(email));
    }
  }

  const contentTypes = collectContentTypes(mail.content);
  if (contentTypes.length > 0) {
    properties['sendgrid.content_types'] = contentTypes.join(', ');
  }

  const customArgs = getRecord(mail.custom_args);
  if (customArgs) {
    const keys = Object.keys(customArgs).sort((left, right) => left.localeCompare(right));
    if (keys.length > 0) {
      properties['sendgrid.custom_arg_keys'] = keys.join(', ');
    }
  }

  const asm = getRecord(mail.asm);
  if (asm) {
    addNumberProperty(properties, 'sendgrid.asm_group_id', asm.group_id);
  }
}

function applyEventSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: SendGridRecord,
): void {
  const event = unwrapObjectPayload(payload) as Partial<SendGridEvent> & SendGridRecord;

  addFirstStringProperty(properties, 'sendgrid.event_id', event.sg_event_id, event.event_id, event.id);
  addStringProperty(properties, 'sendgrid.event', event.event);
  addFirstStringProperty(properties, 'sendgrid.message_id', event.sg_message_id, event.message_id);
  addFirstStringProperty(properties, 'sendgrid.smtp_id', event.smtp_id, event['smtp-id']);
  addStringProperty(properties, 'sendgrid.email', event.email);
  addStringProperty(properties, 'sendgrid.reason', event.reason);
  addStringProperty(properties, 'sendgrid.status', event.status);
  addStringProperty(properties, 'sendgrid.response', event.response);
  addStringProperty(properties, 'sendgrid.url', event.url);
  addStringProperty(properties, 'sendgrid.useragent', event.useragent);
  addStringProperty(properties, 'sendgrid.ip', event.ip);
  addStringProperty(properties, 'sendgrid.bounce_classification', event.bounce_classification);
  addNumberProperty(properties, 'sendgrid.timestamp', event.timestamp);
  addNumberProperty(properties, 'sendgrid.asm_group_id', event.asm_group_id);
  addNumberProperty(properties, 'sendgrid.marketing_campaign_id', event.marketing_campaign_id);
  addStringProperty(properties, 'sendgrid.marketing_campaign_name', event.marketing_campaign_name);

  const timestamp = asNumber(event.timestamp);
  if (timestamp !== undefined) {
    properties['sendgrid.timestamp_iso'] = new Date(timestamp * 1000).toISOString();
  }

  const messageId = asString(event.sg_message_id) ?? asString(event.message_id);
  if (messageId) {
    relations.add(sendGridMailPath(messageId));
  }

  const email = asString(event.email);
  if (email) {
    relations.add(sendGridContactPath(email));
  }

  const categories = readEventCategories(event.category);
  if (categories.length > 0) {
    properties['sendgrid.categories'] = categories.join(', ');
  }

  const reason = asString(event.reason);
  if (reason) {
    comments.push(reason);
  }
  const response = asString(event.response);
  if (response && response !== reason) {
    comments.push(response);
  }
}

function applyContactSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: SendGridRecord,
): void {
  const contact = unwrapObjectPayload(payload) as Partial<SendGridContact> & SendGridRecord;

  addStringProperty(properties, 'sendgrid.contact_id', contact.id);
  addStringProperty(properties, 'sendgrid.email', contact.email);
  addStringProperty(properties, 'sendgrid.first_name', contact.first_name);
  addStringProperty(properties, 'sendgrid.last_name', contact.last_name);
  addStringProperty(properties, 'sendgrid.city', contact.city);
  addStringProperty(properties, 'sendgrid.country', contact.country);
  addStringProperty(properties, 'sendgrid.phone_number', contact.phone_number);
  addStringProperty(properties, 'sendgrid.unique_name', contact.unique_name);
  addFirstStringProperty(properties, 'sendgrid.created_at', contact.created_at, contact.createdAt);
  addFirstStringProperty(properties, 'sendgrid.updated_at', contact.updated_at, contact.updatedAt);

  const email = asString(contact.email);
  if (email) {
    relations.add(sendGridContactPath(email));
  }

  const alternateEmails = uniqueStrings(asStringArray(contact.alternate_emails));
  if (alternateEmails.length > 0) {
    properties['sendgrid.alternate_emails'] = alternateEmails.join(', ');
    for (const alternate of alternateEmails) {
      relations.add(sendGridContactPath(alternate));
    }
  }

  const listIds = uniqueStrings(asStringArray(contact.list_ids));
  if (listIds.length > 0) {
    properties['sendgrid.list_ids'] = listIds.join(', ');
    properties['sendgrid.list_count'] = String(listIds.length);
  }

  const customFields = getRecord(contact.custom_fields);
  if (customFields) {
    const keys = Object.keys(customFields).sort((left, right) => left.localeCompare(right));
    if (keys.length > 0) {
      properties['sendgrid.custom_field_keys'] = keys.join(', ');
    }
  }
}

function isNormalizedWebhook(value: unknown): value is NormalizedWebhook {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.eventType === 'string' &&
    typeof value.objectType === 'string' &&
    typeof value.objectId === 'string' &&
    isRecord(value.payload)
  );
}

function normalizeProviderPayload(event: SendGridWebhookPayload): SendGridRecord {
  if (Array.isArray(event)) {
    const first = event.find((entry) => isRecord(entry));
    if (!first) {
      throw new Error('SendGrid event webhook array is empty.');
    }
    return {
      ...first,
      events: event,
      data: first,
      type: 'event',
    };
  }

  if (!isRecord(event)) {
    throw new Error('SendGrid webhook payload must be an object or event array.');
  }

  return { ...event };
}

function inferSendGridObjectType(payload: SendGridRecord): 'contact' | 'event' | 'mail' {
  const explicit = asString(payload.objectType) ?? asString(payload.object_type) ?? asString(payload.type);
  if (explicit) {
    const normalized = normalizeSendGridObjectType(explicit);
    return normalized;
  }

  if (Array.isArray(payload.events)) {
    return 'event';
  }
  if (asString(payload.event) || asString(payload.sg_event_id) || asString(payload.sg_message_id)) {
    return 'event';
  }
  if (isRecord(payload.contact)) {
    return 'contact';
  }
  if (asString(payload.email) && !Array.isArray(payload.personalizations) && !isRecord(payload.from)) {
    return 'contact';
  }
  if (isRecord(payload.mail) || Array.isArray(payload.personalizations) || isRecord(payload.from)) {
    return 'mail';
  }

  throw new Error('Unable to infer SendGrid object type from webhook payload.');
}

function extractSendGridObjectId(objectType: string, payload: SendGridRecord): string {
  const data = getRecord(payload.data);
  const mail = getRecord(payload.mail);
  const contact = getRecord(payload.contact);

  switch (normalizeSendGridObjectType(objectType)) {
    case 'mail': {
      const id =
        asString(payload.id) ??
        asString(payload.message_id) ??
        asString(payload.sg_message_id) ??
        asString(mail?.id) ??
        asString(mail?.message_id) ??
        asString(data?.id) ??
        asString(data?.message_id);
      if (id) {
        return id;
      }
      break;
    }
    case 'event': {
      const id =
        asString(payload.sg_event_id) ??
        asString(payload.event_id) ??
        asString(payload.id) ??
        asString(data?.sg_event_id) ??
        asString(data?.event_id) ??
        asString(data?.id) ??
        asString(payload.sg_message_id) ??
        asString(data?.sg_message_id);
      if (id) {
        return id;
      }
      break;
    }
    case 'contact': {
      const id =
        asString(payload.id) ??
        asString(contact?.id) ??
        asString(data?.id) ??
        asString(payload.email) ??
        asString(contact?.email) ??
        asString(data?.email);
      if (id) {
        return id;
      }
      break;
    }
  }

  throw new Error(`SendGrid ${objectType} webhook is missing an object identifier.`);
}

function inferSendGridAction(objectType: string, payload: SendGridRecord): string {
  const explicit =
    asString(payload.action) ??
    asString(payload.eventType)?.split('.').pop() ??
    asString(payload.event_type)?.split('.').pop();
  if (explicit) {
    return explicit.trim().toLowerCase();
  }

  if (normalizeSendGridObjectType(objectType) === 'event') {
    const eventName = asString(payload.event);
    if (eventName) {
      return eventName.trim().toLowerCase();
    }
  }

  return 'update';
}

function buildAdapterPayload(
  payload: SendGridRecord,
  normalized: {
    action: string;
    objectId: string;
    objectType: string;
    provider: string;
  },
): SendGridRecord {
  const existingWebhook = getRecord(payload._webhook);
  const existingConnection = getRecord(payload._connection);
  const result: SendGridRecord = { ...payload };

  result._connection = compactObject({
    ...existingConnection,
    provider: normalized.provider,
  });

  result._webhook = compactObject({
    ...existingWebhook,
    action: normalized.action,
    eventType: `${normalized.objectType}.${normalized.action}`,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    timestamp: asNumber(payload.timestamp) ?? asString(payload.timestamp),
  });

  return result;
}

function unwrapObjectPayload(payload: SendGridRecord): SendGridRecord {
  const data = getRecord(payload.data);
  const mail = getRecord(payload.mail);
  const contact = getRecord(payload.contact);

  if (mail) {
    return { ...payload, ...mail };
  }
  if (contact) {
    return { ...payload, ...contact };
  }
  if (data) {
    return { ...payload, ...data };
  }
  return payload;
}

function collectRecipients(personalizations: SendGridMailPersonalization[]): string[] {
  const recipients = new Set<string>();
  for (const personalization of personalizations) {
    for (const address of [
      ...asAddresses(personalization.to),
      ...asAddresses(personalization.cc),
      ...asAddresses(personalization.bcc),
    ]) {
      const email = asString(address.email);
      if (email) {
        recipients.add(email);
      }
    }
  }
  return sortStrings(recipients);
}

function asPersonalizations(value: unknown): SendGridMailPersonalization[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is SendGridMailPersonalization => isRecord(entry));
}

function asAddresses(value: unknown): SendGridMailAddress[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is SendGridMailAddress => isRecord(entry) && typeof entry.email === 'string');
}

function collectContentTypes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const contentTypes = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const contentType = asString(entry.type);
    if (contentType) {
      contentTypes.add(contentType);
    }
  }
  return sortStrings(contentTypes);
}

function readEventCategories(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value].filter((entry) => entry.trim().length > 0);
  }
  return uniqueStrings(asStringArray(value));
}

function inferWriteCounts(
  writeResult: WriteFileResult | void,
  deleted: boolean,
): { filesDeleted: number; filesUpdated: number; filesWritten: number } {
  if (deleted) {
    return { filesDeleted: 1, filesUpdated: 0, filesWritten: 0 };
  }
  if (!writeResult) {
    return { filesDeleted: 0, filesUpdated: 1, filesWritten: 0 };
  }
  if (writeResult.created || writeResult.status === 'created') {
    return { filesDeleted: 0, filesUpdated: 0, filesWritten: 1 };
  }
  return { filesDeleted: 0, filesUpdated: 1, filesWritten: 0 };
}

function aggregateIngestResults(results: IngestResult[]): IngestResult {
  const aggregate: IngestResult = {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };

  for (const result of results) {
    aggregate.filesWritten += result.filesWritten;
    aggregate.filesUpdated += result.filesUpdated;
    aggregate.filesDeleted += result.filesDeleted;
    aggregate.paths.push(...result.paths);
    aggregate.errors.push(...result.errors);
  }

  return aggregate;
}

function inferFallbackPath(event: NormalizedWebhook | SendGridWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeSendGridPath(event.objectType, event.objectId);
    }
    const payload = normalizeProviderPayload(event);
    const objectType = inferSendGridObjectType(payload);
    const objectId = extractSendGridObjectId(objectType, payload);
    return computeSendGridPath(objectType, objectId);
  } catch {
    return '/sendgrid/webhooks/unresolved.json';
  }
}

function getEventAction(eventType: string): string {
  const parts = eventType.split('.');
  const action = parts.at(-1);
  return action ? action.toLowerCase() : eventType.toLowerCase();
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

function addFirstStringProperty(
  properties: Record<string, string>,
  key: string,
  ...values: unknown[]
): void {
  if (properties[key]) {
    return;
  }
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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== undefined);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))).sort(
    (left, right) => left.localeCompare(right),
  );
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function getRecord(value: unknown): SendGridRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is SendGridRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactObject(value: SendGridRecord): SendGridRecord {
  const compacted: SendGridRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null && entry !== '') {
      compacted[key] = entry;
    }
  }
  return compacted;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted: SendGridRecord = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = sortJsonValue(value[key]);
  }
  return sorted;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
