import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from "@relayfile/adapter-core";

import {
  cloudflareByIdAliasPath,
  cloudflareCollectionIndexPath,
  cloudflareRootIndexPath,
  cloudflareWorkerErrorRollupHour,
  cloudflareWorkerErrorRollupPath,
  cloudflareWorkerErrorRollupRootIndexPath,
  cloudflareWorkerErrorRollupScriptIndexPath,
  computeCloudflarePath,
  normalizeNangoCloudflareModel,
} from "./path-mapper.js";
import { type CloudflarePathObjectType } from "./types.js";

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

type CloudflareRecord = Record<string, unknown> & {
  id?: string;
  script_name?: string;
  name?: string;
  title?: string;
  zone_id?: string;
  zone_name?: string;
  alert_type?: string;
  state?: string;
  modified_on?: string;
  created_on?: string;
  created_at?: string;
  modified_at?: string;
  captured_at?: string;
  timestamp?: string;
  _deleted?: true;
};

type IndexRow = {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
} & Record<string, unknown>;

export interface EmitCloudflareAuxiliaryFilesInput {
  workspaceId: string;
  workerScripts?: readonly CloudflareRecord[];
  workerUsage?: readonly CloudflareRecord[];
  workerErrorRollups?: readonly CloudflareRecord[];
  pagesProjects?: readonly CloudflareRecord[];
  d1Databases?: readonly CloudflareRecord[];
  kvNamespaces?: readonly CloudflareRecord[];
  r2Buckets?: readonly CloudflareRecord[];
  queues?: readonly CloudflareRecord[];
  tunnels?: readonly CloudflareRecord[];
  zones?: readonly CloudflareRecord[];
  dnsRecords?: readonly CloudflareRecord[];
  notificationWebhooks?: readonly CloudflareRecord[];
  notificationPolicies?: readonly CloudflareRecord[];
  notificationEvents?: readonly CloudflareRecord[];
  connectionId?: string;
}

export async function emitCloudflareAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitCloudflareAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await safeWrite(
    client,
    input.workspaceId,
    cloudflareRootIndexPath(),
    `${JSON.stringify(
      [
        { id: "workers", title: "Workers Scripts", canonicalPath: "/cloudflare/workers/scripts/_index.json" },
        { id: "workers-usage", title: "Workers Usage", canonicalPath: "/cloudflare/analytics/workers/scripts/_index.json" },
        { id: "workers-errors", title: "Workers Error Rollups (hourly)", canonicalPath: cloudflareWorkerErrorRollupRootIndexPath() },
        { id: "pages", title: "Pages Projects", canonicalPath: "/cloudflare/pages/projects/_index.json" },
        { id: "d1", title: "D1 Databases", canonicalPath: "/cloudflare/d1/databases/_index.json" },
        { id: "kv", title: "KV Namespaces", canonicalPath: "/cloudflare/kv/namespaces/_index.json" },
        { id: "r2", title: "R2 Buckets", canonicalPath: "/cloudflare/r2/buckets/_index.json" },
        { id: "queues", title: "Queues", canonicalPath: "/cloudflare/queues/_index.json" },
        { id: "tunnels", title: "Tunnels", canonicalPath: "/cloudflare/tunnels/_index.json" },
        { id: "zones", title: "Zones", canonicalPath: "/cloudflare/zones/_index.json" },
        { id: "notifications-webhooks", title: "Notification Webhooks", canonicalPath: "/cloudflare/notifications/webhooks/_index.json" },
        { id: "notifications-policies", title: "Notification Policies", canonicalPath: "/cloudflare/notifications/policies/_index.json" },
        { id: "notifications-events", title: "Notification Events", canonicalPath: "/cloudflare/notifications/events/_index.json" },
      ],
      null,
      2,
    )}\n`,
    aggregate,
  );

  await emitCollection(client, input.workspaceId, "worker-script", input.workerScripts ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "worker-usage", input.workerUsage ?? [], aggregate, input.connectionId);
  await emitWorkerErrorRollupIndexes(client, input.workspaceId, input.workerErrorRollups ?? [], aggregate);
  await emitCollection(client, input.workspaceId, "pages-project", input.pagesProjects ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "d1-database", input.d1Databases ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "kv-namespace", input.kvNamespaces ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "r2-bucket", input.r2Buckets ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "queue", input.queues ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "tunnel", input.tunnels ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "zone", input.zones ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "dns-record", input.dnsRecords ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "notification-webhook", input.notificationWebhooks ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "notification-policy", input.notificationPolicies ?? [], aggregate, input.connectionId);
  await emitCollection(client, input.workspaceId, "notification-event", input.notificationEvents ?? [], aggregate, input.connectionId);

  return aggregate;
}

