import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from '@relayfile/adapter-core';

import { buildRampIndexFile, buildRampRootIndexFile, type RampIndexBucket } from './index-emitter.js';
import { rampLayoutPromptFile } from './layout-prompt.js';
import {
  parseFlatNameWithId,
  parseRampCanonicalPath,
  rampByIdAliasPath,
  rampIndexPath,
  rampResourceRoot,
} from './path-mapper.js';
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

type PreviousPointer = { aliasPaths: string[]; canonicalPath?: string; cleanupPaths?: string[] };
type PreviousPointerReadResult =
  | { available: true; pointer: PreviousPointer | null }
  | { available: false };

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
  const canReconcile = currentRows.available;
  if (!canReconcile) {
    aggregate.errors.push({
      path: indexPath,
      error: 'Skipped Ramp index reconciliation because the existing index could not be read safely; continuing additive alias writes only',
    });
  }
  const rowMap = new Map(canReconcile ? currentRows.rows.map((row) => [row.id, row]) : []);

  for (const record of records) {
    const id = readId(record.id);
    if (!id) continue;

    const previousPointerResult = await readPreviousPointer(client, workspaceId, resource, id, aggregate);
    if (!previousPointerResult.available) {
      aggregate.errors.push({
        path: rampByIdAliasPath(resource, id),
        error: `Skipped Ramp record mutation for ${resource} ${id} because the prior pointer could not be read safely`,
      });
      continue;
    }
    const previousPointer = previousPointerResult.pointer;

    if (isDeleteRecord(record)) {
      if (!canReconcile) {
        continue;
      }
      rowMap.delete(id);

      const deletePaths = new Set<string>([rampByIdAliasPath(resource, id)]);
      const previousCanonicalPath = safePriorCanonicalPath(previousPointer?.canonicalPath, resource, id, aggregate);
      if (previousCanonicalPath) {
        deletePaths.add(previousCanonicalPath);
      }
      for (const aliasPath of safePriorAliasPaths(previousPointer?.aliasPaths ?? [], resource, id, aggregate)) {
        deletePaths.add(aliasPath);
      }
      for (const cleanupPath of safePriorCleanupPaths(previousPointer?.cleanupPaths ?? [], resource, id, aggregate)) {
        deletePaths.add(cleanupPath);
      }
      for (const path of deletePaths) {
        await safeDelete(client, workspaceId, path, aggregate);
      }
      continue;
    }

    const row = rampIndexRow(resource, record);
    if (canReconcile) {
      rowMap.set(row.id, row);
    }
    const aliasPaths = rampAliasPaths(resource, record, row);
    const nextAliasSet = new Set(aliasPaths);
    const cleanupPaths = canReconcile
      ? undefined
      : retainedCleanupPaths(previousPointer, resource, id, row.canonicalPath, nextAliasSet, aggregate);
    const pointer = buildRampAliasPointer(resource, record, row, aliasPaths, connectionId, cleanupPaths);
    const content = `${JSON.stringify(pointer, null, 2)}\n`;

    if (canReconcile && previousPointer) {
      const stalePaths = new Set<string>();
      const previousCanonicalPath = safePriorCanonicalPath(previousPointer.canonicalPath, resource, id, aggregate);
      if (previousCanonicalPath && previousCanonicalPath !== row.canonicalPath) {
        stalePaths.add(previousCanonicalPath);
      }
      for (const aliasPath of safePriorAliasPaths(previousPointer.aliasPaths, resource, id, aggregate)) {
        if (!nextAliasSet.has(aliasPath)) {
          stalePaths.add(aliasPath);
        }
      }
      for (const cleanupPath of safePriorCleanupPaths(previousPointer.cleanupPaths ?? [], resource, id, aggregate)) {
        if (cleanupPath !== row.canonicalPath && !nextAliasSet.has(cleanupPath)) {
          stalePaths.add(cleanupPath);
        }
      }
      for (const path of stalePaths) {
        await safeDelete(client, workspaceId, path, aggregate);
      }
    }

    for (const aliasPath of aliasPaths) {
      await safeWrite(client, workspaceId, aliasPath, content, aggregate);
    }
  }

  if (canReconcile) {
    const indexFile = buildRampIndexFile(resource as RampIndexBucket, [...rowMap.values()].sort(compareRampIndexRows));
    await safeWrite(client, workspaceId, indexFile.path, indexFile.content, aggregate);
  }
}

