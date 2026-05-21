import {
  IndexFileReconciler,
  runEmitBatch,
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitDelete,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import {
  HUBSPOT_PATH_ROOT,
  encodeHubSpotPathSegment,
  hubSpotCompanyPath,
  hubSpotContactPath,
  hubSpotDealPath,
  hubSpotTicketPath,
} from './path-mapper.js';
import type {
  HubSpotCompany,
  HubSpotContact,
  HubSpotCrmObject,
  HubSpotDeal,
  HubSpotObjectType,
  HubSpotTicket,
} from './types.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;
const HUBSPOT_PROVIDER_NAME = 'hubspot';

export type HubSpotEmitRecord<T> = T | { id: string; _deleted: true };

export interface EmitHubSpotAuxiliaryFilesInput {
  workspaceId: string;
  records: {
    contacts?: readonly HubSpotEmitRecord<HubSpotContact>[];
    companies?: readonly HubSpotEmitRecord<HubSpotCompany>[];
    deals?: readonly HubSpotEmitRecord<HubSpotDeal>[];
    tickets?: readonly HubSpotEmitRecord<HubSpotTicket>[];
  };
}

interface HubSpotIndexRow {
  id: string;
  title: string;
  updated: string;
  archived?: boolean;
}

interface HubSpotResourceConfig<TRecord extends HubSpotCrmObject> {
  objectType: HubSpotObjectType;
  plural: 'contacts' | 'companies' | 'deals' | 'tickets';
  title: string;
  canonicalPath: (id: string) => string;
}

const RESOURCE_CONFIGS = [
  {
    objectType: 'contact',
    plural: 'contacts',
    title: 'Contacts',
    canonicalPath: hubSpotContactPath,
  },
  {
    objectType: 'company',
    plural: 'companies',
    title: 'Companies',
    canonicalPath: hubSpotCompanyPath,
  },
  {
    objectType: 'deal',
    plural: 'deals',
    title: 'Deals',
    canonicalPath: hubSpotDealPath,
  },
  {
    objectType: 'ticket',
    plural: 'tickets',
    title: 'Tickets',
    canonicalPath: hubSpotTicketPath,
  },
] as const satisfies readonly HubSpotResourceConfig<HubSpotCrmObject>[];

export async function emitHubSpotAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  args: EmitHubSpotAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  await writeRootIndex(client, args.workspaceId, aggregate);

  const { records } = args;
  if (records.contacts && records.contacts.length > 0) {
    accumulate(aggregate, await emitResource(client, args.workspaceId, CONTACTS, records.contacts));
  }
  if (records.companies && records.companies.length > 0) {
    accumulate(aggregate, await emitResource(client, args.workspaceId, COMPANIES, records.companies));
  }
  if (records.deals && records.deals.length > 0) {
    accumulate(aggregate, await emitResource(client, args.workspaceId, DEALS, records.deals));
  }
  if (records.tickets && records.tickets.length > 0) {
    accumulate(aggregate, await emitResource(client, args.workspaceId, TICKETS, records.tickets));
  }

  return aggregate;
}

const CONTACTS = RESOURCE_CONFIGS[0];
const COMPANIES = RESOURCE_CONFIGS[1];
const DEALS = RESOURCE_CONFIGS[2];
const TICKETS = RESOURCE_CONFIGS[3];

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const path = `${HUBSPOT_PATH_ROOT}/_index.json`;
  const rows = RESOURCE_CONFIGS.map((resource) => ({
    id: resource.plural,
    title: resource.title,
  }));

  try {
    await client.writeFile({
      workspaceId,
      path,
      content: `${JSON.stringify(rows)}\n`,
      contentType: JSON_CONTENT_TYPE,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: error instanceof Error ? error.message : String(error) });
  }
}

