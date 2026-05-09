import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { validateConfig } from './config.js';
import { toObjectRelayfilePath } from './path-mapper.js';
import type { GoogleDriveConfig, JsonObject, JsonValue, ProviderNotification, StorageBridgeChangeType, StorageBridgeEvent, StorageBridgeEventPublisher } from './types.js';

const SOURCE: string = 'google-drive';

export function getWebhookChallenge(notification: ProviderNotification): string | null {
  const query = notification.query ?? {};
  const body = isObject(notification.body) ? notification.body : {};
  
  for (const key of ['validationToken', 'challenge']) {
    const queryValue = firstHeader(query[key]);
    if (queryValue) return queryValue;
    const bodyValue = typeof body[key] === 'string' ? body[key] : null;
    if (bodyValue) return bodyValue;
  }

  if (SOURCE === 'azure-blob') {
    const events = Array.isArray(notification.body) ? notification.body : [notification.body];
    const validation = events.find((event): event is JsonObject => isObject(event) && event.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent');
    const validationCode = isObject(validation?.data) ? readString(validation.data, 'validationCode') : undefined;
    if (validationCode) return validationCode;
  }

  return null;
}

export function validateWebhookRequest(notification: ProviderNotification, configInput: GoogleDriveConfig): boolean {
  const config = validateConfig(configInput);
  const headers = normalizeHeaders(notification.headers ?? {});
  if (SOURCE === 'google-drive' && config.webhookSecret) {
    const token = headers['x-goog-channel-token'];
    if (token !== undefined) return token === config.webhookSecret;
  }
  if (SOURCE === 'dropbox' && config.signingSecret) {
    return verifyHmac(headers['x-dropbox-signature'], config.signingSecret, rawBody(notification));
  }
  if (SOURCE === 'box' && config.signingSecret) {
    return verifyHmac(headers['box-signature-primary'] ?? headers['box-signature-secondary'], config.signingSecret, rawBody(notification));
  }
  if (config.webhookSecret) {
    return verifyHmac(headers['x-relayfile-signature'], config.webhookSecret, rawBody(notification));
  }
  return true;
}

export function normalizeNotification(notification: ProviderNotification, configInput: GoogleDriveConfig): StorageBridgeEvent[] {
  const config = validateConfig(configInput);
  const detectedAt = notification.receivedAt ?? new Date().toISOString();
  const payloads = expandProviderPayloads(notification, config, detectedAt);
  return payloads.map((payload, index) => toEvent(payload, config, detectedAt, index));
}

export class GoogleDriveBridge {
  readonly config: GoogleDriveConfig;
  readonly publisher: StorageBridgeEventPublisher;

  constructor(config: GoogleDriveConfig, publisher: StorageBridgeEventPublisher) {
    this.config = validateConfig(config);
    this.publisher = publisher;
  }

  async handleNotification(notification: ProviderNotification): Promise<StorageBridgeEvent[]> {
    const challenge = getWebhookChallenge(notification);
    if (challenge) return [];
    if (!validateWebhookRequest(notification, this.config)) {
      throw new Error('Google Drive webhook signature validation failed');
    }
    const events = normalizeNotification(notification, this.config);
    for (const event of events) {
      await this.publisher.publish(event);
    }
    return events;
  }
}

function expandProviderPayloads(notification: ProviderNotification, config: GoogleDriveConfig, detectedAt: string): JsonObject[] {
  const canonicalPayloads = rawPayloads(notification.body);
  if (canonicalPayloads.length > 0 && canonicalPayloads.every((payload) => readString(payload, 'eventId') && (readString(payload, 'relayfilePath') || readString(payload, 'resourceId') || readString(payload, 'id')))) {
    return canonicalPayloads;
  }

  switch (SOURCE) {
    case 'google-drive':
      return normalizeGoogleDrive(notification, config);
    case 'gcs':
      return normalizeGcs(notification);
    case 'sharepoint':
      return normalizeGraph(notification, config, 'sharepoint');
    case 'onedrive':
      return normalizeGraph(notification, config, 'onedrive');
    case 'azure-blob':
      return normalizeAzureBlob(notification);
    case 'dropbox':
      return normalizeDropbox(notification, config);
    case 'gmail':
      return normalizeGmail(notification, config);
    case 's3':
      return normalizeS3(notification);
    case 'box':
      return normalizeBox(notification, config);
    case 'postgres':
      return normalizePostgres(notification, config);
    case 'redis':
      return normalizeRedis(notification, detectedAt);
    default:
      return rawPayloads(notification.body);
  }
}

function toEvent(payload: JsonObject, config: GoogleDriveConfig, detectedAt: string, index: number): StorageBridgeEvent {
  const eventType = readString(payload, 'eventType') ?? readString(payload, 'event_type') ?? readString(payload, 'type') ?? readString(payload, 'action') ?? readString(payload, 'changeType') ?? readString(payload, 'resourceState') ?? 'updated';
  const resourceId = readString(payload, 'resourceId') ?? readString(payload, 'resource_id') ?? readString(payload, 'id') ?? readString(payload, 'fileId') ?? readString(payload, 'objectId') ?? readString(payload, 'key') ?? readString(payload, 'name') ?? readString(payload, 'threadId') ?? digest(payload);
  const occurredAt = readString(payload, 'occurredAt') ?? readString(payload, 'eventTime') ?? readString(payload, 'time') ?? readString(payload, 'timestamp') ?? detectedAt;
  const changeType = mapChangeType(eventType);
  const relayfilePath = readString(payload, 'relayfilePath') ?? toObjectRelayfilePath({
    accountId: readString(payload, 'accountId') ?? config.accountId,
    account: readString(payload, 'account'),
    bucket: readString(payload, 'bucket'),
    container: readString(payload, 'container'),
    db: readString(payload, 'db'),
    schema: readString(payload, 'schema'),
    table: readString(payload, 'table'),
    siteId: readString(payload, 'siteId'),
    driveId: readString(payload, 'driveId'),
    id: resourceId,
    key: readString(payload, 'key'),
    name: readString(payload, 'name'),
    path: readString(payload, 'path'),
    threadId: readString(payload, 'threadId'),
    primaryKey: readString(payload, 'primaryKey'),
  });
  const payloadMetadata = isObject(payload.metadata) ? payload.metadata : {};
  return {
    eventId: readString(payload, 'eventId') ?? readString(payload, 'deliveryId') ?? digest({ payload, index, relayfilePath }),
    occurredAt,
    detectedAt,
    source: SOURCE,
    changeType,
    relayfilePath,
    resourceId,
    sizeBytes: readNumber(payload, 'sizeBytes') ?? readNumber(payload, 'size') ?? null,
    fingerprint: readString(payload, 'fingerprint') ?? readString(payload, 'etag') ?? readString(payload, 'eTag') ?? null,
    metadata: compactJson({ provider: SOURCE, providerConfigKey: config.providerConfigKey, ...payloadMetadata, raw: payload }),
    workspaceId: config.workspaceId,
  } as StorageBridgeEvent;
}

function normalizeGoogleDrive(notification: ProviderNotification, config: GoogleDriveConfig): JsonObject[] {
  const headers = normalizeHeaders(notification.headers ?? {});
  const body = isObject(notification.body) ? notification.body : {};
  const change = objectAt(body, 'change') ?? body;
  const file = objectAt(change, 'file') ?? objectAt(body, 'file') ?? {};
  const resourceState = headers['x-goog-resource-state'] ?? readString(change, 'resourceState') ?? readString(body, 'eventType') ?? 'updated';
  const fileId = readString(file, 'id') ?? readString(change, 'fileId') ?? headers['x-goog-resource-id'] ?? readString(body, 'resourceId') ?? digest(body);
  const accountId = readString(body, 'accountId') ?? config.accountId ?? 'default';
  const fileName = readString(file, 'name') ?? readString(change, 'name') ?? fileId;
  const messageNumber = headers['x-goog-message-number'] ?? readString(body, 'messageNumber') ?? '0';
  const channelId = headers['x-goog-channel-id'] ?? readString(body, 'channelId') ?? readString(change, 'channelId') ?? 'unknown-channel';
  return [{
    eventId: 'google-drive:' + channelId + ':' + messageNumber + ':' + fileId,
    eventType: resourceState,
    resourceId: fileId,
    relayfilePath: '/google-drive/' + accountId + '/' + trimLeadingSlash(readString(change, 'path') ?? fileName),
    occurredAt: readString(change, 'time') ?? readString(file, 'modifiedTime'),
    sizeBytes: numberish(file.size),
    fingerprint: readString(file, 'md5Checksum') ?? readString(file, 'etag') ?? readString(file, 'eTag'),
    metadata: compactJson({ accountId, channelId, resourceId: headers['x-goog-resource-id'], driveId: readString(file, 'driveId'), file, headers }),
  }];
}

function normalizeGcs(notification: ProviderNotification): JsonObject[] {
  const body = isObject(notification.body) ? notification.body : {};
  const message = objectAt(body, 'message') ?? body;
  const attrs = objectAt(message, 'attributes') ?? {};
  const data = decodePossiblyBase64Json(message.data) ?? objectAt(message, 'data') ?? objectAt(body, 'data') ?? {};
  const bucket = readString(data, 'bucket') ?? readString(attrs, 'bucketId') ?? readString(attrs, 'bucket');
  const name = readString(data, 'name') ?? readString(attrs, 'objectId') ?? readString(attrs, 'object');
  const generation = readString(data, 'generation') ?? readString(attrs, 'objectGeneration') ?? readString(attrs, 'generation');
  if (!bucket || !name) return rawPayloads(notification.body);
  const messageId = readString(message, 'messageId') ?? readString(body, 'messageId') ?? digest(message);
  return [{
    eventId: 'gcs:' + messageId + ':' + bucket + ':' + name + ':' + (generation ?? 'latest'),
    eventType: readString(attrs, 'eventType') ?? readString(data, 'eventType') ?? 'OBJECT_METADATA_UPDATE',
    resourceId: bucket + '/' + name + (generation ? '#' + generation : ''),
    relayfilePath: '/gcs/' + bucket + '/' + trimLeadingSlash(name),
    occurredAt: readString(message, 'publishTime') ?? readString(body, 'publishTime') ?? readString(data, 'timeCreated') ?? readString(data, 'updated'),
    sizeBytes: numberish(data.size),
    fingerprint: readString(data, 'md5Hash') ?? readString(data, 'etag'),
    metadata: compactJson({ bucket, object: name, generation, messageId, pubsub: { attributes: attrs } }),
  }];
}

function normalizeGraph(notification: ProviderNotification, config: GoogleDriveConfig, graphSource: 'sharepoint' | 'onedrive'): JsonObject[] {
  const body = isObject(notification.body) ? notification.body : {};
  const values = Array.isArray(body.value) ? body.value.filter(isObject) : [body].filter(isObject);
  return values.map((item) => {
    const delta = objectAt(item, 'resourceData') ?? objectAt(item, 'delta') ?? objectAt(item, 'graph') ?? item;
    const parent = objectAt(delta, 'parentReference') ?? {};
    const subscriptionId = readString(item, 'subscriptionId') ?? readString(body, 'subscriptionId') ?? readString(objectAt(body, 'graph') ?? {}, 'subscriptionId') ?? 'subscription';
    const itemId = readString(delta, 'id') ?? readString(item, 'id') ?? digest(item);
    const driveId = readString(parent, 'driveId') ?? readString(delta, 'driveId') ?? readString(item, 'driveId') ?? 'drive-default';
    const siteId = readString(parent, 'siteId') ?? readString(delta, 'siteId') ?? siteIdFromResource(readString(item, 'resource')) ?? 'site-default';
    const accountId = readString(item, 'accountId') ?? config.accountId ?? 'me';
    const name = readString(delta, 'name') ?? itemId;
    const folderPath = graphFolderPath(readString(parent, 'path'));
    const relayfilePath = graphSource === 'sharepoint'
      ? '/sharepoint/' + siteId + '/' + driveId + joinPath(folderPath, name)
      : '/onedrive/' + accountId + joinPath(folderPath, name);
    return {
      eventId: graphSource + ':' + subscriptionId + ':' + itemId + ':' + (readString(delta, 'eTag') ?? readString(delta, 'etag') ?? 'no-etag'),
      eventType: readString(item, 'changeType') ?? readString(delta, 'changeType') ?? 'updated',
      resourceId: graphSource === 'sharepoint' ? siteId + '/' + driveId + '/' + itemId : driveId + '/' + itemId,
      relayfilePath,
      occurredAt: readString(delta, 'lastModifiedDateTime') ?? readString(item, 'eventTime'),
      sizeBytes: numberish(delta.size),
      fingerprint: readString(delta, 'eTag') ?? readString(delta, 'etag') ?? readString(delta, 'cTag'),
      metadata: compactJson({ subscriptionId, tenantId: readString(item, 'tenantId'), clientState: readString(item, 'clientState'), siteId, driveId, accountId, delta }),
    };
  });
}

function normalizeAzureBlob(notification: ProviderNotification): JsonObject[] {
  return rawPayloads(notification.body).filter((event) => event.eventType !== 'Microsoft.EventGrid.SubscriptionValidationEvent').map((event) => {
    const data = objectAt(event, 'data') ?? {};
    const parsed = parseAzureSubject(readString(event, 'subject') ?? readString(data, 'url') ?? '');
    const account = readString(event, 'account') ?? accountFromAzureUrl(readString(data, 'url')) ?? 'account';
    return {
      eventId: 'azure-blob:' + (readString(event, 'id') ?? digest(event)),
      eventType: readString(event, 'eventType') ?? 'Microsoft.Storage.BlobUpdated',
      resourceId: account + '/' + parsed.container + '/' + parsed.key,
      relayfilePath: '/azure/' + account + '/' + parsed.container + '/' + trimLeadingSlash(parsed.key),
      occurredAt: readString(event, 'eventTime'),
      sizeBytes: numberish(data.contentLength),
      fingerprint: readString(data, 'eTag') ?? readString(data, 'etag'),
      metadata: compactJson({ account, container: parsed.container, subject: readString(event, 'subject'), eventGrid: { eventType: readString(event, 'eventType'), data } }),
    };
  });
}

function normalizeDropbox(notification: ProviderNotification, config: GoogleDriveConfig): JsonObject[] {
  const body = isObject(notification.body) ? notification.body : {};
  const listFolder = objectAt(body, 'list_folder') ?? objectAt(body, 'listFolder') ?? body;
  const accountId = readString(body, 'accountId') ?? firstStringArray(listFolder.accounts) ?? config.accountId ?? 'default';
  const cursor = readString(body, 'listFolderCursor') ?? readString(listFolder, 'cursor') ?? readString(body, 'cursor') ?? 'cursor';
  const entries = Array.isArray(body.entries) ? body.entries.filter(isObject) : Array.isArray(listFolder.entries) ? listFolder.entries.filter(isObject) : [] as JsonObject[];
  if (entries.length === 0) {
    return [{
      eventId: 'dropbox:' + accountId + ':' + cursor,
      eventType: 'updated',
      resourceId: accountId,
      relayfilePath: '/dropbox/' + accountId + '/cursor.json',
      fingerprint: cursor,
      metadata: compactJson({ accountId, cursor, webhook: listFolder }),
    }];
  }
  return entries.map((entry) => {
    const pathDisplay = readString(entry, 'path_display') ?? readString(entry, 'path_lower') ?? readString(entry, 'name') ?? 'entry';
    const pathLower = readString(entry, 'path_lower') ?? pathDisplay.toLowerCase();
    return {
      eventId: 'dropbox:' + accountId + ':' + cursor + ':' + pathLower + ':' + (readString(entry, 'rev') ?? 'no-rev'),
      eventType: readString(entry, '.tag') === 'deleted' ? 'deleted' : 'updated',
      resourceId: readString(entry, 'id') ?? pathLower,
      relayfilePath: '/dropbox/' + accountId + '/' + trimLeadingSlash(pathDisplay),
      occurredAt: readString(entry, 'server_modified') ?? readString(entry, 'client_modified'),
      sizeBytes: numberish(entry.size),
      fingerprint: readString(entry, 'content_hash') ?? readString(entry, 'rev'),
      metadata: compactJson({ accountId, cursor, pathLower, entry }),
    };
  });
}

function normalizeGmail(notification: ProviderNotification, config: GoogleDriveConfig): JsonObject[] {
  const body = isObject(notification.body) ? notification.body : {};
  const message = objectAt(body, 'message') ?? body;
  const data = decodePossiblyBase64Json(message.data) ?? objectAt(body, 'data') ?? {};
  const account = readString(data, 'emailAddress') ?? readString(body, 'account') ?? readString(body, 'emailAddress') ?? config.accountId ?? 'me';
  const historyId = readString(data, 'historyId') ?? readString(body, 'historyId') ?? readString(objectAt(body, 'history') ?? {}, 'id') ?? 'history';
  const history = objectAt(body, 'history') ?? data;
  const thread = objectAt(body, 'thread') ?? firstHistoryMessage(history);
  const threadId = readString(thread, 'threadId') ?? readString(thread, 'id') ?? historyId;
  return [{
    eventId: 'gmail:' + account + ':' + historyId + ':' + threadId,
    eventType: Array.isArray(history.messagesDeleted) ? 'deleted' : 'created',
    resourceId: threadId,
    relayfilePath: '/gmail/' + account + '/threads/' + threadId + '.json',
    occurredAt: readString(message, 'publishTime') ?? readString(body, 'publishTime'),
    fingerprint: historyId,
    metadata: compactJson({ account, history, thread, messageId: readString(message, 'messageId') ?? readString(body, 'messageId') }),
  }];
}

function normalizeS3(notification: ProviderNotification): JsonObject[] {
  const body = isObject(notification.body) ? notification.body : {};
  const envelope = typeof body.Body === 'string' ? parseJsonObject(body.Body) ?? body : body;
  const records = Array.isArray(envelope.Records) ? envelope.Records.filter(isObject) : [];
  return records.map((record) => {
    const s3 = objectAt(record, 's3') ?? {};
    const bucketObject = objectAt(s3, 'bucket') ?? {};
    const object = objectAt(s3, 'object') ?? {};
    const bucket = readString(bucketObject, 'name') ?? 'bucket';
    const key = decodeS3Key(readString(object, 'key') ?? 'object');
    const messageId = readString(body, 'messageId') ?? readString(body, 'MessageId') ?? digest(record);
    return {
      eventId: 's3:' + messageId + ':' + bucket + ':' + key + ':' + (readString(object, 'sequencer') ?? 'no-sequencer'),
      eventType: readString(record, 'eventName') ?? 'ObjectUpdated',
      resourceId: bucket + '/' + key,
      relayfilePath: '/s3/' + bucket + '/' + trimLeadingSlash(key),
      occurredAt: readString(record, 'eventTime'),
      sizeBytes: numberish(object.size),
      fingerprint: readString(object, 'eTag') ?? readString(object, 'etag'),
      metadata: compactJson({ bucket, object, receiptHandle: readString(body, 'receiptHandle') ?? readString(body, 'ReceiptHandle'), sqs: { messageId } }),
    };
  });
}

function normalizeBox(notification: ProviderNotification, config: GoogleDriveConfig): JsonObject[] {
  const bodies = rawPayloads(notification.body);
  return bodies.map((body) => {
    const source = objectAt(body, 'source') ?? {};
    const accountId = readString(body, 'accountId') ?? config.accountId ?? 'default';
    const pathCollection = objectAt(source, 'path_collection') ?? {};
    const folderNames = Array.isArray(pathCollection.entries) ? pathCollection.entries.filter(isObject).map((entry) => readString(entry, 'name')).filter((name): name is string => Boolean(name && name !== 'All Files')) : [];
    const name = readString(source, 'name') ?? readString(body, 'name') ?? readString(source, 'id') ?? 'file';
    const sourceId = readString(source, 'id') ?? digest(body);
    return {
      eventId: 'box:' + (readString(body, 'id') ?? digest(body)) + ':' + sourceId + ':' + (readString(source, 'etag') ?? readString(source, 'sha1') ?? 'no-etag'),
      eventType: readString(body, 'trigger') ?? readString(body, 'eventType') ?? 'FILE.UPDATED',
      resourceId: sourceId,
      relayfilePath: '/box/' + accountId + '/' + trimLeadingSlash([...folderNames, name].join('/')),
      occurredAt: readString(body, 'created_at') ?? readString(source, 'modified_at'),
      sizeBytes: numberish(source.size),
      fingerprint: readString(source, 'etag') ?? readString(source, 'sha1'),
      metadata: compactJson({ accountId, webhookId: readString(body, 'id'), trigger: readString(body, 'trigger'), boxSource: source }),
    };
  });
}

function normalizePostgres(notification: ProviderNotification, config: GoogleDriveConfig): JsonObject[] {
  const body = isObject(notification.body) ? notification.body : {};
  const raw = (typeof body.notification === 'string' ? parseJsonObject(body.notification) : objectAt(body, 'notification')) ?? body;
  const db = readString(raw, 'database') ?? readString(raw, 'db') ?? config.accountId ?? 'db';
  const schema = readString(raw, 'schema') ?? 'public';
  const table = readString(raw, 'table') ?? 'table';
  const pk = readString(raw, 'pk') ?? readString(raw, 'primaryKey') ?? readString(raw, 'id') ?? 'id';
  const txid = readString(raw, 'txid') ?? readString(raw, 'fingerprint') ?? digest(raw);
  return [{
    eventId: 'postgres:' + db + ':' + schema + '.' + table + ':' + pk + ':' + txid,
    eventType: readString(raw, 'op') ?? readString(raw, 'eventType') ?? 'UPDATE',
    resourceId: db + '/' + schema + '/' + table + '/' + pk,
    relayfilePath: '/postgres/' + db + '/' + schema + '/' + table + '/' + pk + '.json',
    occurredAt: readString(raw, 'occurred_at') ?? readString(raw, 'occurredAt'),
    fingerprint: txid,
    metadata: compactJson({ channel: readString(body, 'channel'), processId: numberish(body.processId), postgres: raw, 'postgres.row_json': objectAt(raw, 'row_json') }),
  }];
}

function normalizeRedis(notification: ProviderNotification, detectedAt: string): JsonObject[] {
  const body = isObject(notification.body) ? notification.body : {};
  const channel = readString(body, 'channel') ?? '';
  const parsed = parseRedisChannel(channel);
  const db = readString(body, 'db') ?? parsed.db ?? '0';
  const key = readString(body, 'key') ?? parsed.key ?? 'key';
  const occurredAt = readString(body, 'detectedAt') ?? readString(body, 'occurredAt') ?? detectedAt;
  const message = readString(body, 'message') ?? 'set';
  return [{
    eventId: 'redis:' + db + ':' + key + ':' + message + ':' + occurredAt,
    eventType: message,
    resourceId: db + '/' + key,
    relayfilePath: '/redis/' + db + '/' + key + '.json',
    occurredAt,
    metadata: compactJson({ pattern: readString(body, 'pattern'), channel, db: numberish(db) ?? db, key, redis: { type: readString(body, 'type'), value: body.value, message } }),
  }];
}

export function mapChangeType(value: string): StorageBridgeChangeType {
  const normalized = value.toLowerCase();
  if (/(delete|deleted|remove|removed|trash|trashed|object_delete|objectremoved|object_removed|objectdeleted|object_deleted)/.test(normalized)) return 'deleted';
  if (/(create|created|upload|uploaded|finalize|copy|put|insert|added|file\.uploaded|blobcreated|objectcreated)/.test(normalized)) return 'created';
  return 'updated';
}

function rawPayloads(body: JsonValue): JsonObject[] {
  return Array.isArray(body) ? body.filter(isObject) : isObject(body) ? [body] : [];
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = firstHeader(value);
  return normalized;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rawBody(notification: ProviderNotification): string | Uint8Array {
  return notification.rawBody ?? JSON.stringify(notification.body);
}

function verifyHmac(header: string | undefined, secret: string, body: string | Uint8Array): boolean {
  if (!header) return false;
  const provided = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectAt(record: JsonObject, key: string): JsonObject | undefined {
  const value = record[key];
  return isObject(value) ? value : undefined;
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function readNumber(record: JsonObject, key: string): number | undefined {
  return numberish(record[key]);
}

function numberish(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function compactJson(record: Record<string, unknown>): JsonObject {
  const compacted: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      compacted[key] = value.map((item) => isObject(item) ? compactJson(item) : item as JsonValue).filter((item) => item !== undefined) as JsonValue;
      continue;
    }
    if (isObject(value)) {
      compacted[key] = compactJson(value);
      continue;
    }
    compacted[key] = value as JsonValue;
  }
  return compacted;
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decodePossiblyBase64Json(value: unknown): JsonObject | undefined {
  if (isObject(value)) return value;
  if (typeof value !== 'string') return undefined;
  return parseJsonObject(value) ?? parseJsonObject(Buffer.from(value, 'base64').toString('utf8'));
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '');
}

function joinPath(prefix: string, name: string): string {
  const normalizedPrefix = prefix ? '/' + trimLeadingSlash(prefix).replace(/\/+$/, '') : '';
  return normalizedPrefix + '/' + trimLeadingSlash(name);
}

function graphFolderPath(path: string | undefined): string {
  if (!path) return '';
  const marker = path.indexOf(':/');
  return marker >= 0 ? path.slice(marker + 2) : path;
}

function siteIdFromResource(resource: string | undefined): string | undefined {
  if (!resource) return undefined;
  const match = resource.match(/sites\/([^\/]+)/);
  return match?.[1];
}

function parseAzureSubject(subject: string): { container: string; key: string } {
  const match = subject.match(/containers\/([^\/]+)\/blobs\/(.+)$/);
  if (match) return { container: match[1] ?? 'container', key: match[2] ?? 'blob' };
  try {
    const url = new URL(subject);
    const [, container, ...keyParts] = url.pathname.split('/');
    return { container: container || 'container', key: keyParts.join('/') || 'blob' };
  } catch {
    return { container: 'container', key: 'blob' };
  }
}

function accountFromAzureUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return undefined;
  }
}

function firstStringArray(value: JsonValue | undefined): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
}

function firstHistoryMessage(history: JsonObject): JsonObject {
  for (const key of ['messagesAdded', 'messagesDeleted']) {
    const list = history[key];
    if (!Array.isArray(list)) continue;
    const first = list.find(isObject);
    if (!first) continue;
    const message = objectAt(first, 'message');
    if (message) return message;
  }
  return {};
}

function decodeS3Key(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    return key;
  }
}

function parseRedisChannel(channel: string): { db?: string; key?: string } {
  const match = channel.match(/^__keyspace@(\d+)__:(.+)$/);
  return { db: match?.[1], key: match?.[2] };
}
