import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  airtableBasePath,
  airtableRecordPath,
  airtableTablePath,
  computeAirtablePath,
  normalizeAirtableObjectType,
} from './path-mapper.js';
import { createAirtableFetchOnDemand } from './fetch-on-demand.js';
import { AIRTABLE_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  AirtableAdapterConfig,
  AirtableBase,
  AirtableField,
  AirtableFetchOnDemandOptions,
  AirtableMaterializedChangePayload,
  AirtableRecord,
  AirtableReference,
  AirtableTable,
  AirtableView,
  AirtableWebhookNotification,
  AirtableWebhookPayload,
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

export interface ReadFileInput {
  workspaceId: string;
  path: string;
}

export interface ReadFileResult {
  content?: string;
}

export interface RelayFileClientLike {
  writeFile(input: WriteFileInput): Promise<WriteFileResult | void>;
  deleteFile?(input: DeleteFileInput): Promise<void> | void;
  readFile?(input: ReadFileInput): Promise<ReadFileResult | string | null | undefined> | ReadFileResult | string | null | undefined;
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

  abstract ingestWebhook(workspaceId: string, event: AirtableWebhookNotification | NormalizedWebhook | AirtableWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type AirtablePayloadRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SUPPORTED_EVENTS = AIRTABLE_WEBHOOK_OBJECT_TYPES;
const AIRTABLE_PROVIDER_NAME = 'airtable';

export class AirtableAdapter extends IntegrationAdapter {
  override readonly name = AIRTABLE_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: AirtableAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: AirtableAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.create`,
      `${objectType}.update`,
      `${objectType}.delete`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: AirtableWebhookNotification | NormalizedWebhook | AirtableWebhookPayload,
  ): Promise<IngestResult> {
    // If this is a thin Airtable notification, re-fetch the full payloads via
    // the Airtable webhook payloads API before writing, mirroring the Salesforce
    // refetch pattern. This is the core fix for issue #181.
    if (isAirtableWebhookNotification(event)) {
      return this.ingestFromNotification(workspaceId, event);
    }

    return this.ingestPayload(workspaceId, event);
  }

  override computePath(
    objectType: string,
    objectId: string,
    context: { baseId?: string; tableId?: string } = {},
  ): string {
    return computeAirtablePath(objectType, objectId, mergeContext(context, this.config));
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeAirtableObjectType(objectType);
    const context = this.resolveContext(payload);
    const properties: Record<string, string> = {
      provider: AIRTABLE_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'airtable.id': objectId,
      'airtable.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addStringProperty(properties, 'airtable.base_id', context.baseId);
    addStringProperty(properties, 'airtable.table_id', context.tableId);

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'airtable.webhook.action', webhook.action);
      addStringProperty(properties, 'airtable.webhook.delivery_id', webhook.deliveryId);
      addStringProperty(properties, 'airtable.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'airtable.webhook.object_id', webhook.objectId);
      addStringProperty(properties, 'airtable.webhook.object_type', webhook.objectType);
      addNumberProperty(properties, 'airtable.webhook.timestamp', webhook.webhookTimestamp);
    }

    if (context.baseId && normalizedType !== 'base') {
      relations.add(airtableBasePath(context.baseId));
    }

    if (context.baseId && context.tableId && normalizedType === 'record') {
      relations.add(airtableTablePath(context.baseId, context.tableId));
    }

    switch (normalizedType) {
      case 'record':
        applyRecordSemantics(properties, relations, comments, payload as AirtablePayloadRecord, context);
        break;
      case 'table':
        applyTableSemantics(properties, relations, comments, payload as AirtablePayloadRecord, context);
        break;
      case 'base':
        applyBaseSemantics(properties, relations, payload as AirtablePayloadRecord);
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

  private async ingestFromNotification(
    workspaceId: string,
    notification: AirtableWebhookNotification,
  ): Promise<IngestResult> {
    try {
      const connectionId = notification.connectionId ?? this.config.connectionId;
      const providerConfigKey = notification.providerConfigKey ?? this.config.providerConfigKey;
      const fetchOptions: AirtableFetchOnDemandOptions = {
        apiUrl: this.config.apiUrl ?? '',
        ...(connectionId ? { connectionId } : {}),
        ...(providerConfigKey ? { providerConfigKey } : {}),
      };
      if (notification.cursor !== undefined) {
        fetchOptions.cursor = notification.cursor;
      }
      const fetchOnDemand = createAirtableFetchOnDemand(this.provider, fetchOptions);
      const materialized = await fetchOnDemand(notification);
      return this.ingestMaterializedPayloads(workspaceId, notification, materialized);
    } catch (error) {
      return {
        errors: [
          {
            error: toErrorMessage(error),
            path: `/airtable/bases/${notification.baseId}/_notifications/${notification.webhookId}.json`,
          },
        ],
        filesDeleted: 0,
        filesUpdated: 0,
        filesWritten: 0,
        paths: [],
      };
    }
  }

  private async ingestMaterializedPayloads(
    workspaceId: string,
    notification: AirtableWebhookNotification,
    materialized: AirtableMaterializedChangePayload,
  ): Promise<IngestResult> {
    const aggregate: IngestResult = {
      errors: [],
      filesDeleted: 0,
      filesUpdated: 0,
      filesWritten: 0,
      paths: [],
    };

    for (const rawPayload of materialized.payloads) {
      // Airtable's payloads API returns change descriptors shaped as
      // `changedTablesById.<tableId>.{changed,created}RecordsById.<recordId>`
      // with the re-fetched `cellValuesByFieldId`. Expand each into a per-record
      // event the normalizer understands, rather than handing the raw envelope
      // to ingestPayload (which would throw "missing object type"). Payloads that
      // are already record-shaped (objectType/objectId present) pass through.
      const events = expandMaterializedPayload(rawPayload, materialized.baseId);
      for (const event of events) {
        const result = await this.ingestPayload(workspaceId, event);
        aggregate.filesWritten += result.filesWritten;
        aggregate.filesUpdated += result.filesUpdated;
        aggregate.filesDeleted += result.filesDeleted;
        aggregate.paths.push(...result.paths);
        aggregate.errors.push(...result.errors);
      }
    }

    return aggregate;
  }

  private async ingestPayload(
    workspaceId: string,
    event: NormalizedWebhook | AirtableWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const context = this.resolveContext(normalized.payload);
      const path = computeAirtablePath(
        normalized.objectType,
        normalized.objectId,
        context,
      );
      const semantics = this.computeSemantics(
        normalized.objectType,
        normalized.objectId,
        normalized.payload,
      );

      if (this.isDeleteEvent(normalized)) {
        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path });
          return {
            errors: [],
            filesDeleted: 1,
            filesUpdated: 0,
            filesWritten: 0,
            paths: [path],
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
          errors: [],
          filesDeleted: counts.filesDeleted,
          filesUpdated: counts.filesUpdated,
          filesWritten: counts.filesWritten,
          paths: [path],
        };
      }

      const reconciledPayload = await this.reconcileWebhookPayload(workspaceId, path, normalized);
      const reconciled: NormalizedWebhook = {
        ...normalized,
        payload: reconciledPayload,
      };

      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content: this.renderContent(workspaceId, reconciled, false),
        contentType: JSON_CONTENT_TYPE,
        semantics: this.computeSemantics(reconciled.objectType, reconciled.objectId, reconciled.payload),
      });
      const counts = inferWriteCounts(writeResult, false);
      return {
        errors: [],
        filesDeleted: 0,
        filesUpdated: counts.filesUpdated,
        filesWritten: counts.filesWritten,
        paths: [path],
      };
    } catch (error) {
      const fallbackPath = inferFallbackPath(event);
      return {
        errors: [
          {
            error: toErrorMessage(error),
            path: fallbackPath,
          },
        ],
        filesDeleted: 0,
        filesUpdated: 0,
        filesWritten: 0,
        paths: fallbackPath ? [fallbackPath] : [],
      };
    }
  }

  private async reconcileWebhookPayload(
    workspaceId: string,
    path: string,
    event: NormalizedWebhook,
  ): Promise<Record<string, unknown>> {
    // Merge the incoming delta onto the existing stored file so that fields not
    // included in the webhook are preserved. Strip stale _webhook from the
    // existing payload so the current event's metadata wins.
    return mergeFallbackPayload(await this.readExistingPayload(workspaceId, path), event.payload);
  }

  private async readExistingPayload(
    workspaceId: string,
    path: string,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.client.readFile) {
      return undefined;
    }
    try {
      const result = await this.client.readFile({ workspaceId, path });
      const content = typeof result === 'string' ? result : result?.content;
      if (!content) {
        return undefined;
      }
      const parsed = JSON.parse(content) as unknown;
      if (!isRecord(parsed)) {
        return undefined;
      }
      return isRecord(parsed.payload) ? parsed.payload : parsed;
    } catch {
      return undefined;
    }
  }

  private normalizeEvent(event: NormalizedWebhook | AirtableWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || AIRTABLE_PROVIDER_NAME,
        eventType: canonicalEventType(event.eventType, event.objectType),
        objectType: normalizeAirtableObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = normalizeAirtableObjectType(readPayloadObjectType(event));
    const payload = mergeAirtablePayload(event, objectType, this.config);
    const objectId = readObjectId(payload, objectType);
    if (!objectId) {
      throw new Error(`Airtable ${objectType} webhook is missing object id`);
    }

    const action = normalizeAction(
      asString(event.action) ??
      asString(event.eventType)?.split('.').at(-1) ??
      'update',
    );

    const normalized: NormalizedWebhook = {
      provider: this.config.provider || AIRTABLE_PROVIDER_NAME,
      eventType: `${objectType}.${action}`,
      objectType,
      objectId,
      payload,
    };
    if (this.config.connectionId) {
      normalized.connectionId = this.config.connectionId;
    }
    return normalized;
  }

  private resolveContext(payload: Record<string, unknown>): { baseId?: string; tableId?: string } {
    const base = getRecord(payload.base);
    const table = getRecord(payload.table);
    const data = getRecord(payload.data);
    const dataBase = getRecord(data?.base);
    const dataTable = getRecord(data?.table);
    const context: { baseId?: string; tableId?: string } = {};

    const baseId =
      asString(payload.baseId) ??
      asString(payload.base_id) ??
      asString(base?.id) ??
      asString(data?.baseId) ??
      asString(data?.base_id) ??
      asString(dataBase?.id) ??
      this.config.baseId;
    if (baseId) {
      context.baseId = baseId;
    }

    const tableId =
      asString(payload.tableId) ??
      asString(payload.table_id) ??
      asString(table?.id) ??
      asString(data?.tableId) ??
      asString(data?.table_id) ??
      asString(dataTable?.id) ??
      this.config.tableId;
    if (tableId) {
      context.tableId = tableId;
    }

    return context;
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'delete';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeAirtableObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyRecordSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: AirtablePayloadRecord,
  context: { baseId?: string; tableId?: string },
): void {
  const record = payload as Partial<AirtableRecord> & AirtablePayloadRecord;
  const fields = getRecord(record.fields);

  addFirstStringProperty(properties, 'airtable.created_time', record.createdTime, record.created_time);
  addFirstStringProperty(properties, 'airtable.updated_time', record.updatedTime, record.updated_time);
  addFirstStringProperty(properties, 'airtable.table_name', record.tableName, record.table_name);
  addNumberProperty(properties, 'airtable.comment_count', record.commentCount);

  if (fields) {
    const fieldEntries = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .sort(([left], [right]) => left.localeCompare(right));
    properties['airtable.field_count'] = String(fieldEntries.length);

    for (const [fieldName, value] of fieldEntries) {
      const key = slugPropertyKey(fieldName);
      const propertyValue = stringifyFieldValue(value);
      if (propertyValue) {
        properties[`airtable.field.${key}`] = propertyValue;
      }
      collectFieldRelations(relations, value, context);
    }

    const recordTitle = firstNonEmptyString(
      fields.Name,
      fields.name,
      fields.Title,
      fields.title,
      fields.Subject,
      fields.subject,
    );
    addStringProperty(properties, 'airtable.record_title', recordTitle);

    const notes = firstNonEmptyString(fields.Notes, fields.notes, fields.Description, fields.description);
    if (notes) {
      comments.push(notes);
      properties['airtable.notes_length'] = String(notes.length);
    }
  }
}

function applyTableSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: AirtablePayloadRecord,
  context: { baseId?: string; tableId?: string },
): void {
  const table = payload as Partial<AirtableTable> & AirtablePayloadRecord;

  addStringProperty(properties, 'airtable.name', table.name);
  addStringProperty(properties, 'airtable.primary_field_id', table.primaryFieldId);
  addFirstStringProperty(properties, 'airtable.description', table.description);
  addFirstStringProperty(properties, 'airtable.created_time', table.createdTime, table.created_time);
  addFirstStringProperty(properties, 'airtable.updated_time', table.updatedTime, table.updated_time);

  const base = table.base as AirtableReference | null | undefined;
  const baseId = asString(base?.id) ?? context.baseId;
  if (baseId) {
    relations.add(airtableBasePath(baseId));
    addStringProperty(properties, 'airtable.base_id', baseId);
  }
  addStringProperty(properties, 'airtable.base_name', base?.name);

  const fields = asFields(table.fields);
  if (fields.length > 0) {
    properties['airtable.field_count'] = String(fields.length);
    addStringListProperty(properties, 'airtable.field_ids', fields.map((field) => field.id));
    addStringListProperty(properties, 'airtable.field_names', fields.map((field) => field.name));
    addStringListProperty(properties, 'airtable.field_types', uniqueStrings(fields.map((field) => field.type).filter(isString)));

    for (const field of fields) {
      const key = slugPropertyKey(field.name);
      addStringProperty(properties, `airtable.schema.${key}.id`, field.id);
      addStringProperty(properties, `airtable.schema.${key}.type`, field.type);
      addStringProperty(properties, `airtable.schema.${key}.description`, field.description);
    }
  }

  const views = asViews(table.views);
  if (views.length > 0) {
    properties['airtable.view_count'] = String(views.length);
    addStringListProperty(properties, 'airtable.view_ids', views.map((view) => view.id));
    addStringListProperty(properties, 'airtable.view_names', views.map((view) => view.name));
  }

  const description = asString(table.description);
  if (description) {
    comments.push(description);
    properties['airtable.description_length'] = String(description.length);
  }
}

function applyBaseSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: AirtablePayloadRecord,
): void {
  const base = payload as Partial<AirtableBase> & AirtablePayloadRecord;

  addStringProperty(properties, 'airtable.name', base.name);
  addStringProperty(properties, 'airtable.permission_level', base.permissionLevel);
  addFirstStringProperty(properties, 'airtable.created_time', base.createdTime, base.created_time);

  const workspace = base.workspace as AirtableReference | null | undefined;
  addStringProperty(properties, 'airtable.workspace_id', workspace?.id);
  addStringProperty(properties, 'airtable.workspace_name', workspace?.name);

  const tables = asTables(base.tables);
  if (tables.length > 0) {
    properties['airtable.table_count'] = String(tables.length);
    addStringListProperty(properties, 'airtable.table_ids', tables.map((table) => table.id));
    addStringListProperty(properties, 'airtable.table_names', tables.map((table) => table.name).filter(isString));

    const baseId = asString(base.id);
    if (baseId) {
      for (const table of tables) {
        relations.add(airtableTablePath(baseId, table.id));
      }
    }
  }
}

function collectFieldRelations(
  relations: Set<string>,
  value: unknown,
  context: { baseId?: string; tableId?: string },
): void {
  if (!context.baseId || !context.tableId) {
    return;
  }

  if (typeof value === 'string' && /^rec[a-zA-Z0-9_-]+$/u.test(value)) {
    relations.add(airtableRecordPath(context.baseId, context.tableId, value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFieldRelations(relations, item, context);
    }
  }
}

function mergeFallbackPayload(
  existingPayload: Record<string, unknown> | undefined,
  webhookPayload: Record<string, unknown>,
): Record<string, unknown> {
  // Strip stale _webhook from the existing payload so the current event's
  // metadata wins.
  const { _webhook: _discarded, ...existingWithoutWebhook } = existingPayload ?? {};
  const merged: Record<string, unknown> = {
    ...existingWithoutWebhook,
    ...webhookPayload,
  };
  mergeRecordMap(merged, existingWithoutWebhook, webhookPayload, 'fields');
  mergeRecordMap(merged, existingWithoutWebhook, webhookPayload, 'cellValuesByFieldId');
  return merged;
}

function mergeRecordMap(
  target: Record<string, unknown>,
  existingPayload: Record<string, unknown>,
  webhookPayload: Record<string, unknown>,
  key: string,
): void {
  const existingMap = getRecord(existingPayload[key]);
  const webhookMap = getRecord(webhookPayload[key]);
  if (!existingMap || !webhookMap) {
    return;
  }
  target[key] = {
    ...existingMap,
    ...webhookMap,
  };
}

function mergeAirtablePayload(
  event: AirtableWebhookPayload,
  objectType: string,
  config: AirtableAdapterConfig,
): Record<string, unknown> {
  const data = getRecord(event.data);
  const payload = getRecord(event.payload);
  const typedPayload =
    objectType === 'record'
      ? getRecord(event.record) ?? data
      : objectType === 'table'
        ? getRecord(event.table) ?? data
        : getRecord(event.base) ?? data;

  const merged: Record<string, unknown> = {
    ...(payload ?? {}),
    ...(typedPayload ?? {}),
    ...(data ?? {}),
  };

  const explicitId = asString(event.objectId) ?? asString(event.object_id);
  if (explicitId && !asString(merged.id)) {
    merged.id = explicitId;
  }

  const base = getRecord(event.base);
  if (base) {
    merged.base = base;
  }
  const table = getRecord(event.table);
  if (table) {
    merged.table = table;
  }

  const baseId = asString(event.baseId) ?? asString(event.base_id) ?? asString(base?.id) ?? config.baseId;
  if (baseId) {
    merged.baseId = baseId;
  }

  const tableId = asString(event.tableId) ?? asString(event.table_id) ?? asString(table?.id) ?? config.tableId;
  if (tableId) {
    merged.tableId = tableId;
  }

  merged.objectType = objectType;
  merged._webhook = compactObject({
    action: normalizeAction(asString(event.action) ?? asString(event.eventType)?.split('.').at(-1) ?? 'update'),
    eventType: asString(event.eventType),
    objectId: explicitId ?? asString(merged.id),
    objectType,
    webhookTimestamp: asNumber(event.webhookTimestamp) ?? asNumber(event.timestamp),
  });

  return merged;
}

function readPayloadObjectType(event: AirtableWebhookPayload): string {
  const data = getRecord(event.data);
  const explicit =
    asString(event.objectType) ??
    asString(event.object_type) ??
    asString(event.type) ??
    asString(event.eventType)?.split('.').at(0) ??
    asString(data?.objectType) ??
    asString(data?.object_type) ??
    asString(data?.type);
  if (explicit) {
    return explicit;
  }

  if (getRecord(event.record) || (data && getRecord(data.fields))) {
    return 'record';
  }
  if (getRecord(event.table) || (data && Array.isArray(data.fields))) {
    return 'table';
  }
  if (getRecord(event.base) || (data && Array.isArray(data.tables))) {
    return 'base';
  }

  throw new Error('Airtable webhook payload is missing object type');
}

function readObjectId(payload: Record<string, unknown>, objectType: string): string | undefined {
  const normalizedType = normalizeAirtableObjectType(objectType);
  const data = getRecord(payload.data);
  const typed =
    normalizedType === 'record'
      ? getRecord(payload.record) ?? data
      : normalizedType === 'table'
        ? getRecord(payload.table) ?? data
        : getRecord(payload.base) ?? data;
  return (
    asString(typed?.id) ??
    asString(payload.id) ??
    asString(payload.objectId) ??
    asString(payload.object_id)
  );
}

function isNormalizedWebhook(event: NormalizedWebhook | AirtableWebhookPayload): event is NormalizedWebhook {
  return (
    typeof (event as NormalizedWebhook).eventType === 'string' &&
    typeof (event as NormalizedWebhook).objectType === 'string' &&
    typeof (event as NormalizedWebhook).objectId === 'string' &&
    isRecord((event as NormalizedWebhook).payload)
  );
}

/**
 * Expands one Airtable payloads-API change descriptor into per-record events.
 *
 * Airtable returns changes as
 * `changedTablesById.<tableId>.{changedRecordsById,createdRecordsById}.<recordId>`
 * (with the re-fetched `cellValuesByFieldId`) and `destroyedRecordIds[]`. Each
 * becomes a normalized record event the rest of the pipeline can materialize.
 * If the payload is already record-shaped (carries `objectType`/`objectId`, e.g.
 * a payload format that pre-normalizes), it is passed through unchanged.
 */
function expandMaterializedPayload(
  rawPayload: Record<string, unknown>,
  fallbackBaseId: string,
): Array<NormalizedWebhook | AirtableWebhookPayload> {
  const record = getRecord(rawPayload) ?? {};
  const baseId = asString(record.baseId) ?? asString(record.base_id) ?? fallbackBaseId;
  const changedTablesById = getRecord(record.changedTablesById);

  if (!changedTablesById) {
    // Already record-shaped, or some other pre-normalized payload. Preserve the
    // prior pass-through behavior so non-CDC formats keep working.
    return [{ ...rawPayload, baseId } as AirtableWebhookPayload];
  }

  const events: NormalizedWebhook[] = [];
  for (const [tableId, tableChangeRaw] of Object.entries(changedTablesById)) {
    const tableChange = getRecord(tableChangeRaw);
    if (!tableChange) {
      continue;
    }

    const upsert = (recordId: string, fields: Record<string, unknown>, action: 'create' | 'update'): void => {
      events.push({
        provider: AIRTABLE_PROVIDER_NAME,
        eventType: `record.${action}`,
        objectType: 'record',
        objectId: recordId,
        payload: { baseId, tableId, id: recordId, fields },
      });
    };

    const createdRecordsById = getRecord(tableChange.createdRecordsById);
    if (createdRecordsById) {
      for (const [recordId, changeRaw] of Object.entries(createdRecordsById)) {
        const change = getRecord(changeRaw);
        const fields =
          getRecord(getRecord(change?.current)?.cellValuesByFieldId) ??
          getRecord(change?.cellValuesByFieldId) ??
          {};
        upsert(recordId, fields, 'create');
      }
    }

    const changedRecordsById = getRecord(tableChange.changedRecordsById);
    if (changedRecordsById) {
      for (const [recordId, changeRaw] of Object.entries(changedRecordsById)) {
        const change = getRecord(changeRaw);
        const fields =
          getRecord(getRecord(change?.current)?.cellValuesByFieldId) ??
          getRecord(change?.cellValuesByFieldId) ??
          {};
        upsert(recordId, fields, 'update');
      }
    }

    const destroyedRecordIds = Array.isArray(tableChange.destroyedRecordIds)
      ? tableChange.destroyedRecordIds
      : [];
    for (const destroyed of destroyedRecordIds) {
      const recordId = asString(destroyed);
      if (!recordId) {
        continue;
      }
      events.push({
        provider: AIRTABLE_PROVIDER_NAME,
        eventType: 'record.delete',
        objectType: 'record',
        objectId: recordId,
        payload: { baseId, tableId, id: recordId, _webhook: { action: 'delete' } },
      });
    }
  }

  return events;
}

function isAirtableWebhookNotification(
  event: AirtableWebhookNotification | NormalizedWebhook | AirtableWebhookPayload,
): event is AirtableWebhookNotification {
  // A notification has baseId + webhookId + timestamp but no payload/objectType/objectId.
  const record = event as Record<string, unknown>;
  return (
    typeof record.baseId === 'string' &&
    typeof record.webhookId === 'string' &&
    typeof record.timestamp === 'string' &&
    !isNormalizedWebhook(event as NormalizedWebhook | AirtableWebhookPayload)
  );
}

function canonicalEventType(eventType: string, objectType: string): string {
  const parts = eventType.trim().toLowerCase().split(/[.:]/u).filter(Boolean);
  if (parts.length >= 2) {
    return `${normalizeAirtableObjectType(parts[0] ?? objectType)}.${normalizeAction(parts[1] ?? 'update')}`;
  }
  return `${normalizeAirtableObjectType(objectType)}.${normalizeAction(eventType)}`;
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
    case 'insert':
      return 'create';
    case 'delete':
    case 'deleted':
    case 'destroy':
    case 'remove':
    case 'removed':
      return 'delete';
    case 'change':
    case 'changed':
    case 'modify':
    case 'modified':
    case 'update':
    case 'updated':
      return 'update';
    default:
      return normalized || 'update';
  }
}

function getWebhookAction(payload: Record<string, unknown>): string | undefined {
  const webhook = getRecord(payload._webhook);
  return normalizeOptionalAction(webhook?.action) ?? normalizeOptionalAction(payload.action);
}

function getEventAction(eventType: string): string | undefined {
  const action = eventType.split(/[.:]/u).filter(Boolean).at(-1);
  return action ? normalizeAction(action) : undefined;
}

function normalizeOptionalAction(value: unknown): string | undefined {
  const string = asString(value);
  return string ? normalizeAction(string) : undefined;
}

function inferWriteCounts(
  result: WriteFileResult | void,
  deleted: boolean,
): { filesDeleted: number; filesUpdated: number; filesWritten: number } {
  if (deleted) {
    return {
      filesDeleted: 1,
      filesUpdated: 0,
      filesWritten: result ? 1 : 0,
    };
  }

  if (!result) {
    return {
      filesDeleted: 0,
      filesUpdated: 0,
      filesWritten: 1,
    };
  }

  if (result.created || result.status === 'created') {
    return {
      filesDeleted: 0,
      filesUpdated: 0,
      filesWritten: 1,
    };
  }

  if (result.updated || result.status === 'updated') {
    return {
      filesDeleted: 0,
      filesUpdated: 1,
      filesWritten: 0,
    };
  }

  return {
    filesDeleted: 0,
    filesUpdated: 0,
    filesWritten: 1,
  };
}

function inferFallbackPath(event: NormalizedWebhook | AirtableWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      const objectType = normalizeAirtableObjectType(event.objectType);
      return computeAirtablePath(objectType, event.objectId, contextFromPayload(event.payload));
    }

    const objectType = normalizeAirtableObjectType(readPayloadObjectType(event));
    const payload = mergeAirtablePayload(event, objectType, {});
    const objectId = readObjectId(payload, objectType) ?? 'unknown';
    return computeAirtablePath(objectType, objectId, contextFromPayload(payload));
  } catch {
    return '/airtable/unmapped-webhook.json';
  }
}

function asFields(value: unknown): AirtableField[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isAirtableField);
}

function mergeContext(
  context: { baseId?: string; tableId?: string },
  config: AirtableAdapterConfig,
): { baseId?: string; tableId?: string } {
  const merged: { baseId?: string; tableId?: string } = {};
  const baseId = context.baseId ?? config.baseId;
  if (baseId) {
    merged.baseId = baseId;
  }
  const tableId = context.tableId ?? config.tableId;
  if (tableId) {
    merged.tableId = tableId;
  }
  return merged;
}

function contextFromPayload(payload: Record<string, unknown>): { baseId?: string; tableId?: string } {
  const context: { baseId?: string; tableId?: string } = {};
  const baseId = asString(payload.baseId);
  if (baseId) {
    context.baseId = baseId;
  }
  const tableId = asString(payload.tableId);
  if (tableId) {
    context.tableId = tableId;
  }
  return context;
}

function isAirtableField(value: unknown): value is AirtableField {
  if (!isRecord(value)) {
    return false;
  }
  return Boolean(asString(value.id) && asString(value.name));
}

function asViews(value: unknown): AirtableView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isAirtableView);
}

function isAirtableView(value: unknown): value is AirtableView {
  if (!isRecord(value)) {
    return false;
  }
  return Boolean(asString(value.id) && asString(value.name));
}

function asTables(value: unknown): AirtableTable[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isAirtableTable);
}

function isAirtableTable(value: unknown): value is AirtableTable {
  if (!isRecord(value)) {
    return false;
  }
  return Boolean(asString(value.id));
}

function addStringProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const string = asString(value);
  if (string) {
    properties[key] = string;
  }
}

function addFirstStringProperty(properties: Record<string, string>, key: string, ...values: unknown[]): void {
  for (const value of values) {
    const string = asString(value);
    if (string) {
      properties[key] = string;
      return;
    }
  }
}

function addNumberProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const number = asNumber(value);
  if (number !== undefined) {
    properties[key] = String(number);
  }
}

function addStringListProperty(properties: Record<string, string>, key: string, values: string[]): void {
  const cleaned = uniqueStrings(values);
  if (cleaned.length > 0) {
    properties[key] = cleaned.join(', ');
  }
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

function compactObject(object: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null) {
      compacted[key] = value;
    }
  }
  return compacted;
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return sortStrings(values.filter(isString).map((value) => value.trim()).filter(Boolean));
}

function stringifyFieldValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const simpleValues = value.map(stringifyFieldValue).filter(isString);
    return simpleValues.length > 0 ? simpleValues.join(', ') : undefined;
  }
  if (isRecord(value)) {
    return stableJson(value);
  }
  return String(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      sorted[key] = sortJson(value[key]);
    }
    return sorted;
  }
  return value;
}

function slugPropertyKey(value: string): string {
  const slug = value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug || 'unnamed';
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const string = asString(value);
    if (string) {
      return string;
    }
  }
  return undefined;
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

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getRecord(value: unknown): AirtablePayloadRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is AirtablePayloadRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
