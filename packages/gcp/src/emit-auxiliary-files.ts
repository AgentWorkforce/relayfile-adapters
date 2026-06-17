import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from "@relayfile/adapter-core";

import {
  computeGcpPath,
  gcpBillingIndexPath,
  gcpCloudRunServiceByIdAliasPath,
  gcpCloudRunServiceByRegionAliasPath,
  gcpCloudRunServiceByStatusAliasPath,
  gcpCloudRunServicesIndexPath,
  gcpMonitoringAlertByIdAliasPath,
  gcpMonitoringAlertByStateAliasPath,
  gcpMonitoringAlertByTitleAliasPath,
  gcpMonitoringAlertsIndexPath,
  gcpRootIndexPath,
} from "./path-mapper.js";
import { type GcpPathObjectType } from "./types.js";

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

type GcpRecord = Record<string, unknown> & {
  id?: string;
  serviceName?: string;
  policyId?: string;
  billingAccountId?: string;
  displayName?: string;
  region?: string;
  state?: string;
  status?: string;
  ready?: boolean;
  enabled?: boolean;
  firing?: boolean;
  updatedAt?: string;
  updated_at?: string;
  lastModified?: string;
  lastIncidentTs?: string;
  capturedAt?: string;
  _deleted?: true;
};

type IndexRow = {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
} & Record<string, unknown>;

export interface EmitGcpAuxiliaryFilesInput {
  workspaceId: string;
  cloudRunServices?: readonly GcpRecord[];
  monitoringAlerts?: readonly GcpRecord[];
  billing?: readonly GcpRecord[];
  connectionId?: string;
}

export async function emitGcpAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitGcpAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await safeWrite(
    client,
    input.workspaceId,
    gcpRootIndexPath(),
    `${JSON.stringify(
      [
        { id: "run", title: "Cloud Run Services", canonicalPath: gcpCloudRunServicesIndexPath() },
        { id: "monitoring", title: "Monitoring Alerts", canonicalPath: gcpMonitoringAlertsIndexPath() },
        { id: "billing", title: "Billing", canonicalPath: gcpBillingIndexPath() },
      ],
      null,
      2,
    )}\n`,
    aggregate,
  );

  await emitCollection(client, input.workspaceId, {
    objectType: "cloud-run-service",
    indexPath: gcpCloudRunServicesIndexPath(),
    anchorAliasPath: gcpCloudRunServiceByIdAliasPath,
    aliasPaths: cloudRunAliasPaths,
    indexExtras: cloudRunIndexExtras,
    records: input.cloudRunServices ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    objectType: "monitoring-alert",
    indexPath: gcpMonitoringAlertsIndexPath(),
    anchorAliasPath: gcpMonitoringAlertByIdAliasPath,
    aliasPaths: monitoringAlertAliasPaths,
    indexExtras: monitoringAlertIndexExtras,
    records: input.monitoringAlerts ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitBillingCurrentState(client, input.workspaceId, {
    records: input.billing ?? [],
    aggregate,
  });

  return aggregate;
}

interface EmitCollectionOptions {
  objectType: GcpPathObjectType;
  indexPath: string;
  anchorAliasPath: (id: string) => string;
  aliasPaths: (record: GcpRecord, id: string) => string[];
  indexExtras: (record: GcpRecord) => Record<string, unknown>;
  records: readonly GcpRecord[];
  connectionId: string | undefined;
  aggregate: EmitAuxiliaryFilesResult;
}

async function emitCollection(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  options: EmitCollectionOptions,
): Promise<void> {
  const {
    objectType,
    indexPath,
    anchorAliasPath,
    aliasPaths,
    indexExtras,
    records,
    connectionId,
    aggregate,
  } = options;
  const existingRows = await readIndex(client, workspaceId, indexPath, aggregate);
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  if (records.length === 0 && existingRows.length === 0) {
    await writeIndex(client, workspaceId, indexPath, rows, aggregate);
    return;
  }

  for (const record of records) {
    const id = readId(record);
    if (!id) {
      continue;
    }

    const existingRow = rows.get(id);
    const canonicalPath = computeGcpPath(objectType, id);
    const anchorAlias = anchorAliasPath(id);
    const previousRecord = await readAliasRecord(client, workspaceId, anchorAlias, aggregate);
    const previousAliasPaths = previousRecord ? aliasPaths(previousRecord, id) : [];
    const currentAliasPaths = aliasPaths(record, id);
    const allAliasPaths = new Set([anchorAlias, ...currentAliasPaths]);
    const title =
      readString(record.displayName) ??
      readString(record.serviceName) ??
      id;
    const updated =
      readString(record.updatedAt) ??
      readString(record.updated_at) ??
      readString(record.lastModified) ??
      readString(record.lastIncidentTs) ??
      readString(record.capturedAt) ??
      existingRow?.updated ??
      new Date().toISOString();

    if (record._deleted === true) {
      rows.delete(id);
      for (const alias of new Set([anchorAlias, ...previousAliasPaths, ...currentAliasPaths])) {
        await safeDelete(client, workspaceId, alias, aggregate);
      }
      continue;
    }

    rows.set(id, { id, title, updated, canonicalPath, ...indexExtras(record) });

    const aliasPayload = buildAliasPayload({
      provider: "gcp",
      objectType,
      objectId: id,
      canonicalPath,
      payload: record,
      ...(connectionId ? { connectionId } : {}),
    });

    for (const staleAlias of previousAliasPaths) {
      if (!allAliasPaths.has(staleAlias)) {
        await safeDelete(client, workspaceId, staleAlias, aggregate);
      }
    }

    for (const alias of allAliasPaths) {
      await safeWrite(
        client,
        workspaceId,
        alias,
        `${JSON.stringify(aliasPayload, null, 2)}\n`,
        aggregate,
      );
    }
  }

  await writeIndex(client, workspaceId, indexPath, rows, aggregate);
}

function cloudRunAliasPaths(record: GcpRecord, id: string): string[] {
  const aliases: string[] = [];
  const region = readString(record.region);
  if (region) {
    aliases.push(gcpCloudRunServiceByRegionAliasPath(region, id));
  }
  const status = readCloudRunStatus(record);
  if (status) {
    aliases.push(gcpCloudRunServiceByStatusAliasPath(status, id));
  }
  return aliases;
}

function cloudRunIndexExtras(record: GcpRecord): Record<string, unknown> {
  return compactObject({
    region: readString(record.region),
    status: readCloudRunStatus(record),
    ready: typeof record.ready === "boolean" ? record.ready : undefined,
  });
}

function monitoringAlertAliasPaths(record: GcpRecord, id: string): string[] {
  const aliases: string[] = [];
  const title = readString(record.displayName);
  if (title) {
    aliases.push(gcpMonitoringAlertByTitleAliasPath(title, id));
  }
  const state = readMonitoringAlertState(record);
  if (state) {
    aliases.push(gcpMonitoringAlertByStateAliasPath(state, id));
  }
  return aliases;
}

function monitoringAlertIndexExtras(record: GcpRecord): Record<string, unknown> {
  return compactObject({
    state: readMonitoringAlertState(record),
    firing: typeof record.firing === "boolean" ? record.firing : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
  });
}

async function emitBillingCurrentState(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  input: {
    records: readonly GcpRecord[];
    aggregate: EmitAuxiliaryFilesResult;
  },
): Promise<void> {
  const existingRows = await readIndex(
    client,
    workspaceId,
    gcpBillingIndexPath(),
    input.aggregate,
  );
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  for (const record of input.records) {
    if (record._deleted === true) {
      const id = readId(record);
      if (id) {
        rows.delete(id);
      }
      continue;
    }
    const id = readId(record);
    if (!id) {
      continue;
    }
    const existingRow = rows.get(id);
    rows.set(id, {
      id,
      title: "Billing current state",
      updated:
        readString(record.capturedAt) ??
        readString(record.updatedAt) ??
        readString(record.updated_at) ??
        existingRow?.updated ??
        new Date().toISOString(),
      canonicalPath: computeGcpPath("billing", id),
    });
  }

  await writeIndex(client, workspaceId, gcpBillingIndexPath(), rows, input.aggregate);
}

async function readIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<IndexRow[]> {
  if (!client.readFile) {
    return [];
  }

  try {
    const existing = await client.readFile({ workspaceId, path });
    if (!existing) {
      return [];
    }
    const parsed = JSON.parse(existing.content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isIndexRow);
  } catch (error) {
    const status = readStatus(error);
    if (status === 404) {
      return [];
    }
    aggregate.errors.push({ path, error: String(error) });
    return [];
  }
}

async function readAliasRecord(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<GcpRecord | null> {
  if (!client.readFile) {
    return null;
  }

  try {
    const existing = await client.readFile({ workspaceId, path });
    if (!existing) {
      return null;
    }
    const parsed = JSON.parse(existing.content) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const payload = parsed.payload;
    return isRecord(payload) ? payload : null;
  } catch (error) {
    const status = readStatus(error);
    if (status === 404) {
      return null;
    }
    aggregate.errors.push({ path, error: String(error) });
    return null;
  }
}

async function writeIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  rows: Map<string, IndexRow>,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const nextRows = [...rows.values()].sort((left, right) =>
    compareUpdatedDesc(left, right) || left.id.localeCompare(right.id),
  );
  await safeWrite(
    client,
    workspaceId,
    path,
    `${JSON.stringify(nextRows, null, 2)}\n`,
    aggregate,
  );
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
    aggregate.errors.push({ path, error: String(error) });
  }
}

