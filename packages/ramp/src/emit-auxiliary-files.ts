import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from '@relayfile/adapter-core';

import { buildRampIndexFile, buildRampRootIndexFile, type RampIndexBucket } from './index-emitter.js';
import { rampByIdAliasPath, rampIndexPath } from './path-mapper.js';
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
  RampReceiptRecord,
  RampReimbursementRecord,
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
  transfers?: readonly (RampBaseRecord | RampDeleteRecord)[];
  repayments?: readonly (RampBaseRecord | RampDeleteRecord)[];
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
  const rootIndex = buildRampRootIndexFile();

  await safeWrite(client, input.workspaceId, rootIndex.path, rootIndex.content, aggregate);

  await emitResource(client, input.workspaceId, aggregate, 'bills', input.bills ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'purchase-orders', input.purchaseOrders ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'item-receipts', input.itemReceipts ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'vendor-agreements', input.vendorAgreements ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'transactions', input.transactions ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'reimbursements', input.reimbursements ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'receipts', input.receipts ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'vendors', input.vendors ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'transfers', input.transfers ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'repayments', input.repayments ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/entities', input.dimensionEntities ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/users', input.dimensionUsers ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/departments', input.dimensionDepartments ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/locations', input.dimensionLocations ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/merchants', input.dimensionMerchants ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'dimensions/spend-programs', input.dimensionSpendPrograms ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'accounting/accounts', input.accountingAccounts ?? [], input.connectionId);
  await emitResource(client, input.workspaceId, aggregate, 'accounting/fields', input.accountingFields ?? [], input.connectionId);

  return aggregate;
}

async function emitResource(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
  resource: RampCanonicalResource,
  records: readonly (RampBaseRecord | RampDeleteRecord)[],
  connectionId?: string,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const currentRows = await readJsonArray<RampIndexRow>(client, workspaceId, rampIndexPath(resource));
  const rowMap = new Map(currentRows.map((row) => [row.id, row]));

  for (const record of records) {
    const id = readId(record.id);
    if (!id) continue;

    const byIdPath = `${resource}/by-id`;
    void byIdPath;
    const previousPointer = await readPreviousPointer(client, workspaceId, resource, id);

    if (isDeleteRecord(record)) {
      rowMap.delete(id);
      if (previousPointer) {
        for (const aliasPath of previousPointer.aliasPaths) {
          await safeDelete(client, workspaceId, aliasPath, aggregate);
        }
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
      for (const aliasPath of previousPointer.aliasPaths) {
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
): Promise<{ aliasPaths: string[] } | null> {
  if (!client.readFile) {
    return null;
  }
  const response = await client.readFile({
    workspaceId,
    path: rampByIdAliasPath(resource, id),
  });
  if (!response?.content) {
    return null;
  }
  try {
    const parsed = JSON.parse(response.content) as { aliasPaths?: unknown };
    return Array.isArray(parsed.aliasPaths)
      ? { aliasPaths: parsed.aliasPaths.filter((entry): entry is string => typeof entry === 'string') }
      : null;
  } catch {
    return null;
  }
}

async function readJsonArray<T>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<T[]> {
  if (!client.readFile) {
    return [];
  }
  try {
    const response = await client.readFile({ workspaceId, path });
    if (!response?.content) {
      return [];
    }
    const parsed = JSON.parse(response.content) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

async function safeWrite(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  content: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  try {
    await client.writeFile({
      workspaceId,
      path,
      content,
      contentType: JSON_CONTENT_TYPE,
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

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
