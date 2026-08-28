import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from '@relayfile/adapter-core';

import { buildRampIndexFile, buildRampRootIndexFile, type RampIndexBucket } from './index-emitter.js';
import { rampLayoutPromptFile } from './layout-prompt.js';
import { parseRampCanonicalPath, rampByIdAliasPath, rampIndexPath, rampResourceRoot } from './path-mapper.js';
import {
  buildRampAliasPointer,
  compareRampIndexRows,
  rampAliasPaths,
  rampIndexRow,
} from './queries.js';
import type {
  RampAccountingAccountRecord,
  RampAccountingFieldRecord,
  RampBaseRecord,
  RampBillRecord,
  RampCanonicalResource,
  RampDeleteRecord,
  RampDimensionRecord,
  RampIndexRow,
  RampItemReceiptRecord,
  RampPurchaseOrderRecord,
  RampRepaymentRecord,
  RampReceiptRecord,
  RampReimbursementRecord,
  RampTransferRecord,
  RampTransactionRecord,
  RampVendorAgreementRecord,
  RampVendorRecord,
} from './types.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export interface EmitRampAuxiliaryFilesInput {
  workspaceId: string;
  bills?: readonly (RampBillRecord | RampDeleteRecord)[];
  purchaseOrders?: readonly (RampPurchaseOrderRecord | RampDeleteRecord)[];
  itemReceipts?: readonly (RampItemReceiptRecord | RampDeleteRecord)[];
  vendorAgreements?: readonly (RampVendorAgreementRecord | RampDeleteRecord)[];
  transactions?: readonly (RampTransactionRecord | RampDeleteRecord)[];
  reimbursements?: readonly (RampReimbursementRecord | RampDeleteRecord)[];
  receipts?: readonly (RampReceiptRecord | RampDeleteRecord)[];
  vendors?: readonly (RampVendorRecord | RampDeleteRecord)[];
  transfers?: readonly (RampTransferRecord | RampDeleteRecord)[];
  repayments?: readonly (RampRepaymentRecord | RampDeleteRecord)[];
  dimensionEntities?: readonly (RampDimensionRecord | RampDeleteRecord)[];
  dimensionUsers?: readonly (RampDimensionRecord | RampDeleteRecord)[];
  dimensionDepartments?: readonly (RampDimensionRecord | RampDeleteRecord)[];
  dimensionLocations?: readonly (RampDimensionRecord | RampDeleteRecord)[];
  dimensionMerchants?: readonly (RampDimensionRecord | RampDeleteRecord)[];
  dimensionSpendPrograms?: readonly (RampDimensionRecord | RampDeleteRecord)[];
  accountingAccounts?: readonly (RampAccountingAccountRecord | RampDeleteRecord)[];
  accountingFields?: readonly (RampAccountingFieldRecord | RampDeleteRecord)[];
  connectionId?: string;
}

export async function emitRampAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitRampAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await writeStaticFiles(client, input.workspaceId, aggregate);

  await emitResource(client, input.workspaceId, aggregate, 'bills', input.bills, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'purchase-orders', input.purchaseOrders, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'item-receipts', input.itemReceipts, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'vendor-agreements', input.vendorAgreements, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'transactions', input.transactions, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'reimbursements', input.reimbursements, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'receipts', input.receipts, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'vendors', input.vendors, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'transfers', input.transfers, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'repayments', input.repayments, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/entities', input.dimensionEntities, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/users', input.dimensionUsers, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/departments', input.dimensionDepartments, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/locations', input.dimensionLocations, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/merchants', input.dimensionMerchants, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/spend-programs', input.dimensionSpendPrograms, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'accounting/accounts', input.accountingAccounts, input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'accounting/fields', input.accountingFields, input.connectionId);

  return aggregate;
}

async function writeStaticFiles(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  for (const file of [buildRampRootIndexFile(), rampLayoutPromptFile()]) {
    await safeWrite(client, workspaceId, file.path, file.content, aggregate, file.contentType);
  }
}

