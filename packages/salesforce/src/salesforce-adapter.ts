import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeSalesforcePath,
  normalizeSalesforceObjectType,
  salesforceAccountPath,
  salesforceCasePath,
  salesforceContactPath,
  salesforceLeadPath,
  salesforceOpportunityPath,
} from './path-mapper.js';
import { SalesforceApiClient } from './api.js';
import { SALESFORCE_OBJECT_TYPES } from './types.js';
import type {
  SalesforceAccount,
  SalesforceAdapterConfig,
  SalesforceCase,
  SalesforceContact,
  SalesforceLead,
  SalesforceObjectType,
  SalesforceOpportunity,
  SalesforcePrimaryObject,
  SalesforceWebhookPayload,
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
  status?: 'created' | 'pending' | 'queued' | 'updated';
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | SalesforceWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;

  supportedEvents?(): string[];
  supportedScopeKeys?(): string[];
}

type SalesforceRecord = Record<string, unknown>;
type SalesforceWebhookEnvelope = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SALESFORCE_PROVIDER_NAME = 'salesforce';
const SUPPORTED_EVENTS = SALESFORCE_OBJECT_TYPES;

export class SalesforceAdapter extends IntegrationAdapter {
  override readonly name = SALESFORCE_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: SalesforceAdapterConfig;
  private readonly api: SalesforceApiClient;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: SalesforceAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
    this.api = new SalesforceApiClient(provider, config);
  }

  override supportedScopeKeys(): string[] {
    return ['connectionId', 'providerConfigKey'];
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => {
      const events = [
        `${objectType}.created`,
        `${objectType}.updated`,
        `${objectType}.deleted`,
        `${objectType}.upserted`,
      ];
      if (objectType === 'Case') {
        events.push(`${objectType}.closed`);
      } else if (objectType === 'Lead') {
        events.push(`${objectType}.converted`);
      }
      return events;
    });
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | SalesforceWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = computeSalesforcePath(normalized.objectType, normalized.objectId);

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
          semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
        });
        const counts = inferWriteCounts(normalized, deleteResult, true);
        return {
          filesWritten: counts.filesWritten,
          filesUpdated: counts.filesUpdated,
          filesDeleted: counts.filesDeleted,
          paths: [path],
          errors: [],
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

      const counts = inferWriteCounts(reconciled, writeResult, false);
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
    return computeSalesforcePath(objectType, objectId);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeSalesforceObjectType(objectType);
    const properties: Record<string, string> = {
      provider: SALESFORCE_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'salesforce.id': objectId,
      'salesforce.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'salesforce.webhook.action', webhook.action);
      addStringProperty(properties, 'salesforce.webhook.created_at', webhook.createdAt);
      addStringProperty(properties, 'salesforce.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'salesforce.webhook.organization_id', webhook.organizationId);
      addStringProperty(properties, 'salesforce.webhook.timestamp', webhook.timestamp);
      addStringProperty(properties, 'salesforce.webhook.webhook_id', webhook.webhookId);
    }

    applyCommonSemantics(properties, payload);

    switch (normalizedType) {
      case 'Account':
        applyAccountSemantics(properties, relations, comments, payload as SalesforceRecord);
        break;
      case 'Contact':
        applyContactSemantics(properties, relations, comments, payload as SalesforceRecord);
        break;
      case 'Opportunity':
        applyOpportunitySemantics(properties, relations, comments, payload as SalesforceRecord);
        break;
      case 'Lead':
        applyLeadSemantics(properties, relations, comments, payload as SalesforceRecord);
        break;
      case 'Case':
        applyCaseSemantics(properties, relations, comments, payload as SalesforceRecord);
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

  private normalizeEvent(event: NormalizedWebhook | SalesforceWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || SALESFORCE_PROVIDER_NAME,
        eventType: canonicalizeEventType(event.eventType, event.objectType),
        objectType: normalizeSalesforceObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = normalizeSalesforceObjectType(readWebhookType(event));
    const objectId = extractPayloadId(event.data) ?? asString(event.objectId);
    if (!objectId) {
      throw new Error(`Salesforce ${objectType} webhook is missing data.Id`);
    }

    let action = normalizeAction(asString(event.action) ?? 'updated');
    if (action === 'updated') {
      const data = getRecord(event.data) ?? {};
      const header = getRecord(data.ChangeEventHeader);
      const changedFields = Array.isArray(header?.changedFields) ? (header.changedFields as unknown[]).map(String) : [];
      if (changedFields.includes('IsClosed') && data.IsClosed === true) {
        action = 'closed';
      } else if (changedFields.includes('IsConverted') && data.IsConverted === true) {
        action = 'converted';
      }
    }
    const payload = mergeSalesforcePayload(event, objectType, objectId, action);
    const normalized: NormalizedWebhook = {
      provider: this.config.provider || SALESFORCE_PROVIDER_NAME,
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

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'deleted' || action === 'delete';
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
      const fetched = await this.api.fetchSObject(event.objectType, event.objectId, fetchOptions);
      return mergeFetchedPayload(fetched, event.payload);
    } catch {
      return mergeFallbackPayload(await this.readExistingPayload(workspaceId, path), event.payload);
    }
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

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeSalesforceObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyCommonSemantics(properties: Record<string, string>, payload: SalesforceRecord): void {
  addStringProperty(properties, 'salesforce.name', payload.Name);
  addStringProperty(properties, 'salesforce.created_at', payload.CreatedDate);
  addStringProperty(properties, 'salesforce.updated_at', payload.LastModifiedDate);
  addStringProperty(properties, 'salesforce.owner_id', payload.OwnerId);

  const owner = getRecord(payload.Owner);
  if (owner) {
    addStringProperty(properties, 'salesforce.owner_name', owner.Name);
    addStringProperty(properties, 'salesforce.owner_email', owner.Email);
  }
}

function applyAccountSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: SalesforceRecord,
): void {
  const account = payload as Partial<SalesforceAccount> & SalesforceRecord;

  addStringProperty(properties, 'salesforce.account.name', account.Name);
  addStringProperty(properties, 'salesforce.account.number', account.AccountNumber);
  addStringProperty(properties, 'salesforce.account.type', account.Type);
  addStringProperty(properties, 'salesforce.account.industry', account.Industry);
  addStringProperty(properties, 'salesforce.account.rating', account.Rating);
  addStringProperty(properties, 'salesforce.account.website', account.Website);
  addStringProperty(properties, 'salesforce.account.phone', account.Phone);
  addNumberProperty(properties, 'salesforce.account.annual_revenue', account.AnnualRevenue);
  addNumberProperty(properties, 'salesforce.account.employee_count', account.NumberOfEmployees);

  addAddressProperties(properties, 'salesforce.account.billing', {
    street: account.BillingStreet,
    city: account.BillingCity,
    state: account.BillingState,
    postalCode: account.BillingPostalCode,
    country: account.BillingCountry,
  });
  addAddressProperties(properties, 'salesforce.account.shipping', {
    street: account.ShippingStreet,
    city: account.ShippingCity,
    state: account.ShippingState,
    postalCode: account.ShippingPostalCode,
    country: account.ShippingCountry,
  });

  const parentId = asString(account.ParentId) ?? asString(account.Parent?.Id);
  if (parentId) {
    relations.add(salesforceAccountPath(parentId));
    addStringProperty(properties, 'salesforce.account.parent_id', parentId);
  }
  addFirstStringProperty(properties, 'salesforce.account.parent_name', account.Parent?.Name);

  const description = asString(account.Description);
  if (description) {
    comments.push(description);
    properties['salesforce.account.description_length'] = String(description.length);
  }
}

function applyContactSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: SalesforceRecord,
): void {
  const contact = payload as Partial<SalesforceContact> & SalesforceRecord;

  addStringProperty(properties, 'salesforce.contact.name', contact.Name);
  addStringProperty(properties, 'salesforce.contact.first_name', contact.FirstName);
  addStringProperty(properties, 'salesforce.contact.last_name', contact.LastName);
  addStringProperty(properties, 'salesforce.contact.title', contact.Title);
  addStringProperty(properties, 'salesforce.contact.department', contact.Department);
  addStringProperty(properties, 'salesforce.contact.email', contact.Email);
  addStringProperty(properties, 'salesforce.contact.phone', contact.Phone);
  addStringProperty(properties, 'salesforce.contact.mobile_phone', contact.MobilePhone);
  addStringProperty(properties, 'salesforce.contact.home_phone', contact.HomePhone);
  addStringProperty(properties, 'salesforce.contact.lead_source', contact.LeadSource);
  addStringProperty(properties, 'salesforce.contact.birthdate', contact.Birthdate);
  addStringProperty(properties, 'salesforce.contact.assistant_name', contact.AssistantName);

  const accountId = asString(contact.AccountId) ?? asString(contact.Account?.Id);
  if (accountId) {
    relations.add(salesforceAccountPath(accountId));
    addStringProperty(properties, 'salesforce.contact.account_id', accountId);
  }
  addStringProperty(properties, 'salesforce.contact.account_name', contact.Account?.Name);

  const reportsToId = asString(contact.ReportsToId);
  if (reportsToId) {
    relations.add(salesforceContactPath(reportsToId));
    addStringProperty(properties, 'salesforce.contact.reports_to_id', reportsToId);
  }

  addAddressProperties(properties, 'salesforce.contact.mailing', {
    street: contact.MailingStreet,
    city: contact.MailingCity,
    state: contact.MailingState,
    postalCode: contact.MailingPostalCode,
    country: contact.MailingCountry,
  });

  const description = asString(contact.Description);
  if (description) {
    comments.push(description);
    properties['salesforce.contact.description_length'] = String(description.length);
  }
}

function applyOpportunitySemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: SalesforceRecord,
): void {
  const opportunity = payload as Partial<SalesforceOpportunity> & SalesforceRecord;

  addStringProperty(properties, 'salesforce.opportunity.name', opportunity.Name);
  addStringProperty(properties, 'salesforce.opportunity.stage', opportunity.StageName);
  addStringProperty(properties, 'salesforce.opportunity.type', opportunity.Type);
  addStringProperty(properties, 'salesforce.opportunity.close_date', opportunity.CloseDate);
  addStringProperty(properties, 'salesforce.opportunity.forecast_category', opportunity.ForecastCategory);
  addStringProperty(properties, 'salesforce.opportunity.lead_source', opportunity.LeadSource);
  addStringProperty(properties, 'salesforce.opportunity.next_step', opportunity.NextStep);
  addBooleanProperty(properties, 'salesforce.opportunity.is_closed', opportunity.IsClosed);
  addBooleanProperty(properties, 'salesforce.opportunity.is_won', opportunity.IsWon);
  addNumberProperty(properties, 'salesforce.opportunity.amount', opportunity.Amount);
  addNumberProperty(properties, 'salesforce.opportunity.expected_revenue', opportunity.ExpectedRevenue);
  addNumberProperty(properties, 'salesforce.opportunity.probability', opportunity.Probability);
  addNumberProperty(properties, 'salesforce.opportunity.fiscal_quarter', opportunity.FiscalQuarter);
  addNumberProperty(properties, 'salesforce.opportunity.fiscal_year', opportunity.FiscalYear);

  const accountId = asString(opportunity.AccountId) ?? asString(opportunity.Account?.Id);
  if (accountId) {
    relations.add(salesforceAccountPath(accountId));
    addStringProperty(properties, 'salesforce.opportunity.account_id', accountId);
  }
  addStringProperty(properties, 'salesforce.opportunity.account_name', opportunity.Account?.Name);

  const description = asString(opportunity.Description);
  if (description) {
    comments.push(description);
    properties['salesforce.opportunity.description_length'] = String(description.length);
  }
}

function applyLeadSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: SalesforceRecord,
): void {
  const lead = payload as Partial<SalesforceLead> & SalesforceRecord;

  addStringProperty(properties, 'salesforce.lead.name', lead.Name);
  addStringProperty(properties, 'salesforce.lead.first_name', lead.FirstName);
  addStringProperty(properties, 'salesforce.lead.last_name', lead.LastName);
  addStringProperty(properties, 'salesforce.lead.company', lead.Company);
  addStringProperty(properties, 'salesforce.lead.title', lead.Title);
  addStringProperty(properties, 'salesforce.lead.status', lead.Status);
  addStringProperty(properties, 'salesforce.lead.rating', lead.Rating);
  addStringProperty(properties, 'salesforce.lead.industry', lead.Industry);
  addStringProperty(properties, 'salesforce.lead.email', lead.Email);
  addStringProperty(properties, 'salesforce.lead.phone', lead.Phone);
  addStringProperty(properties, 'salesforce.lead.mobile_phone', lead.MobilePhone);
  addStringProperty(properties, 'salesforce.lead.website', lead.Website);
  addStringProperty(properties, 'salesforce.lead.lead_source', lead.LeadSource);
  addStringProperty(properties, 'salesforce.lead.converted_date', lead.ConvertedDate);
  addBooleanProperty(properties, 'salesforce.lead.is_converted', lead.IsConverted);
  addNumberProperty(properties, 'salesforce.lead.annual_revenue', lead.AnnualRevenue);
  addNumberProperty(properties, 'salesforce.lead.employee_count', lead.NumberOfEmployees);

  addAddressProperties(properties, 'salesforce.lead.address', {
    street: lead.Street,
    city: lead.City,
    state: lead.State,
    postalCode: lead.PostalCode,
    country: lead.Country,
  });

  addConvertedRelation(properties, relations, 'salesforce.lead.converted_account_id', lead.ConvertedAccountId, salesforceAccountPath);
  addConvertedRelation(properties, relations, 'salesforce.lead.converted_contact_id', lead.ConvertedContactId, salesforceContactPath);
  addConvertedRelation(
    properties,
    relations,
    'salesforce.lead.converted_opportunity_id',
    lead.ConvertedOpportunityId,
    salesforceOpportunityPath,
  );

  const description = asString(lead.Description);
  if (description) {
    comments.push(description);
    properties['salesforce.lead.description_length'] = String(description.length);
  }
}

function applyCaseSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: SalesforceRecord,
): void {
  const salesforceCase = payload as Partial<SalesforceCase> & SalesforceRecord;

  addStringProperty(properties, 'salesforce.case.number', salesforceCase.CaseNumber);
  addStringProperty(properties, 'salesforce.case.subject', salesforceCase.Subject);
  addStringProperty(properties, 'salesforce.case.status', salesforceCase.Status);
  addStringProperty(properties, 'salesforce.case.priority', salesforceCase.Priority);
  addStringProperty(properties, 'salesforce.case.origin', salesforceCase.Origin);
  addStringProperty(properties, 'salesforce.case.reason', salesforceCase.Reason);
  addStringProperty(properties, 'salesforce.case.type', salesforceCase.Type);
  addStringProperty(properties, 'salesforce.case.closed_at', salesforceCase.ClosedDate);
  addStringProperty(properties, 'salesforce.case.supplied_name', salesforceCase.SuppliedName);
  addStringProperty(properties, 'salesforce.case.supplied_email', salesforceCase.SuppliedEmail);
  addStringProperty(properties, 'salesforce.case.supplied_company', salesforceCase.SuppliedCompany);
  addBooleanProperty(properties, 'salesforce.case.is_closed', salesforceCase.IsClosed);

  const accountId = asString(salesforceCase.AccountId) ?? asString(salesforceCase.Account?.Id);
  if (accountId) {
    relations.add(salesforceAccountPath(accountId));
    addStringProperty(properties, 'salesforce.case.account_id', accountId);
  }
  addStringProperty(properties, 'salesforce.case.account_name', salesforceCase.Account?.Name);

  const contactId = asString(salesforceCase.ContactId) ?? asString(salesforceCase.Contact?.Id);
  if (contactId) {
    relations.add(salesforceContactPath(contactId));
    addStringProperty(properties, 'salesforce.case.contact_id', contactId);
  }
  addStringProperty(properties, 'salesforce.case.contact_name', salesforceCase.Contact?.Name);
  addStringProperty(properties, 'salesforce.case.contact_email', salesforceCase.Contact?.Email);

  const description = asString(salesforceCase.Description);
  if (description) {
    comments.push(description);
    properties['salesforce.case.description_length'] = String(description.length);
  }
}

