import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  PriorAliasReader,
  runEmitBatch,
  slugifyAlias,
  type AuxiliaryEmitterClient,
  type EmitDelete,
  type EmitAuxiliaryFilesResult,
  type EmitPlan,
} from "@relayfile/adapter-core";
import {
  computeShortcutPath,
  computeShortcutRecordPath,
  shortcutByAssigneeAliasPath,
  shortcutByCreatorAliasPath,
  shortcutByIdAliasPath,
  shortcutByPriorityAliasPath,
  shortcutByStateAliasPath,
  shortcutByTitleAliasPath,
  shortcutCollectionPath,
  shortcutIndexPath,
  shortcutLegacyByIdAliasPath,
  shortcutRootIndexPath,
} from "./path-mapper.js";
import type { ShortcutPathObjectType, ShortcutRecord } from "./types.js";

export interface EmitShortcutAuxiliaryFilesInput {
  workspaceId: string;
  categories?: readonly ShortcutRecord[];
  customFields?: readonly ShortcutRecord[];
  groups?: readonly ShortcutRecord[];
  iterations?: readonly ShortcutRecord[];
  labels?: readonly ShortcutRecord[];
  members?: readonly ShortcutRecord[];
  milestones?: readonly ShortcutRecord[];
  projects?: readonly ShortcutRecord[];
  stories?: readonly ShortcutRecord[];
  epics?: readonly ShortcutRecord[];
  workflows?: readonly ShortcutRecord[];
}

interface ShortcutIndexRow {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
  aliasKeys?: readonly string[];
}

type BucketKey = keyof EmitShortcutAuxiliaryFilesInput;

const BUCKETS: readonly [ShortcutPathObjectType, BucketKey, string][] = [
  ["category", "categories", "categories"],
  ["custom-field", "customFields", "custom-fields"],
  ["epic", "epics", "epics"],
  ["group", "groups", "groups"],
  ["iteration", "iterations", "iterations"],
  ["label", "labels", "labels"],
  ["member", "members", "members"],
  ["milestone", "milestones", "milestones"],
  ["project", "projects", "projects"],
  ["story", "stories", "stories"],
  ["workflow", "workflows", "workflows"],
];

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export async function emitShortcutAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitShortcutAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const result: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await writeJson(
    client,
    input.workspaceId,
    shortcutRootIndexPath(),
    BUCKETS.map(([objectType, , collection]) => ({
      id: objectType,
      title: collection,
      canonicalPath: shortcutIndexPath(objectType),
    })),
    result,
  );

  for (const [objectType, bucketKey] of BUCKETS) {
    if (!Object.prototype.hasOwnProperty.call(input, bucketKey)) continue;
    const records = (input[bucketKey] as readonly ShortcutRecord[] | undefined) ?? [];
    const reconciler = new IndexFileReconciler<ShortcutIndexRow>({
      client,
      workspaceId: input.workspaceId,
      path: shortcutIndexPath(objectType),
      builder: (rows) => ({
        path: shortcutIndexPath(objectType),
        content: `${JSON.stringify([...rows].sort(compareIndexRows), null, 2)}\n`,
        contentType: JSON_CONTENT_TYPE,
      }),
    });
    const priorReader = new PriorAliasReader(client, input.workspaceId);
    const persistedRows = await readIndexRows(client, input.workspaceId, shortcutIndexPath(objectType));
    const collidingAliases = findCollidingAliases(objectType, records, persistedRows);

    const fanOut = await runEmitBatch(client, input.workspaceId, records, async (record) => {
      const id = readRecordId(record);
      if (!id) throw new Error(`Shortcut ${objectType} record is missing a valid id`);

      const prior = await priorReader.read<ShortcutRecord>(shortcutByIdAliasPath(objectType, id));
      const previous = prior ?? record;
      if (record._deleted === true) {
        reconciler.remove(id);
        return {
          deletes: uniquePaths([
            computeShortcutPath(objectType, id),
            computeShortcutRecordPath(objectType, previous),
            shortcutLegacyByIdAliasPath(objectType, id),
            ...aliasPathsFor(objectType, previous, id, true),
          ]).map((path): EmitDelete => ({ path })),
        };
      }

      const nextAliases = aliasPathsFor(objectType, record, id, collidingAliases);
      const nextCanonicalPath = computeShortcutRecordPath(objectType, record);
      const previousCanonicalPath = computeShortcutRecordPath(objectType, previous);
      const staleAliases = prior
        ? aliasPathsFor(objectType, previous, id, true).filter((path) => !nextAliases.includes(path))
        : [shortcutLegacyByIdAliasPath(objectType, id)];
      reconciler.upsert(indexRow(objectType, record, id));

      return {
        deletes: uniquePaths([
          ...staleAliases,
          ...(computeShortcutPath(objectType, id) !== nextCanonicalPath ? [computeShortcutPath(objectType, id)] : []),
          ...(previousCanonicalPath !== nextCanonicalPath ? [previousCanonicalPath] : []),
        ]).map((path): EmitDelete => ({ path })),
        writes: uniquePaths([nextCanonicalPath, ...nextAliases]).map((path) => ({
          path,
          content: `${JSON.stringify(record, null, 2)}\n`,
          contentType: JSON_CONTENT_TYPE,
        })),
      } satisfies EmitPlan;
    });

    result.written += fanOut.written;
    result.deleted += fanOut.deleted;
    result.errors.push(...fanOut.errors);

    const indexResult = await reconciler.flush();
    result.written += indexResult.written;
    result.errors.push(...indexResult.errors);
  }

  return result;
}

