import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  PriorAliasReader,
  aliasCollisionSuffix,
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
    const collidingAliases = findCollidingAliases(objectType, records);

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

  const title = readString(record, "name", "title");
  if (title) paths.push(shortcutByTitleAliasPath(objectType, title, id, isColliding(collisionState, objectType, "title", title)));

  const state = readState(record, objectType);
  if (state) paths.push(shortcutByStateAliasPath(objectType, state, id, isColliding(collisionState, objectType, "state", state)));

  for (const assigneeId of readAssigneeIds(record)) {
    paths.push(shortcutByAssigneeAliasPath(objectType, assigneeId, id, isColliding(collisionState, objectType, "assignee", assigneeId)));
  }

  const creatorId = readString(record, "requested_by_id", "creator_id", "creatorId");
  if (creatorId) paths.push(shortcutByCreatorAliasPath(objectType, creatorId, id, isColliding(collisionState, objectType, "creator", creatorId)));

  const priority = readString(record, "priority", "priority_id", "priorityId");
  if (priority) paths.push(shortcutByPriorityAliasPath(objectType, priority, id, isColliding(collisionState, objectType, "priority", priority)));

  if (collisionState === true) {
    return paths.flatMap((path) => [path, collisionVariant(path, id)]);
  }
  return paths;
}

function findCollidingAliases(objectType: ShortcutPathObjectType, records: readonly ShortcutRecord[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const id = readRecordId(record);
    if (!id || record._deleted === true || (objectType !== "story" && objectType !== "epic")) continue;
    const values: Array<[string, string | undefined]> = [
      ["title", readString(record, "name", "title")],
      ["state", readState(record, objectType)],
      ["creator", readString(record, "requested_by_id", "creator_id", "creatorId")],
      ["priority", readString(record, "priority", "priority_id", "priorityId")],
    ];
    for (const [kind, value] of values) {
      if (value) counts.set(`${objectType}:${kind}:${slugifyAlias(value)}`, (counts.get(`${objectType}:${kind}:${slugifyAlias(value)}`) ?? 0) + 1);
    }
    for (const assigneeId of readAssigneeIds(record)) {
      counts.set(`${objectType}:assignee:${slugifyAlias(assigneeId)}`, (counts.get(`${objectType}:assignee:${slugifyAlias(assigneeId)}`) ?? 0) + 1);
    }
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function isColliding(state: boolean | ReadonlySet<string>, objectType: ShortcutPathObjectType, kind: string, value: string): boolean {
  return state === true || (state instanceof Set && state.has(`${objectType}:${kind}:${slugifyAlias(value)}`));
}

function collisionVariant(path: string, id: string): string {
  return path.replace(/__[^/]+\.json$/u, `-${aliasCollisionSuffix(id)}__${id}.json`);
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
