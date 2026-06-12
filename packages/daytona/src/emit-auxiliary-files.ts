import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from "@relayfile/adapter-core";

import {
  computeDaytonaPath,
  daytonaRootIndexPath,
  daytonaUsageByIdAliasPath,
  daytonaUsageIndexPath,
} from "./path-mapper.js";
import { DAYTONA_PATH_ROOT, type DaytonaPathObjectType } from "./types.js";

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

type DaytonaUsageRecord = Record<string, unknown> & {
  id?: string;
  organizationId?: string;
  organization_id?: string;
  name?: string;
  organizationName?: string;
  updatedAt?: string;
  updated_at?: string;
  capturedAt?: string;
  _deleted?: true;
};

interface UsageIndexRow {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
  organizationId: string;
}

export interface EmitDaytonaAuxiliaryFilesInput {
  workspaceId: string;
  usage?: readonly DaytonaUsageRecord[];
  connectionId?: string;
}

export async function emitDaytonaAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitDaytonaAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await safeWrite(
    client,
    input.workspaceId,
    daytonaRootIndexPath(),
    `${JSON.stringify([
      { id: "usage", title: "Usage", canonicalPath: daytonaUsageIndexPath() },
    ], null, 2)}\n`,
    aggregate,
  );

  await emitUsage(client, input.workspaceId, input.usage ?? [], input.connectionId, aggregate);

  return aggregate;
}

async function emitUsage(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly DaytonaUsageRecord[],
  connectionId: string | undefined,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const existingRows = await readIndex(client, workspaceId, daytonaUsageIndexPath(), aggregate);
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  if (records.length === 0 && existingRows.length === 0) {
    await writeIndex(client, workspaceId, daytonaUsageIndexPath(), rows, aggregate);
    return;
  }

  for (const record of records) {
    const id = readId(record);
    if (!id) {
      continue;
    }

    const canonicalPath = computeDaytonaPath("usage", id);
    const aliasPath = daytonaUsageByIdAliasPath(id);
    const title = readString(record.name) ?? readString(record.organizationName) ?? id;
    const updated =
      readString(record.updatedAt) ??
      readString(record.updated_at) ??
      readString(record.capturedAt) ??
      new Date().toISOString();

    if (record._deleted === true) {
      rows.delete(id);
      await safeDelete(client, workspaceId, aliasPath, aggregate);
      continue;
    }

    rows.set(id, {
      id,
      title,
      updated,
      canonicalPath,
      organizationId: id,
    });

    const aliasPayload = buildAliasPayload({
      provider: "daytona",
      objectType: "usage",
      objectId: id,
      canonicalPath,
      payload: record,
      ...(connectionId ? { connectionId } : {}),
    });

    await safeWrite(
      client,
      workspaceId,
      aliasPath,
      `${JSON.stringify(aliasPayload, null, 2)}\n`,
      aggregate,
    );
  }

  await writeIndex(client, workspaceId, daytonaUsageIndexPath(), rows, aggregate);
}

async function readIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<UsageIndexRow[]> {
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
    return parsed.filter(isUsageIndexRow);
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
  rows: Map<string, UsageIndexRow>,
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
  objectType: DaytonaPathObjectType;
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

function readId(record: DaytonaUsageRecord): string | null {
  const candidate =
    record.id ??
    record.organizationId ??
    record.organization_id ??
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

function isUsageIndexRow(value: unknown): value is UsageIndexRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    typeof row.updated === "string" &&
    typeof row.canonicalPath === "string" &&
    typeof row.organizationId === "string"
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