async function emitResource(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
  resource: RampCanonicalResource,
  records: readonly (RampBaseRecord | RampDeleteRecord)[] | undefined,
  connectionId?: string,
): Promise<void> {
  if (records === undefined) {
    return;
  }

  const indexPath = rampIndexPath(resource);
  const currentRows = await readIndexRows(client, workspaceId, indexPath, aggregate);
  if (!currentRows.available) {
    aggregate.errors.push({
      path: indexPath,
      error: 'Skipped Ramp resource mutation because the existing index could not be read safely',
    });
    return;
  }
  const rowMap = new Map(currentRows.rows.map((row) => [row.id, row]));

  for (const record of records) {
    const id = readId(record.id);
    if (!id) continue;

    const previousPointer = await readPreviousPointer(client, workspaceId, resource, id, aggregate);

    if (isDeleteRecord(record)) {
      rowMap.delete(id);

      const deletePaths = new Set<string>([rampByIdAliasPath(resource, id)]);
      const previousCanonicalPath = safePriorCanonicalPath(previousPointer?.canonicalPath, resource, id, aggregate);
      if (previousCanonicalPath) {
        deletePaths.add(previousCanonicalPath);
      }
      for (const aliasPath of safePriorAliasPaths(previousPointer?.aliasPaths ?? [], resource)) {
        deletePaths.add(aliasPath);
      }
      for (const path of deletePaths) {
        await safeDelete(client, workspaceId, path, aggregate);
      }
      continue;
    }

    const row = rampIndexRow(resource, record);
    rowMap.set(row.id, row);
    const aliasPaths = rampAliasPaths(resource, record, row);
    const pointer = buildRampAliasPointer(resource, record, row, aliasPaths, connectionId);
    const content = `${JSON.stringify(pointer, null, 2)}\n`;
    const nextAliasSet = new Set(aliasPaths);

    if (previousPointer) {
      const previousCanonicalPath = safePriorCanonicalPath(previousPointer.canonicalPath, resource, id, aggregate);
      if (previousCanonicalPath && previousCanonicalPath !== row.canonicalPath) {
        await safeDelete(client, workspaceId, previousCanonicalPath, aggregate);
      }
      for (const aliasPath of safePriorAliasPaths(previousPointer.aliasPaths, resource)) {
        if (!nextAliasSet.has(aliasPath)) {
          await safeDelete(client, workspaceId, aliasPath, aggregate);
        }
      }
    }

    for (const aliasPath of aliasPaths) {
      await safeWrite(client, workspaceId, aliasPath, content, aggregate);
    }
  }

  const indexFile = buildRampIndexFile(resource as RampIndexBucket, [...rowMap.values()].sort(compareRampIndexRows));
  await safeWrite(client, workspaceId, indexFile.path, indexFile.content, aggregate);
}

async function readPreviousPointer(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  resource: RampCanonicalResource,
  id: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<{ aliasPaths: string[]; canonicalPath?: string } | null> {
  if (!client.readFile) {
    return null;
  }
  try {
    const response = await client.readFile({
      workspaceId,
      path: rampByIdAliasPath(resource, id),
    });
    if (!response?.content) {
      return null;
    }
    const parsed = JSON.parse(response.content) as {
      aliasPaths?: unknown;
      canonicalPath?: unknown;
    };
    const aliasPaths = Array.isArray(parsed.aliasPaths)
      ? parsed.aliasPaths.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const canonicalPath = typeof parsed.canonicalPath === 'string' && parsed.canonicalPath.length > 0
      ? parsed.canonicalPath
      : undefined;
    if (aliasPaths.length === 0 && !canonicalPath) {
      return null;
    }
    return { aliasPaths, ...(canonicalPath ? { canonicalPath } : {}) };
  } catch (error) {
    aggregate.errors.push({
      path: rampByIdAliasPath(resource, id),
      error: stringifyError(error),
    });
    return null;
  }
}

async function readIndexRows(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<{ rows: RampIndexRow[]; available: boolean }> {
  if (!client.readFile) {
    aggregate.errors.push({ path, error: 'readFile not supported by client' });
    return { rows: [], available: false };
  }
  try {
    const response = await client.readFile({ workspaceId, path });
    if (!response?.content) {
      return { rows: [], available: true };
    }
    const parsed = JSON.parse(response.content) as unknown;
    if (!Array.isArray(parsed)) {
      aggregate.errors.push({ path, error: 'Ramp index content was not a JSON array' });
      return { rows: [], available: false };
    }
    return {
      rows: parsed.filter(isRampIndexRow),
      available: true,
    };
  } catch (error) {
    aggregate.errors.push({ path, error: stringifyError(error) });
    return { rows: [], available: false };
  }
}

async function safeWrite(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  content: string,
  aggregate: EmitAuxiliaryFilesResult,
  contentType = JSON_CONTENT_TYPE,
): Promise<void> {
  try {
    await client.writeFile({
      workspaceId,
      path,
      content,
      contentType,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: stringifyError(error) });
  }
}

async function safeDelete(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (!client.deleteFile) {
    aggregate.errors.push({ path, error: 'deleteFile not supported by client' });
    return;
  }
  try {
    await client.deleteFile({ workspaceId, path });
    aggregate.deleted += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: stringifyError(error) });
  }
}

function readId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function isDeleteRecord(record: RampBaseRecord | RampDeleteRecord): record is RampDeleteRecord {
  return '_deleted' in record && record._deleted === true;
}

function isRampIndexRow(value: unknown): value is RampIndexRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && typeof row.title === 'string'
    && typeof row.updated === 'string'
    && typeof row.canonicalPath === 'string';
}

function safePriorCanonicalPath(
  path: string | undefined,
  resource: RampCanonicalResource,
  id: string,
  aggregate: EmitAuxiliaryFilesResult,
): string | undefined {
  if (!path) {
    return undefined;
  }
  const parsed = parseRampCanonicalPath(path);
  if (parsed?.resource === resource && parsed.id === id) {
    return path;
  }
  aggregate.errors.push({
    path,
    error: `Skipped unsafe Ramp canonicalPath cleanup for ${resource} ${id}`,
  });
  return undefined;
}

function safePriorAliasPaths(paths: readonly string[], resource: RampCanonicalResource): string[] {
  const prefix = `${rampResourceRoot(resource)}/`;
  return paths.filter((path) => path.startsWith(prefix) && path.endsWith('.json'));
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