function addAddressProperties(
  properties: Record<string, string>,
  prefix: string,
  address: {
    city?: unknown;
    country?: unknown;
    postalCode?: unknown;
    state?: unknown;
    street?: unknown;
  },
): void {
  addStringProperty(properties, `${prefix}_street`, address.street);
  addStringProperty(properties, `${prefix}_city`, address.city);
  addStringProperty(properties, `${prefix}_state`, address.state);
  addStringProperty(properties, `${prefix}_postal_code`, address.postalCode);
  addStringProperty(properties, `${prefix}_country`, address.country);
}

function addConvertedRelation(
  properties: Record<string, string>,
  relations: Set<string>,
  property: string,
  id: unknown,
  toPath: (id: string) => string,
): void {
  const normalizedId = asString(id);
  if (!normalizedId) {
    return;
  }
  properties[property] = normalizedId;
  relations.add(toPath(normalizedId));
}

function mergeSalesforcePayload(
  event: SalesforceWebhookPayload,
  objectType: SalesforceObjectType,
  objectId: string,
  action: string,
): Record<string, unknown> {
  const data = getRecord(event.data) ?? {};
  return {
    ...data,
    _webhook: compactObject<SalesforceWebhookEnvelope>({
      action,
      createdAt: asString(event.createdAt),
      objectId,
      objectType,
      organizationId: asString(event.organizationId),
      timestamp: readTimestamp(event.timestamp),
      webhookId: asString(event.webhookId),
    }),
  };
}

