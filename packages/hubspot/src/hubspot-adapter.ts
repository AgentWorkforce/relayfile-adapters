import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeHubSpotPath,
  hubSpotCompanyPath,
  hubSpotContactPath,
  hubSpotDealPath,
  hubSpotTicketPath,
  normalizeHubSpotObjectType,
} from './path-mapper.js';
import {
  normalizeHubSpotWebhook,
  normalizeHubSpotWebhookBatch,
} from './webhook-normalizer.js';
import { HubSpotApiClient } from './api.js';
import { HUBSPOT_OBJECT_TYPES } from './types.js';
import type {
  HubSpotAdapterConfig,
  HubSpotAssociationReference,
  HubSpotCompany,
  HubSpotContact,
  HubSpotCrmObject,
  HubSpotDeal,
  HubSpotObjectType,
  HubSpotProperties,
  HubSpotTicket,
  HubSpotWebhookEnvelope,
  HubSpotWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | HubSpotWebhookEnvelope): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;

  supportedEvents?(): string[];
}

type HubSpotRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const HUBSPOT_PROVIDER_NAME = 'hubspot';
const SUPPORTED_EVENTS = HUBSPOT_OBJECT_TYPES;

export class HubSpotAdapter extends IntegrationAdapter {
  override readonly name = HUBSPOT_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: HubSpotAdapterConfig;
  private readonly api: HubSpotApiClient;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: HubSpotAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
    this.api = new HubSpotApiClient(provider, config);
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.created`,
      `${objectType}.propertyChange`,
      `${objectType}.deleted`,
      `${objectType}.merged`,
      `${objectType}.associationChange`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | HubSpotWebhookEnvelope,
  ): Promise<IngestResult> {
    const normalizedEvents = this.normalizeIncomingEvents(event);
    const aggregate: IngestResult = {
      errors: [],
      filesDeleted: 0,
      filesUpdated: 0,
      filesWritten: 0,
      paths: [],
    };

    for (const normalized of normalizedEvents) {
      const result = await this.ingestOne(workspaceId, normalized);
      aggregate.filesWritten += result.filesWritten;
      aggregate.filesUpdated += result.filesUpdated;
      aggregate.filesDeleted += result.filesDeleted;
      aggregate.paths.push(...result.paths);
      aggregate.errors.push(...result.errors);
    }

    aggregate.paths = uniqueStrings(aggregate.paths);
    return aggregate;
  }

  override computePath(objectType: string, objectId: string): string {
    return computeHubSpotPath(objectType, objectId);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeHubSpotObjectType(objectType);
    const properties: Record<string, string> = {
      'hubspot.id': objectId,
      'hubspot.object_id': objectId,
      'hubspot.object_type': normalizedType,
      provider: HUBSPOT_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments = new Set<string>();
    const permissions = new Set<string>();

    addCommonSemantics(properties, relations, comments, permissions, normalizedType, objectId, payload);

    switch (normalizedType) {
      case 'company':
        applyCompanySemantics(properties, relations, comments, payload as HubSpotCompany & HubSpotRecord);
        break;
      case 'contact':
        applyContactSemantics(properties, relations, comments, payload as HubSpotContact & HubSpotRecord);
        break;
      case 'deal':
        applyDealSemantics(properties, relations, comments, payload as HubSpotDeal & HubSpotRecord);
        break;
      case 'ticket':
        applyTicketSemantics(properties, relations, comments, payload as HubSpotTicket & HubSpotRecord);
        break;
    }

    const semantics: FileSemantics = {
      properties,
      relations: sortStrings(relations),
    };
    if (comments.size > 0) {
      semantics.comments = sortStrings(comments);
    }
    if (permissions.size > 0) {
      semantics.permissions = sortStrings(permissions);
    }
    return compactSemantics(semantics);
  }

  private async ingestOne(workspaceId: string, normalized: NormalizedWebhook): Promise<IngestResult> {
    try {
      const objectType = normalizeHubSpotObjectType(normalized.objectType);
      const objectId = normalized.objectId.trim();
      if (!objectId) {
        throw new Error(`HubSpot ${objectType} webhook is missing object id`);
      }
      const path = this.computePath(objectType, objectId);

      if (this.isDeleteEvent(normalized)) {
        return await this.deleteOrTombstone(workspaceId, path, normalized);
      }

      // HubSpot webhooks are notification-only: they carry objectId +
      // subscriptionType + a single changed property. Re-fetch the full CRM
      // record before writing so consumers get authoritative data. On fetch
      // failure, fall back to merging the incoming delta onto the existing
      // stored file.
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
        semantics: this.computeSemantics(objectType, objectId, reconciled.payload),
      });

      const counts = inferWriteCounts(writeResult, false, reconciled);
      return {
        errors: [],
        filesDeleted: 0,
        filesUpdated: counts.filesUpdated,
        filesWritten: counts.filesWritten,
        paths: [path],
      };
    } catch (error) {
      const fallbackPath = inferFallbackPath(normalized);
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
    try {
      const fetchOptions: { connectionId?: string; providerConfigKey?: string } = {};
      if (event.connectionId) {
        fetchOptions.connectionId = event.connectionId;
      }
      const providerConfigKey = readProviderConfigKey(event.payload);
      if (providerConfigKey) {
        fetchOptions.providerConfigKey = providerConfigKey;
      }
      const fetched = await this.api.fetchCrmObject(event.objectType, event.objectId, fetchOptions);
      return mergeFetchedPayload(fetched, event.payload);
    } catch {
      return mergeFallbackPayload(await this.readExistingPayload(workspaceId, path), event.payload);
    }
  }

  private async readExistingPayload(
    workspaceId: string,
    path: string,
  ): Promise<HubSpotRecord | undefined> {
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
      if (!isPlainObject(parsed)) {
        return undefined;
      }
      return isPlainObject(parsed.payload) ? parsed.payload : parsed;
    } catch {
      return undefined;
    }
  }

  private async deleteOrTombstone(
    workspaceId: string,
    path: string,
    normalized: NormalizedWebhook,
  ): Promise<IngestResult> {
    if (this.client.deleteFile) {
      await this.client.deleteFile({ path, workspaceId });
      return {
        errors: [],
        filesDeleted: 1,
        filesUpdated: 0,
        filesWritten: 0,
        paths: [path],
      };
    }

    const objectType = normalizeHubSpotObjectType(normalized.objectType);
    const writeResult = await this.client.writeFile({
      workspaceId,
      path,
      content: this.renderContent(workspaceId, normalized, true),
      contentType: JSON_CONTENT_TYPE,
      semantics: this.computeSemantics(objectType, normalized.objectId, normalized.payload),
    });

    const counts = inferWriteCounts(writeResult, true, normalized);
    return {
      errors: [],
      filesDeleted: counts.filesDeleted,
      filesUpdated: counts.filesUpdated,
      filesWritten: counts.filesWritten,
      paths: [path],
    };
  }

  private normalizeIncomingEvents(event: NormalizedWebhook | HubSpotWebhookEnvelope): NormalizedWebhook[] {
    if (isNormalizedWebhook(event)) {
      return [this.applyConfigDefaults(event)];
    }
    const hints = this.normalizationHints();
    const normalized = normalizeHubSpotWebhookBatch(event, {}, hints);
    if (normalized.length > 0) {
      return normalized;
    }
    return [normalizeHubSpotWebhook(event, {}, hints)];
  }

  private normalizationHints(): { connectionId?: string; provider?: string; providerConfigKey?: string } {
    const hints: { connectionId?: string; provider?: string; providerConfigKey?: string } = {
      provider: this.config.provider ?? HUBSPOT_PROVIDER_NAME,
    };
    if (this.config.connectionId) {
      hints.connectionId = this.config.connectionId;
    }
    if (this.config.providerConfigKey) {
      hints.providerConfigKey = this.config.providerConfigKey;
    }
    return hints;
  }

  private applyConfigDefaults(event: NormalizedWebhook): NormalizedWebhook {
    const normalized: NormalizedWebhook = {
      eventType: event.eventType,
      objectId: event.objectId.trim(),
      objectType: normalizeHubSpotObjectType(event.objectType),
      payload: event.payload,
      provider: event.provider || this.config.provider || HUBSPOT_PROVIDER_NAME,
    };
    const connectionId = event.connectionId || this.config.connectionId;
    if (connectionId) {
      normalized.connectionId = connectionId;
    }
    return normalized;
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const eventAction = getEventAction(event.eventType);
    const webhook = getRecord(event.payload._webhook);
    const subscriptionType = asString(event.payload.subscriptionType) ?? asString(webhook?.subscriptionType);
    const changeFlag = asString(event.payload.changeFlag);
    return (
      eventAction === 'deleted' ||
      eventAction === 'deletion' ||
      subscriptionType?.toLowerCase().endsWith('.deletion') === true ||
      changeFlag?.toUpperCase() === 'DELETED'
    );
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      connectionId: event.connectionId ?? null,
      deleted,
      eventType: event.eventType,
      objectId: event.objectId,
      objectType: normalizeHubSpotObjectType(event.objectType),
      payload: event.payload,
      provider: event.provider,
      workspaceId,
    });
  }
}

function addCommonSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: Set<string>,
  permissions: Set<string>,
  objectType: HubSpotObjectType,
  objectId: string,
  payload: HubSpotRecord,
): void {
  addStringProperty(properties, 'hubspot.created_at', payload.createdAt);
  addStringProperty(properties, 'hubspot.updated_at', payload.updatedAt);
  addStringProperty(properties, 'hubspot.archived_at', payload.archivedAt);
  addBooleanProperty(properties, 'hubspot.archived', payload.archived);

  const webhook = getRecord(payload._webhook);
  if (webhook) {
    addStringProperty(properties, 'hubspot.webhook.event_type', webhook.eventType);
    addStringProperty(properties, 'hubspot.webhook.subscription_type', webhook.subscriptionType);
    addStringProperty(properties, 'hubspot.webhook.property_name', webhook.propertyName);
    addStringProperty(properties, 'hubspot.webhook.change_source', webhook.changeSource);
    addNumberProperty(properties, 'hubspot.webhook.event_id', webhook.eventId);
    addNumberProperty(properties, 'hubspot.webhook.portal_id', webhook.portalId);
    addNumberProperty(properties, 'hubspot.webhook.occurred_at', webhook.occurredAt);
  }

  addStringProperty(properties, 'hubspot.property_name', payload.propertyName);
  addStringProperty(properties, 'hubspot.change_source', payload.changeSource);
  addNumberProperty(properties, 'hubspot.portal_id', payload.portalId);
  addNumberProperty(properties, 'hubspot.event_id', payload.eventId);
  addNumberProperty(properties, 'hubspot.occurred_at', payload.occurredAt);

  if (payload.archived === true) {
    comments.add('hubspot:archived');
  }

  const associations = readAssociations(payload);
  for (const [associationType, associatedObjects] of Object.entries(associations)) {
    addAssociationRelations(relations, comments, associationType, associatedObjects);
  }

  const selfPath = computeHubSpotPath(objectType, objectId);
  properties['hubspot.path'] = selfPath;
  permissions.add('scope:crm');
}

function applyContactSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: Set<string>,
  payload: HubSpotContact & HubSpotRecord,
): void {
  const crm = readCrmObject(payload);
  const contactProperties = crm.properties;
  const firstName = asString(contactProperties.firstname);
  const lastName = asString(contactProperties.lastname);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  addStringProperty(properties, 'hubspot.contact.email', contactProperties.email);
  addStringProperty(properties, 'hubspot.contact.first_name', firstName);
  addStringProperty(properties, 'hubspot.contact.last_name', lastName);
  addStringProperty(properties, 'hubspot.contact.name', fullName || undefined);
  addStringProperty(properties, 'hubspot.contact.phone', contactProperties.phone);
  addStringProperty(properties, 'hubspot.contact.company', contactProperties.company);
  addStringProperty(properties, 'hubspot.contact.job_title', contactProperties.jobtitle);
  addStringProperty(properties, 'hubspot.contact.lifecycle_stage', contactProperties.lifecyclestage);
  addStringProperty(properties, 'hubspot.contact.website', contactProperties.website);
  addFirstStringProperty(properties, 'hubspot.created_at', properties['hubspot.created_at'], contactProperties.createdate);
  addFirstStringProperty(properties, 'hubspot.updated_at', properties['hubspot.updated_at'], contactProperties.lastmodifieddate);

  const email = asString(contactProperties.email);
  if (email) {
    relations.add(`mailto:${email}`);
    comments.add(`email:${email}`);
  }

  const companyName = asString(contactProperties.company);
  if (companyName) {
    comments.add(`company:${companyName}`);
  }

  addTypedAssociationRelations(relations, 'companies', crm.associations.companies);
  addTypedAssociationRelations(relations, 'deals', crm.associations.deals);
  addTypedAssociationRelations(relations, 'tickets', crm.associations.tickets);
}

function applyCompanySemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: Set<string>,
  payload: HubSpotCompany & HubSpotRecord,
): void {
  const crm = readCrmObject(payload);
  const companyProperties = crm.properties;

  addStringProperty(properties, 'hubspot.company.name', companyProperties.name);
  addStringProperty(properties, 'hubspot.company.domain', companyProperties.domain);
  addStringProperty(properties, 'hubspot.company.website', companyProperties.website);
  addStringProperty(properties, 'hubspot.company.industry', companyProperties.industry);
  addStringProperty(properties, 'hubspot.company.lifecycle_stage', companyProperties.lifecyclestage);
  addStringProperty(properties, 'hubspot.company.phone', companyProperties.phone);
  addStringProperty(properties, 'hubspot.company.city', companyProperties.city);
  addStringProperty(properties, 'hubspot.company.state', companyProperties.state);
  addStringProperty(properties, 'hubspot.company.country', companyProperties.country);
  addNumberProperty(properties, 'hubspot.company.employee_count', companyProperties.numberofemployees);
  addFirstStringProperty(properties, 'hubspot.created_at', properties['hubspot.created_at'], companyProperties.createdate);
  addFirstStringProperty(properties, 'hubspot.updated_at', properties['hubspot.updated_at'], companyProperties.hs_lastmodifieddate);

  const domain = asString(companyProperties.domain);
  if (domain) {
    relations.add(`domain:${domain}`);
    comments.add(`domain:${domain}`);
  }

  const website = asString(companyProperties.website);
  if (website) {
    relations.add(`link:${website}`);
  }

  addTypedAssociationRelations(relations, 'contacts', crm.associations.contacts);
  addTypedAssociationRelations(relations, 'deals', crm.associations.deals);
  addTypedAssociationRelations(relations, 'tickets', crm.associations.tickets);
}

function applyDealSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: Set<string>,
  payload: HubSpotDeal & HubSpotRecord,
): void {
  const crm = readCrmObject(payload);
  const dealProperties = crm.properties;

  addStringProperty(properties, 'hubspot.deal.name', dealProperties.dealname);
  addStringProperty(properties, 'hubspot.deal.stage', dealProperties.dealstage);
  addStringProperty(properties, 'hubspot.deal.pipeline', dealProperties.pipeline);
  addStringProperty(properties, 'hubspot.deal.close_date', dealProperties.closedate);
  addStringProperty(properties, 'hubspot.deal.priority', dealProperties.hs_priority);
  addStringProperty(properties, 'hubspot.deal.owner_id', dealProperties.hubspot_owner_id);
  addNumberProperty(properties, 'hubspot.deal.amount', dealProperties.amount);
  addFirstStringProperty(properties, 'hubspot.created_at', properties['hubspot.created_at'], dealProperties.createdate);
  addFirstStringProperty(properties, 'hubspot.updated_at', properties['hubspot.updated_at'], dealProperties.hs_lastmodifieddate);

  const amount = asNumber(dealProperties.amount);
  if (amount !== undefined) {
    comments.add(`amount:${amount}`);
  }

  const dealStage = asString(dealProperties.dealstage);
  if (dealStage) {
    comments.add(`deal_stage:${dealStage}`);
  }

  addTypedAssociationRelations(relations, 'contacts', crm.associations.contacts);
  addTypedAssociationRelations(relations, 'companies', crm.associations.companies);
  addTypedAssociationRelations(relations, 'tickets', crm.associations.tickets);
}

function applyTicketSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: Set<string>,
  payload: HubSpotTicket & HubSpotRecord,
): void {
  const crm = readCrmObject(payload);
  const ticketProperties = crm.properties;

  addStringProperty(properties, 'hubspot.ticket.subject', ticketProperties.subject);
  addStringProperty(properties, 'hubspot.ticket.pipeline', ticketProperties.hs_pipeline);
  addStringProperty(properties, 'hubspot.ticket.stage', ticketProperties.hs_pipeline_stage);
  addStringProperty(properties, 'hubspot.ticket.priority', ticketProperties.hs_ticket_priority);
  addStringProperty(properties, 'hubspot.ticket.category', ticketProperties.hs_ticket_category);
  addStringProperty(properties, 'hubspot.ticket.owner_id', ticketProperties.hubspot_owner_id);
  addFirstStringProperty(properties, 'hubspot.created_at', properties['hubspot.created_at'], ticketProperties.createdate);
  addFirstStringProperty(properties, 'hubspot.updated_at', properties['hubspot.updated_at'], ticketProperties.hs_lastmodifieddate);

  const content = asString(ticketProperties.content);
  if (content) {
    comments.add(content);
    properties['hubspot.ticket.content_length'] = String(content.length);
  }

  const priority = asString(ticketProperties.hs_ticket_priority);
  if (priority) {
    comments.add(`ticket_priority:${priority}`);
  }

  addTypedAssociationRelations(relations, 'contacts', crm.associations.contacts);
  addTypedAssociationRelations(relations, 'companies', crm.associations.companies);
  addTypedAssociationRelations(relations, 'deals', crm.associations.deals);
}

function readCrmObject(payload: HubSpotCrmObject & HubSpotRecord): {
  associations: Record<string, HubSpotAssociationReference[]>;
  properties: HubSpotProperties;
} {
  return {
    associations: readAssociations(payload),
    properties: readProperties(payload),
  };
}

function readProperties(payload: HubSpotRecord): HubSpotProperties {
  const direct = getRecord(payload.properties);
  if (direct) {
    return direct as HubSpotProperties;
  }

  const properties: HubSpotProperties = {};
  for (const [key, value] of Object.entries(payload)) {
    if (isLikelyHubSpotProperty(key, value)) {
      properties[key] = value as string | number | boolean | null | undefined;
    }
  }
  const propertyName = asString(payload.propertyName);
  if (propertyName) {
    properties[propertyName] = asPropertyValue(payload.propertyValue);
  }
  return properties;
}

function readAssociations(payload: HubSpotRecord): Record<string, HubSpotAssociationReference[]> {
  const associations = getRecord(payload.associations);
  if (!associations) {
    return {};
  }

  const result: Record<string, HubSpotAssociationReference[]> = {};
  for (const [associationType, rawValue] of Object.entries(associations)) {
    result[associationType] = readAssociationList(rawValue);
  }
  return result;
}

function readAssociationList(value: unknown): HubSpotAssociationReference[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => readAssociationEntry(entry));
  }

  const record = getRecord(value);
  if (!record) {
    return [];
  }

  const results = getRecord(record.results);
  if (Array.isArray(record.results)) {
    return record.results.flatMap((entry) => readAssociationEntry(entry));
  }
  if (results) {
    return Object.values(results).flatMap((entry) => readAssociationEntry(entry));
  }
  return readAssociationEntry(record);
}

function readAssociationEntry(value: unknown): HubSpotAssociationReference[] {
  const record = getRecord(value);
  if (!record) {
    const id = asString(value);
    return id ? [{ id }] : [];
  }

  const id = asString(record.id) ?? asString(record.toObjectId) ?? asString(record.objectId);
  if (!id) {
    return [];
  }

  const association: HubSpotAssociationReference = { id };
  const type = asString(record.type);
  if (type) {
    association.type = type;
  }
  return [association];
}

function addAssociationRelations(
  relations: Set<string>,
  comments: Set<string>,
  associationType: string,
  associatedObjects: HubSpotAssociationReference[],
): void {
  addTypedAssociationRelations(relations, associationType, associatedObjects);
  if (associatedObjects.length > 0) {
    comments.add(`associated_${associationType}:${associatedObjects.length}`);
  }
}

function addTypedAssociationRelations(
  relations: Set<string>,
  associationType: string,
  associatedObjects: HubSpotAssociationReference[] | undefined,
): void {
  if (!associatedObjects) {
    return;
  }
  const normalized = associationType.toLowerCase();
  for (const association of associatedObjects) {
    const id = asString(association.id);
    if (!id) {
      continue;
    }
    if (normalized === 'company' || normalized === 'companies') {
      relations.add(hubSpotCompanyPath(id));
    } else if (normalized === 'contact' || normalized === 'contacts') {
      relations.add(hubSpotContactPath(id));
    } else if (normalized === 'deal' || normalized === 'deals') {
      relations.add(hubSpotDealPath(id));
    } else if (normalized === 'ticket' || normalized === 'tickets') {
      relations.add(hubSpotTicketPath(id));
    } else {
      relations.add(`hubspot:${normalized}:${id}`);
    }
  }
}

function isLikelyHubSpotProperty(key: string, value: unknown): boolean {
  if (value === undefined || typeof value === 'function') {
    return false;
  }
  return (
    key !== 'id' &&
    key !== 'archived' &&
    key !== 'associations' &&
    key !== 'createdAt' &&
    key !== 'updatedAt' &&
    key !== '_connection' &&
    key !== '_webhook'
  );
}

function asPropertyValue(value: unknown): string | number | boolean | null | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function inferWriteCounts(
  result: WriteFileResult | void,
  deleted: boolean,
  event?: NormalizedWebhook,
): { filesDeleted: number; filesUpdated: number; filesWritten: number } {
  if (deleted) {
    return {
      filesDeleted: 1,
      filesUpdated: 0,
      filesWritten: 0,
    };
  }

  if (result?.created === true || result?.status === 'created') {
    return {
      filesDeleted: 0,
      filesUpdated: 0,
      filesWritten: 1,
    };
  }

  // RelayFileClientLike.writeFile() may resolve without metadata. When that
  // happens and the inbound event represents a creation (eventType ends with
  // ".creation" or ".created"), count it as filesWritten so *.created
  // webhooks are not under-counted.
  if (
    (result === undefined || (result?.created === undefined && result?.status === undefined)) &&
    event &&
    isCreationEventType(event.eventType)
  ) {
    return {
      filesDeleted: 0,
      filesUpdated: 0,
      filesWritten: 1,
    };
  }

  return {
    filesDeleted: 0,
    filesUpdated: 1,
    filesWritten: 0,
  };
}

function isCreationEventType(eventType: string | undefined): boolean {
  if (!eventType) return false;
  const lower = eventType.toLowerCase();
  return lower.endsWith('.creation') || lower.endsWith('.created') || lower === 'creation';
}

function inferFallbackPath(event: NormalizedWebhook): string {
  try {
    return computeHubSpotPath(event.objectType, event.objectId);
  } catch {
    return `/hubspot/errors/${encodeURIComponent(event.objectType || 'unknown')}-${encodeURIComponent(event.objectId || 'unknown')}.json`;
  }
}

function isNormalizedWebhook(event: unknown): event is NormalizedWebhook {
  const record = getRecord(event);
  return Boolean(
    record &&
      typeof record.eventType === 'string' &&
      typeof record.objectType === 'string' &&
      typeof record.objectId === 'string' &&
      isPlainObject(record.payload),
  );
}

function getEventAction(eventType: string): string {
  const [, action] = eventType.split('.');
  return (action ?? eventType).trim();
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

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = sortJsonValue(value[key]);
  }
  return sorted;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
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

function getRecord(value: unknown): HubSpotRecord | undefined {
  return isPlainObject(value) ? value : undefined;
}

function isPlainObject(value: unknown): value is HubSpotRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeFetchedPayload(
  fetched: HubSpotRecord,
  webhookPayload: HubSpotRecord,
): HubSpotRecord {
  // Prefer the authoritative fetched record, but preserve webhook metadata
  // (_webhook, _connection) from the incoming payload.
  return {
    ...fetched,
    ...pickWebhookMetadata(webhookPayload),
  };
}

function mergeFallbackPayload(
  existingPayload: HubSpotRecord | undefined,
  webhookPayload: HubSpotRecord,
): HubSpotRecord {
  // Strip stale _webhook from the existing payload so the current event's
  // metadata wins and inferWriteCounts never reads a previous action.
  const { _webhook: _discarded, ...existingWithoutWebhook } = existingPayload ?? {};
  return {
    ...existingWithoutWebhook,
    ...webhookPayload,
  };
}

function pickWebhookMetadata(payload: HubSpotRecord): HubSpotRecord {
  const metadata: HubSpotRecord = {};
  if (isPlainObject(payload._connection)) {
    metadata._connection = payload._connection;
  }
  if (isPlainObject(payload._webhook)) {
    metadata._webhook = payload._webhook;
  }
  return metadata;
}

function readProviderConfigKey(payload: HubSpotRecord): string | undefined {
  const connection = getRecord(payload._connection);
  return asString(connection?.providerConfigKey) ?? asString(connection?.provider_config_key);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