async function emitCollection(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  objectType: CloudflarePathObjectType,
  records: readonly CloudflareRecord[],
  aggregate: EmitAuxiliaryFilesResult,
  connectionId: string | undefined,
): Promise<void> {
  const grouped = groupRecordsByIndexKey(objectType, records);

  for (const [groupKey, groupRecords] of grouped.entries()) {
    const zoneId = groupKey || undefined;
    if (objectType === "dns-record" && !zoneId) {
      for (const record of groupRecords) {
        const id = readObjectId(record, objectType) ?? "unknown";
        aggregate.errors.push({
          path: `${inputPathPrefix(objectType)}/_index.json`,
          error: `Skipping dns-record ${id}: missing zone_id`,
        });
      }
      continue;
    }
    const indexPath = cloudflareCollectionIndexPath(objectType, { zoneId });
    const existingRows = await readIndex(client, workspaceId, indexPath, aggregate);
    const rows = new Map(existingRows.map((row) => [row.id, row]));

    for (const record of groupRecords) {
      const normalizedType = normalizeNangoCloudflareModel(objectType);
      if (!normalizedType) {
        continue;
      }
      const id = readObjectId(record, normalizedType);
      if (!id) {
        continue;
      }
      if (normalizedType === "dns-record" && !(zoneId ?? readString(record.zone_id))) {
        aggregate.errors.push({
          path: indexPath,
          error: `Skipping dns-record ${id}: missing zone_id`,
        });
        continue;
      }
      const canonicalPath = computeCanonicalPath(normalizedType, record, id, zoneId);
      const aliasPath = cloudflareByIdAliasPath(normalizedType, id, { zoneId });
      if (record._deleted === true) {
        rows.delete(id);
        await safeDelete(client, workspaceId, aliasPath, aggregate);
        continue;
      }

      rows.set(id, {
        id,
        title: readTitle(record, id),
        updated: readUpdated(record),
        canonicalPath,
      });

      await safeWrite(
        client,
        workspaceId,
        aliasPath,
        `${JSON.stringify(buildAliasPayload(normalizedType, id, canonicalPath, record, connectionId), null, 2)}\n`,
        aggregate,
      );
    }

    await safeWrite(
      client,
      workspaceId,
      indexPath,
      `${JSON.stringify(Array.from(rows.values()).sort((a, b) => String(b.updated).localeCompare(String(a.updated))), null, 2)}\n`,
      aggregate,
    );
  }
}

/**
 * Per-script hourly rollup index retention. Rollup files themselves are kept;
 * the index lists only the most recent week so it stays small and cheap to read.
 */
export const CLOUDFLARE_WORKER_ERROR_ROLLUP_INDEX_LIMIT = 168;

/**
 * Hourly Workers error rollups are not a flat collection: each script owns a
 * `_index.json` of its recent hours, and the root `/cloudflare/workers/errors/_index.json`
 * carries one row per script pointing at that script's latest rollup. No `by-id`
 * aliases are emitted — the (script, hour) path is already the natural key.
 */
async function emitWorkerErrorRollupIndexes(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly CloudflareRecord[],
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const byScript = new Map<string, Array<{ record: CloudflareRecord; hourStart: string }>>();
  for (const record of records) {
    const scriptName = readString(record.script_name);
    const rawHour = readString(record.hour_start);
    let hourStart: string | undefined;
    try {
      hourStart = rawHour ? cloudflareWorkerErrorRollupHour(rawHour).hourStart : undefined;
    } catch {
      hourStart = undefined;
    }
    if (!scriptName || !hourStart) {
      aggregate.errors.push({
        path: cloudflareWorkerErrorRollupRootIndexPath(),
        error: `Skipping worker-error-rollup ${readString(record.id) ?? "unknown"}: missing script_name or hour_start`,
      });
      continue;
    }
    if (!byScript.has(scriptName)) {
      byScript.set(scriptName, []);
    }
    byScript.get(scriptName)!.push({ record, hourStart });
  }
  if (byScript.size === 0) {
    return;
  }

  const rootIndexPath = cloudflareWorkerErrorRollupRootIndexPath();
  const rootRows = new Map(
    (await readIndex(client, workspaceId, rootIndexPath, aggregate)).map((row) => [row.id, row]),
  );

  for (const [scriptName, entries] of byScript.entries()) {
    const scriptIndexPath = cloudflareWorkerErrorRollupScriptIndexPath(scriptName);
    const rows = new Map(
      (await readIndex(client, workspaceId, scriptIndexPath, aggregate)).map((row) => [row.id, row]),
    );

    for (const { record, hourStart } of entries) {
      if (record._deleted === true) {
        rows.delete(hourStart);
        continue;
      }
      rows.set(hourStart, buildWorkerErrorRollupRow(scriptName, hourStart, record));
    }

    const sorted = Array.from(rows.values())
      .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
      .slice(0, CLOUDFLARE_WORKER_ERROR_ROLLUP_INDEX_LIMIT);

    await safeWrite(client, workspaceId, scriptIndexPath, `${JSON.stringify(sorted, null, 2)}\n`, aggregate);

    const latest = sorted[0];
    if (!latest) {
      rootRows.delete(scriptName);
      continue;
    }
    rootRows.set(scriptName, {
      ...latest,
      id: scriptName,
      title: scriptName,
      scriptIndexPath,
      latestHourStart: latest.id,
    });
  }

  await safeWrite(
    client,
    workspaceId,
    rootIndexPath,
    `${JSON.stringify(
      Array.from(rootRows.values()).sort((a, b) => String(b.updated).localeCompare(String(a.updated))),
      null,
      2,
    )}\n`,
    aggregate,
  );
}