function mergeFetchedPayload(
  fetched: Record<string, unknown>,
  webhookPayload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...fetched,
    ...pickWebhookMetadata(webhookPayload),
  };
}

function mergeFallbackPayload(
  existingPayload: Record<string, unknown> | undefined,
  webhookPayload: Record<string, unknown>,
): Record<string, unknown> {
  // Strip stale _webhook from the existing payload so the current event's
  // metadata wins and inferWriteCounts never reads a previous action.
  const { _webhook: _discarded, ...existingWithoutWebhook } = existingPayload ?? {};
  return {
    ...existingWithoutWebhook,
    ...webhookPayload,
  };
}

function pickWebhookMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (isRecord(payload._connection)) {
    metadata._connection = payload._connection;
  }
  if (isRecord(payload._webhook)) {
    metadata._webhook = payload._webhook;
  }
  return metadata;
}

function readProviderConfigKey(payload: Record<string, unknown>): string | undefined {
  const connection = getRecord(payload._connection);
  return asString(connection?.providerConfigKey) ?? asString(connection?.provider_config_key);
}

function inferWriteCounts(
  event: NormalizedWebhook,
  writeResult: WriteFileResult | void,
  deleted: boolean,
): Pick<IngestResult, 'filesDeleted' | 'filesUpdated' | 'filesWritten'> {
  if (deleted) {
    if (writeResult?.status === 'created' || writeResult?.created) {
      return { filesWritten: 1, filesUpdated: 0, filesDeleted: 0 };
    }
    return { filesWritten: 0, filesUpdated: 1, filesDeleted: 0 };
  }

  if (writeResult?.created || writeResult?.status === 'created') {
    return { filesWritten: 1, filesUpdated: 0, filesDeleted: 0 };
  }

  if (writeResult?.updated || writeResult?.status === 'updated') {
    return { filesWritten: 0, filesUpdated: 1, filesDeleted: 0 };
  }

  const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
  if (action === 'created') {
    return { filesWritten: 1, filesUpdated: 0, filesDeleted: 0 };
  }

  return { filesWritten: 0, filesUpdated: 1, filesDeleted: 0 };
}