async function emitResource<TRecord extends HubSpotCrmObject>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  resource: HubSpotResourceConfig<TRecord>,
  records: readonly HubSpotEmitRecord<TRecord>[],
): Promise<EmitAuxiliaryFilesResult> {
  const indexPath = hubSpotIndexPath(resource.plural);
  const indexReconciler = new IndexFileReconciler<HubSpotIndexRow>({
    client,
    workspaceId,
    path: indexPath,
    builder: (rows) => ({
      path: indexPath,
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });
  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planDelete(record.id, resource, indexReconciler);
    }
    return planWrite(record, resource, indexReconciler);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

async function planWrite<TRecord extends HubSpotCrmObject>(
  record: TRecord,
  resource: HubSpotResourceConfig<TRecord>,
  indexReconciler: IndexFileReconciler<HubSpotIndexRow>,
): Promise<EmitPlan> {
  const id = readNonEmptyString(record.id);
  if (!id) return {};

  const content = renderObjectContent(resource.objectType, id, record);
  const paths = hubSpotPathsFor(resource, id);
  const writes: EmitWrite[] = paths.map((path) => ({ path, content, contentType: JSON_CONTENT_TYPE }));

  indexReconciler.upsert(buildIndexRow(id, record, resource.objectType));
  return { writes };
}

async function planDelete<TRecord extends HubSpotCrmObject>(
  id: string,
  resource: HubSpotResourceConfig<TRecord>,
  indexReconciler: IndexFileReconciler<HubSpotIndexRow>,
): Promise<EmitPlan> {
  const normalizedId = readNonEmptyString(id);
  if (!normalizedId) return {};

  indexReconciler.remove(normalizedId);
  const deletes: EmitDelete[] = hubSpotPathsFor(resource, normalizedId).map((path) => ({ path }));
  return { deletes };
}

function hubSpotPathsFor<TRecord extends HubSpotCrmObject>(
  resource: HubSpotResourceConfig<TRecord>,
  id: string,
): string[] {
  return [resource.canonicalPath(id), byIdAliasPath(resource.plural, id)];
}

function byIdAliasPath(plural: HubSpotResourceConfig<HubSpotCrmObject>['plural'], id: string): string {
  return `${HUBSPOT_PATH_ROOT}/${plural}/by-id/${encodeHubSpotPathSegment(id)}.json`;
}

function hubSpotIndexPath(plural: HubSpotResourceConfig<HubSpotCrmObject>['plural']): string {
  return `${HUBSPOT_PATH_ROOT}/${plural}/_index.json`;
}

function renderObjectContent<TRecord extends HubSpotCrmObject>(
  objectType: HubSpotObjectType,
  id: string,
  record: TRecord,
): string {
  return JSON.stringify(
    {
      provider: HUBSPOT_PROVIDER_NAME,
      objectType,
      objectId: id,
      deleted: false,
      ...renderLifecycleFields(objectType, record),
      payload: record,
    },
    null,
    2,
  );
}

function renderLifecycleFields(
  objectType: HubSpotObjectType,
  record: HubSpotCrmObject,
): { archived?: boolean; status?: string } {
  const lifecycle: { archived?: boolean; status?: string } = {};
  if (typeof record.archived === 'boolean') {
    lifecycle.archived = record.archived;
  }

  const directStatus = readNonEmptyString((record as unknown as Record<string, unknown>).status);
  const status =
    directStatus ??
    (objectType === 'deal' ? readNonEmptyString(record.properties?.dealstage) : undefined) ??
    (objectType === 'ticket' ? readNonEmptyString(record.properties?.hs_pipeline_stage) : undefined);
  if (status) {
    lifecycle.status = status;
  }

  return lifecycle;
}

function buildIndexRow(
  id: string,
  record: HubSpotCrmObject,
  objectType: HubSpotObjectType,
): HubSpotIndexRow {
  return {
    id,
    title: buildIndexTitle(id, record, objectType),
    updated: normalizeUpdated(
      record.updatedAt,
      record.properties?.lastmodifieddate,
      record.properties?.hs_lastmodifieddate,
      record.createdAt,
      record.properties?.createdate,
    ),
    ...(typeof record.archived === 'boolean' ? { archived: record.archived } : {}),
  };
}

// AGENTS.md requires _index.json rows to carry { id, title, updated } at
// minimum. HubSpot ids are stable numeric strings, but each object type has a
// human-readable name in its properties that should populate `title`:
//   contact  → "<firstname> <lastname>", else email, else id
//   company  → name, else domain, else id
//   deal     → dealname, else id
//   ticket   → subject, else id
// The bare id is the last-resort fallback so the row contract is never empty.
function buildIndexTitle(
  id: string,
  record: HubSpotCrmObject,
  objectType: HubSpotObjectType,
): string {
  const properties = record.properties ?? {};
  switch (objectType) {
    case 'contact': {
      const first = readNonEmptyString(properties.firstname);
      const last = readNonEmptyString(properties.lastname);
      const composed = [first, last].filter((part): part is string => Boolean(part)).join(' ').trim();
      return composed || readNonEmptyString(properties.email) || id;
    }
    case 'company':
      return (
        readNonEmptyString(properties.name) ??
        readNonEmptyString(properties.domain) ??
        id
      );
    case 'deal':
      return readNonEmptyString(properties.dealname) ?? id;
    case 'ticket':
      return readNonEmptyString(properties.subject) ?? id;
  }
}

function compareIndexRows(left: HubSpotIndexRow, right: HubSpotIndexRow): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function normalizeUpdated(...values: unknown[]): string {
  for (const value of values) {
    const stringValue = readNonEmptyString(value);
    if (stringValue) return stringValue;
  }
  return '';
}

function isDeleteRecord<TRecord>(
  record: HubSpotEmitRecord<TRecord>,
): record is { id: string; _deleted: true } {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    typeof (record as { id?: unknown }).id === 'string'
  );
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function accumulate(aggregate: EmitAuxiliaryFilesResult, partial: EmitAuxiliaryFilesResult): void {
  aggregate.written += partial.written;
  aggregate.deleted += partial.deleted;
  if (partial.errors.length > 0) {
    aggregate.errors.push(...partial.errors);
  }
}