function indexRow(objectType: ShortcutPathObjectType, record: ShortcutRecord, id: string): ShortcutIndexRow {
  return {
    id,
    title: readString(record, "name", "title", "description") ?? id,
    updated: readString(record, "updated_at", "updatedAt") ?? "",
    canonicalPath: computeShortcutRecordPath(objectType, record),
    aliasKeys: aliasKeysFor(objectType, record),
  };
}

function aliasPathsFor(
  objectType: ShortcutPathObjectType,
  record: ShortcutRecord,
  id: string,
  collisionState: boolean | ReadonlySet<string>,
): string[] {
  const paths = [shortcutByIdAliasPath(objectType, id)];
  if (objectType !== "story" && objectType !== "epic") return paths;

  const addAlias = (
    kind: string,
    value: string,
    build: (colliding: boolean) => string,
  ) => {
    const base = build(false);
    const collision = build(true);
    if (collisionState === true) {
      paths.push(base, collision);
    } else {
      paths.push(isColliding(collisionState, objectType, kind, value) ? collision : base);
    }
  };

  const title = readString(record, "name", "title");
  if (title) addAlias("title", title, (colliding) => shortcutByTitleAliasPath(objectType, title, id, colliding));

  const state = readState(record, objectType);
  if (state) addAlias("state", state, (colliding) => shortcutByStateAliasPath(objectType, state, id, colliding));

  for (const assigneeId of readAssigneeIds(record)) {
    addAlias("assignee", assigneeId, (colliding) => shortcutByAssigneeAliasPath(objectType, assigneeId, id, colliding));
  }

  const creatorId = readString(record, "requested_by_id", "creator_id", "creatorId");
  if (creatorId) addAlias("creator", creatorId, (colliding) => shortcutByCreatorAliasPath(objectType, creatorId, id, colliding));

  const priority = readString(record, "priority", "priority_id", "priorityId");
  if (priority) addAlias("priority", priority, (colliding) => shortcutByPriorityAliasPath(objectType, priority, id, colliding));

  return paths;
}

function findCollidingAliases(
  objectType: ShortcutPathObjectType,
  records: readonly ShortcutRecord[],
  persistedRows: readonly ShortcutIndexRow[],
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  const incomingIds = new Set(records.map(readRecordId).filter((id): id is string => Boolean(id)));
  for (const row of persistedRows) {
    if (incomingIds.has(row.id)) continue;
    for (const key of row.aliasKeys ?? (row.title ? [`${objectType}:title:${slugifyAlias(row.title)}`] : [])) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const record of records) {
    if (record._deleted === true) continue;
    for (const key of aliasKeysFor(objectType, record)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function isColliding(state: boolean | ReadonlySet<string>, objectType: ShortcutPathObjectType, kind: string, value: string): boolean {
  return state === true || (state instanceof Set && state.has(`${objectType}:${kind}:${slugifyAlias(value)}`));
}

function aliasKeysFor(objectType: ShortcutPathObjectType, record: ShortcutRecord): string[] {
  if (objectType !== "story" && objectType !== "epic") return [];
  const keys: string[] = [];
  const add = (kind: string, value: string | undefined) => {
    if (value) keys.push(`${objectType}:${kind}:${slugifyAlias(value)}`);
  };
  add("title", readString(record, "name", "title"));
  add("state", readState(record, objectType));
  add("creator", readString(record, "requested_by_id", "creator_id", "creatorId"));
  add("priority", readString(record, "priority", "priority_id", "priorityId"));
  for (const assigneeId of readAssigneeIds(record)) add("assignee", assigneeId);
  return keys;
}

async function readIndexRows(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<ShortcutIndexRow[]> {
  if (!client.readFile) return [];
  try {
    const result = await client.readFile({ workspaceId, path });
    if (!result?.content) return [];
    const parsed: unknown = JSON.parse(result.content);
    return Array.isArray(parsed) ? parsed.filter(isRecord) as unknown as ShortcutIndexRow[] : [];
  } catch {
    return [];
  }
}

function readState(record: ShortcutRecord, objectType: ShortcutPathObjectType): string | undefined {
  const nested = record.workflow_state ?? record.epic_state;
  if (isRecord(nested)) return readString(nested, "name", "id");
  return readString(record, objectType === "story" ? "workflow_state_id" : "epic_state_id", "state", "state_id");
}

function readAssigneeIds(record: ShortcutRecord): string[] {
  const owners = record.owner_ids ?? record.ownerIds;
  if (Array.isArray(owners)) return owners.map(String).filter(Boolean);
  const owner = readString(record, "owner_id", "ownerId");
  return owner ? [owner] : [];
}

function readRecordId(record: ShortcutRecord): string | undefined {
  const raw = record.id;
  if (raw === undefined || raw === null) return undefined;
  const id = String(raw).trim();
  return id && id !== "_index" ? id : undefined;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareIndexRows(left: ShortcutIndexRow, right: ShortcutIndexRow): number {
  const updated = right.updated.localeCompare(left.updated);
  return updated || left.id.localeCompare(right.id);
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

async function writeJson(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  value: unknown,
  result: EmitAuxiliaryFilesResult,
): Promise<void> {
  try {
    await client.writeFile({
      workspaceId,
      path,
      content: `${JSON.stringify(value, null, 2)}\n`,
      contentType: JSON_CONTENT_TYPE,
    });
    result.written += 1;
  } catch (error) {
    result.errors.push({ path, error: error instanceof Error ? error.message : String(error) });
  }
}