function buildWorkerErrorRollupRow(
  scriptName: string,
  hourStart: string,
  record: CloudflareRecord,
): IndexRow {
  const topErrors = Array.isArray(record.top_errors) ? record.top_errors : [];
  const firstError = topErrors[0] as Record<string, unknown> | undefined;
  return {
    id: hourStart,
    title: `${scriptName} ${hourStart.slice(0, 13)}:00Z`,
    // Sort key is the rollup hour (not capture time) so re-captured hours keep their place.
    updated: hourStart,
    canonicalPath: cloudflareWorkerErrorRollupPath(scriptName, hourStart),
    script_name: scriptName,
    hour_start: hourStart,
    events: readNumber(record.events) ?? 0,
    exceptions: readNumber(record.exceptions) ?? 0,
    failures: readNumber(record.failures) ?? 0,
    status_5xx: readNumber(record.status_5xx) ?? 0,
    ...(readString(record.severity) ? { severity: readString(record.severity) } : {}),
    ...(firstError && readString(firstError.message)
      ? { top_error: readString(firstError.message), top_error_count: readNumber(firstError.count) ?? 0 }
      : {}),
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function groupRecordsByIndexKey(
  objectType: CloudflarePathObjectType,
  records: readonly CloudflareRecord[],
): Map<string, CloudflareRecord[]> {
  const grouped = new Map<string, CloudflareRecord[]>();
  if (objectType !== "dns-record") {
    grouped.set("", [...records]);
    return grouped;
  }
  for (const record of records) {
    const zoneId = readString(record.zone_id) ?? "";
    if (!grouped.has(zoneId)) {
      grouped.set(zoneId, []);
    }
    grouped.get(zoneId)!.push(record);
  }
  return grouped;
}

function computeCanonicalPath(
  objectType: CloudflarePathObjectType,
  record: CloudflareRecord,
  id: string,
  zoneId: string | undefined,
): string {
  if (objectType === "dns-record") {
    return computeCloudflarePath(objectType, id, {
      zoneId: zoneId ?? readString(record.zone_id),
    });
  }
  return computeCloudflarePath(objectType, id);
}

function readObjectId(
  record: CloudflareRecord,
  objectType: CloudflarePathObjectType,
): string | null {
  if (objectType === "worker-script" || objectType === "worker-usage") {
    return readString(record.script_name) ?? readString(record.id) ?? null;
  }
  return readString(record.id) ?? readString(record.name) ?? null;
}

function readTitle(record: CloudflareRecord, fallback: string): string {
  return (
    readString(record.title) ??
    readString(record.name) ??
    readString(record.script_name) ??
    readString(record.zone_name) ??
    readString(record.alert_type) ??
    fallback
  );
}

function readUpdated(record: CloudflareRecord): string {
  return (
    readString(record.modified_on) ??
    readString(record.modified_at) ??
    readString(record.created_on) ??
    readString(record.created_at) ??
    readString(record.captured_at) ??
    readString(record.timestamp) ??
    new Date().toISOString()
  );
}

function buildAliasPayload(
  objectType: CloudflarePathObjectType,
  objectId: string,
  canonicalPath: string,
  payload: CloudflareRecord,
  connectionId: string | undefined,
): Record<string, unknown> {
  return {
    provider: "cloudflare",
    objectType,
    objectId,
    canonicalPath,
    ...(connectionId ? { connectionId } : {}),
    payload,
  };
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
    const current = await client.readFile({ workspaceId, path });
    if (!current?.content) {
      return [];
    }
    const parsed = JSON.parse(current.content) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is IndexRow => typeof entry === "object" && entry !== null)
      : [];
  } catch (error) {
    aggregate.errors.push({ path, error: String(error) });
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
    return;
  }
  try {
    await client.deleteFile({ workspaceId, path });
    aggregate.deleted += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: String(error) });
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function inputPathPrefix(objectType: CloudflarePathObjectType): string {
  return objectType === "dns-record"
    ? `${cloudflareCollectionIndexPath("zone").replace(/\/_index\.json$/u, "")}/<zoneId>/dns-records`
    : cloudflareCollectionIndexPath(objectType).replace(/\/_index\.json$/u, "");
}