async function safeDelete(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (!client.deleteFile) {
    aggregate.errors.push({ path, error: "deleteFile not supported by client" });
    return;
  }

  try {
    await client.deleteFile({ workspaceId, path });
    aggregate.deleted += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: String(error) });
  }
}

function buildAliasPayload(input: {
  provider: string;
  objectType: GcpPathObjectType;
  objectId: string;
  canonicalPath: string;
  payload: Record<string, unknown>;
  connectionId?: string;
}): Record<string, unknown> {
  return {
    provider: input.provider,
    objectType: input.objectType,
    objectId: input.objectId,
    canonicalPath: input.canonicalPath,
    payload: input.payload,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
  };
}

function readId(record: GcpRecord): string | null {
  const candidate =
    record.id ??
    record.serviceName ??
    record.policyId ??
    record.billingAccountId ??
    null;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return null;
}

function compareUpdatedDesc(left: IndexRow, right: IndexRow): number {
  const leftTime = Date.parse(left.updated);
  const rightTime = Date.parse(right.updated);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return rightTime - leftTime;
  }
  if (Number.isFinite(leftTime)) {
    return -1;
  }
  if (Number.isFinite(rightTime)) {
    return 1;
  }
  return right.updated.localeCompare(left.updated);
}

function readCloudRunStatus(record: GcpRecord): string | undefined {
  if (typeof record.ready === "boolean") {
    return record.ready ? "ready" : "not-ready";
  }
  return readString(record.status);
}

function readMonitoringAlertState(record: GcpRecord): string | undefined {
  const explicit = readString(record.state) ?? readString(record.status);
  if (explicit) {
    return explicit;
  }
  if (typeof record.firing === "boolean") {
    return record.firing ? "open" : "closed";
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function isIndexRow(value: unknown): value is IndexRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    typeof row.updated === "string" &&
    typeof row.canonicalPath === "string"
  );
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}
