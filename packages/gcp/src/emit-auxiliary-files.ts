import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from "@relayfile/adapter-core";

import {
  computeGcpPath,
  gcpCloudRunServiceByIdAliasPath,
  gcpCloudRunServicesIndexPath,
  gcpMonitoringAlertByIdAliasPath,
  gcpMonitoringAlertsIndexPath,
  gcpRootIndexPath,
} from "./path-mapper.js";
import { type GcpPathObjectType } from "./types.js";

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

type GcpRecord = Record<string, unknown> & {
  id?: string;
  serviceName?: string;
  policyId?: string;
  displayName?: string;
  updatedAt?: string;
  updated_at?: string;
  lastModified?: string;
  lastIncidentTs?: string;
  capturedAt?: string;
  _deleted?: true;
};

interface IndexRow {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
}

export interface EmitGcpAuxiliaryFilesInput {
  workspaceId: string;
  cloudRunServices?: readonly GcpRecord[];
  monitoringAlerts?: readonly GcpRecord[];
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
        { id: "billing", title: "Billing", canonicalPath: "/gcp/billing/current.json" },
      ],
      null,
      2,
    )}\n`,
    aggregate,
  );

  await emitCollection(client, input.workspaceId, {
    objectType: "cloud-run-service",
    indexPath: gcpCloudRunServicesIndexPath(),
    aliasPath: gcpCloudRunServiceByIdAliasPath,
    records: input.cloudRunServices ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    objectType: "monitoring-alert",
    indexPath: gcpMonitoringAlertsIndexPath(),
    aliasPath: gcpMonitoringAlertByIdAliasPath,
    records: input.monitoringAlerts ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  return aggregate;
}

interface EmitCollectionOptions {
  objectType: GcpPathObjectType;
  indexPath: string;
  aliasPath: (id: string) => string;
  records: readonly GcpRecord[];
  connectionId: string | undefined;
  aggregate: EmitAuxiliaryFilesResult;
}

async function emitCollection(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  options: EmitCollectionOptions,
): Promise<void> {
  const { objectType, indexPath, aliasPath, records, connectionId, aggregate } = options;
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

    const canonicalPath = computeGcpPath(objectType, id);
    const alias = aliasPath(id);
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
      new Date().toISOString();

    if (record._deleted === true) {
      rows.delete(id);
      await safeDelete(client, workspaceId, alias, aggregate);
      continue;
    }

    rows.set(id, { id, title, updated, canonicalPath });

    const aliasPayload = buildAliasPayload({
      provider: "gcp",
      objectType,
      objectId: id,
      canonicalPath,
      payload: record,
      ...(connectionId ? { connectionId } : {}),
    });

    await safeWrite(
      client,
      workspaceId,
      alias,
      `${JSON.stringify(aliasPayload, null, 2)}\n`,
      aggregate,
    );
  }

  await writeIndex(client, workspaceId, indexPath, rows, aggregate);
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

async function writeIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  rows: Map<string, IndexRow>,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const nextRows = [...rows.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
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
    null;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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