async function readPreviousPointer(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  resource: RampCanonicalResource,
  id: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<PreviousPointerReadResult> {
  if (!client.readFile) {
    return { available: false };
  }
  try {
    const response = await client.readFile({
      workspaceId,
      path: rampByIdAliasPath(resource, id),
    });
    if (!response?.content) {
      return { available: true, pointer: null };
    }
    const parsed = JSON.parse(response.content) as {
      aliasPaths?: unknown;
      canonicalPath?: unknown;
      cleanupPaths?: unknown;
    };
    const aliasPaths = Array.isArray(parsed.aliasPaths)
      ? parsed.aliasPaths.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const canonicalPath = typeof parsed.canonicalPath === 'string' && parsed.canonicalPath.length > 0
      ? parsed.canonicalPath
      : undefined;
    const cleanupPaths = Array.isArray(parsed.cleanupPaths)
      ? parsed.cleanupPaths.filter((entry): entry is string => typeof entry === 'string')
      : [];
    if (aliasPaths.length === 0 && cleanupPaths.length === 0 && !canonicalPath) {
      return { available: true, pointer: null };
    }
    return {
      available: true,
      pointer: {
        aliasPaths,
        ...(canonicalPath ? { canonicalPath } : {}),
        ...(cleanupPaths.length > 0 ? { cleanupPaths } : {}),
      },
    };
  } catch (error) {
    aggregate.errors.push({
      path: rampByIdAliasPath(resource, id),
      error: stringifyError(error),
    });
    return { available: false };
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
  const safePath = readSafePriorCanonicalPath(path, resource, id);
  if (safePath) {
    return safePath;
  }
  aggregate.errors.push({
    path,
    error: `Skipped unsafe Ramp canonicalPath cleanup for ${resource} ${id}`,
  });
  return undefined;
}

function safePriorAliasPaths(
  paths: readonly string[],
  resource: RampCanonicalResource,
  id: string,
  aggregate: EmitAuxiliaryFilesResult,
): string[] {
  const safePaths: string[] = [];
  for (const path of paths) {
    const safePath = readSafePriorAliasPath(path, resource, id);
    if (!safePath) {
      aggregate.errors.push({
        path,
        error: `Skipped unsafe Ramp aliasPath cleanup for ${resource} ${id}`,
      });
      continue;
    }
    safePaths.push(safePath);
  }
  return safePaths;
}

function safePriorCleanupPaths(
  paths: readonly string[],
  resource: RampCanonicalResource,
  id: string,
  aggregate: EmitAuxiliaryFilesResult,
): string[] {
  const safePaths: string[] = [];
  for (const path of paths) {
    const safePath = readSafePriorCanonicalPath(path, resource, id) ?? readSafePriorAliasPath(path, resource, id);
    if (!safePath) {
      aggregate.errors.push({
        path,
        error: `Skipped unsafe Ramp cleanupPath for ${resource} ${id}`,
      });
      continue;
    }
    safePaths.push(safePath);
  }
  return safePaths;
}

function retainedCleanupPaths(
  previousPointer: PreviousPointer | null,
  resource: RampCanonicalResource,
  id: string,
  canonicalPath: string,
  nextAliasSet: ReadonlySet<string>,
  aggregate: EmitAuxiliaryFilesResult,
): string[] | undefined {
  if (!previousPointer) {
    return undefined;
  }
  const cleanupPaths = new Set<string>();
  const previousCanonicalPath = safePriorCanonicalPath(previousPointer.canonicalPath, resource, id, aggregate);
  if (previousCanonicalPath && previousCanonicalPath !== canonicalPath) {
    cleanupPaths.add(previousCanonicalPath);
  }
  for (const aliasPath of safePriorAliasPaths(previousPointer.aliasPaths, resource, id, aggregate)) {
    if (!nextAliasSet.has(aliasPath)) {
      cleanupPaths.add(aliasPath);
    }
  }
  for (const cleanupPath of safePriorCleanupPaths(previousPointer.cleanupPaths ?? [], resource, id, aggregate)) {
    if (cleanupPath !== canonicalPath && !nextAliasSet.has(cleanupPath)) {
      cleanupPaths.add(cleanupPath);
    }
  }
  return cleanupPaths.size > 0 ? [...cleanupPaths] : undefined;
}

function readSafePriorCanonicalPath(
  path: string | undefined,
  resource: RampCanonicalResource,
  id: string,
): string | undefined {
  if (!path) {
    return undefined;
  }
  let parsed: ReturnType<typeof parseRampCanonicalPath>;
  try {
    parsed = parseRampCanonicalPath(path);
  } catch {
    parsed = undefined;
  }
  return parsed?.resource === resource && parsed.id === id ? path : undefined;
}

function readSafePriorAliasPath(
  path: string,
  resource: RampCanonicalResource,
  id: string,
): string | undefined {
  const prefix = `${rampResourceRoot(resource)}/`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : '';
  const segments = relative.split('/').filter(Boolean);
  const leaf = segments.at(-1);
  const isAliasPath = Boolean(
    relative
    && path.startsWith(prefix)
    && segments.length >= 2
    && segments[0]?.startsWith('by-')
    && !segments.some((segment) => segment === '.' || segment === '..')
    && leaf
    && leaf !== '_index.json'
    && leaf.endsWith('.json'),
  );
  if (!isAliasPath || !leaf) {
    return undefined;
  }
  try {
    const parsed = parseFlatNameWithId(leaf);
    return parsed.id === id ? path : undefined;
  } catch {
    return undefined;
  }
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
