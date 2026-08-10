import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from "@relayfile/adapter-core";
import {
  computeShortcutPath,
  shortcutByIdAliasPath,
  shortcutCollectionPath,
  shortcutIndexPath,
  shortcutRootIndexPath,
} from "./path-mapper.js";
import type { ShortcutPathObjectType, ShortcutRecord } from "./types.js";

export interface EmitShortcutAuxiliaryFilesInput {
  workspaceId: string;
  stories?: readonly ShortcutRecord[];
  epics?: readonly ShortcutRecord[];
  connectionId?: string;
}

const BUCKETS: Array<[ShortcutPathObjectType, keyof EmitShortcutAuxiliaryFilesInput]> = [
  ["story", "stories"],
  ["epic", "epics"],
];

export async function emitShortcutAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitShortcutAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const result: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  await writeJson(client, input.workspaceId, shortcutRootIndexPath(), BUCKETS.map(([type]) => ({
    id: type,
    title: `${type}s`,
    canonicalPath: shortcutCollectionPath(type),
  })), result);

  for (const [objectType, bucketKey] of BUCKETS) {
    if (!Object.prototype.hasOwnProperty.call(input, bucketKey)) continue;
    const records = (input[bucketKey] as readonly ShortcutRecord[] | undefined) ?? [];
    const rows: Array<Record<string, unknown>> = [];
    for (const record of records) {
      const id = record.id === undefined || record.id === null ? "" : String(record.id);
      if (!id) {
        result.errors.push({ path: shortcutCollectionPath(objectType), error: "Shortcut record is missing id" });
        continue;
      }
      const canonicalPath = computeShortcutPath(objectType, id);
      const aliasPath = shortcutByIdAliasPath(objectType, id);
      if (record._deleted === true) {
        await deleteJson(client, input.workspaceId, canonicalPath, result);
        await deleteJson(client, input.workspaceId, aliasPath, result);
        continue;
      }
      const title = String(record.name ?? record.title ?? record.description ?? id);
      rows.push({ id, title, updated: String(record.updated_at ?? record.updatedAt ?? ""), canonicalPath });
      await writeJson(client, input.workspaceId, canonicalPath, record, result);
      await writeJson(client, input.workspaceId, aliasPath, record, result);
    }
    await writeJson(client, input.workspaceId, shortcutIndexPath(objectType), rows, result);
  }
  return result;
}

async function writeJson(client: AuxiliaryEmitterClient, workspaceId: string, path: string, value: unknown, result: EmitAuxiliaryFilesResult): Promise<void> {
  try {
    await client.writeFile({ workspaceId, path, content: `${JSON.stringify(value, null, 2)}\n`, contentType: EMIT_AUXILIARY_JSON_CONTENT_TYPE });
    result.written += 1;
  } catch (error) {
    result.errors.push({ path, error: error instanceof Error ? error.message : String(error) });
  }
}

async function deleteJson(client: AuxiliaryEmitterClient, workspaceId: string, path: string, result: EmitAuxiliaryFilesResult): Promise<void> {
  if (!client.deleteFile) return;
  try {
    await client.deleteFile({ workspaceId, path });
    result.deleted += 1;
  } catch (error) {
    result.errors.push({ path, error: error instanceof Error ? error.message : String(error) });
  }
}