function getWebhookAction(payload: Record<string, unknown>): string | undefined {
  return asString(getRecord(payload._webhook)?.action)?.toLowerCase();
}

function getEventAction(eventType: string): string | undefined {
  const separatorIndex = eventType.lastIndexOf('.');
  if (separatorIndex === -1 || separatorIndex === eventType.length - 1) {
    return undefined;
  }
  return eventType.slice(separatorIndex + 1).toLowerCase();
}

function inferFallbackPath(event: NormalizedWebhook | SalesforceWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeSalesforcePath(event.objectType, event.objectId);
    }

    const objectId = extractPayloadId(event.data) ?? asString(event.objectId);
    if (!objectId) {
      return '';
    }
    return computeSalesforcePath(readWebhookType(event), objectId);
  } catch {
    return '';
  }
}

function readWebhookType(event: SalesforceWebhookPayload): string {
  const type = asString(event.objectType) ?? asString(event.type) ?? inferObjectTypeFromPayload(event.data);
  if (!type) {
    throw new Error('Salesforce webhook payload is missing object type metadata');
  }
  return type;
}

function inferObjectTypeFromPayload(data: SalesforcePrimaryObject | Record<string, unknown>): string | undefined {
  const record = getRecord(data);
  const attributes = getRecord(record?.attributes);
  return asString(attributes?.type);
}

function extractPayloadId(value: unknown): string | undefined {
  const record = getRecord(value);
  return asString(record?.Id) ?? asString(record?.id);
}

function isNormalizedWebhook(event: NormalizedWebhook | SalesforceWebhookPayload): event is NormalizedWebhook {
  return (
    isRecord(event) &&
    typeof event.eventType === 'string' &&
    typeof event.objectType === 'string' &&
    typeof event.objectId === 'string' &&
    isRecord(event.payload)
  );
}

function canonicalizeEventType(eventType: string, objectType: string): string {
  const normalizedObjectType = normalizeSalesforceObjectType(objectType);
  const normalized = eventType.trim();
  if (!normalized) {
    return `${normalizedObjectType}.updated`;
  }
  if (!normalized.includes('.')) {
    return `${normalizedObjectType}.${normalizeAction(normalized)}`;
  }
  const [rawType, rawAction] = normalized.split('.', 2);
  const type = rawType ? normalizeSalesforceObjectType(rawType) : normalizedObjectType;
  return `${type}.${normalizeAction(rawAction ?? 'updated')}`;
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'create':
    case 'created':
    case 'insert':
    case 'inserted':
      return 'created';
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'removed':
      return 'deleted';
    case 'upsert':
    case 'upserted':
      return 'upserted';
    case 'update':
    case 'updated':
    default:
      return normalized || 'updated';
  }
}

function addStringProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const normalized = asString(value);
  if (normalized) {
    properties[key] = normalized;
  }
}

function addFirstStringProperty(
  properties: Record<string, string>,
  key: string,
  ...values: unknown[]
): void {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      properties[key] = normalized;
      return;
    }
  }
}

function addNumberProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const normalized = asNumber(value);
  if (normalized !== undefined) {
    properties[key] = String(normalized);
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
  if (semantics.comments && semantics.comments.length > 0) {
    compacted.comments = semantics.comments;
  }

  return compacted;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}

function sortStrings(values: Set<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (isRecord(value)) {
    const sortedEntries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)] as const);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    const dateMs = Date.parse(trimmed);
    return Number.isFinite(dateMs) ? dateMs : undefined;
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
