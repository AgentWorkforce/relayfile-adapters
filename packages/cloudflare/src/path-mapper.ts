import { CLOUDFLARE_PATH_ROOT, type CloudflarePathObjectType } from "./types.js";

export function encodeCloudflarePathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Cloudflare path segment must be non-empty");
  }
  return encodeURIComponent(trimmed);
}

export function cloudflareRootIndexPath(): string {
  return `${CLOUDFLARE_PATH_ROOT}/_index.json`;
}

export interface CloudflarePathContext {
  zoneId?: string;
  /** worker-error-rollup: narrows the index to one script's hourly rollups. */
  scriptName?: string;
  /** worker-error-rollup: any instant inside the rollup hour (UTC). */
  hourStart?: string | Date;
}

export function cloudflareCollectionIndexPath(
  objectType: CloudflarePathObjectType,
  context: CloudflarePathContext = {},
): string {
  switch (objectType) {
    case "worker-script":
      return `${CLOUDFLARE_PATH_ROOT}/workers/scripts/_index.json`;
    case "worker-usage":
      return `${CLOUDFLARE_PATH_ROOT}/analytics/workers/scripts/_index.json`;
    case "worker-error-rollup":
      return context.scriptName
        ? cloudflareWorkerErrorRollupScriptIndexPath(context.scriptName)
        : cloudflareWorkerErrorRollupRootIndexPath();
    case "pages-project":
      return `${CLOUDFLARE_PATH_ROOT}/pages/projects/_index.json`;
    case "d1-database":
      return `${CLOUDFLARE_PATH_ROOT}/d1/databases/_index.json`;
    case "kv-namespace":
      return `${CLOUDFLARE_PATH_ROOT}/kv/namespaces/_index.json`;
    case "r2-bucket":
      return `${CLOUDFLARE_PATH_ROOT}/r2/buckets/_index.json`;
    case "queue":
      return `${CLOUDFLARE_PATH_ROOT}/queues/_index.json`;
    case "tunnel":
      return `${CLOUDFLARE_PATH_ROOT}/tunnels/_index.json`;
    case "zone":
      return `${CLOUDFLARE_PATH_ROOT}/zones/_index.json`;
    case "dns-record":
      if (!context.zoneId) {
        throw new Error("Cloudflare dns-record index requires zoneId");
      }
      return `${CLOUDFLARE_PATH_ROOT}/zones/${encodeCloudflarePathSegment(context.zoneId)}/dns-records/_index.json`;
    case "notification-webhook":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/webhooks/_index.json`;
    case "notification-policy":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/policies/_index.json`;
    case "notification-event":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/events/_index.json`;
  }
}

export function cloudflareByIdAliasPath(
  objectType: CloudflarePathObjectType,
  id: string,
  context: CloudflarePathContext = {},
): string {
  if (objectType === "worker-error-rollup") {
    throw new Error(
      "Cloudflare worker-error-rollup records have no by-id alias; use the per-script _index.json",
    );
  }
  if (objectType === "dns-record") {
    if (!context.zoneId) {
      throw new Error("Cloudflare dns-record alias requires zoneId");
    }
    return `${CLOUDFLARE_PATH_ROOT}/zones/${encodeCloudflarePathSegment(context.zoneId)}/dns-records/by-id/${encodeCloudflarePathSegment(id)}.json`;
  }

  return `${canonicalCollectionPrefix(objectType)}/by-id/${encodeCloudflarePathSegment(id)}.json`;
}

export function computeCloudflarePath(
  objectType: CloudflarePathObjectType,
  objectId: string,
  context: CloudflarePathContext = {},
): string {
  if (objectType === "worker-error-rollup") {
    if (context.hourStart === undefined) {
      throw new Error("Cloudflare worker-error-rollup path requires hourStart");
    }
    return cloudflareWorkerErrorRollupPath(objectId, context.hourStart);
  }
  const id = encodeCloudflarePathSegment(objectId);

  switch (objectType) {
    case "worker-script":
      return `${CLOUDFLARE_PATH_ROOT}/workers/scripts/${id}.json`;
    case "worker-usage":
      return `${CLOUDFLARE_PATH_ROOT}/analytics/workers/scripts/${id}.json`;
    case "pages-project":
      return `${CLOUDFLARE_PATH_ROOT}/pages/projects/${id}.json`;
    case "d1-database":
      return `${CLOUDFLARE_PATH_ROOT}/d1/databases/${id}.json`;
    case "kv-namespace":
      return `${CLOUDFLARE_PATH_ROOT}/kv/namespaces/${id}.json`;
    case "r2-bucket":
      return `${CLOUDFLARE_PATH_ROOT}/r2/buckets/${id}.json`;
    case "queue":
      return `${CLOUDFLARE_PATH_ROOT}/queues/${id}.json`;
    case "tunnel":
      return `${CLOUDFLARE_PATH_ROOT}/tunnels/${id}.json`;
    case "zone":
      return `${CLOUDFLARE_PATH_ROOT}/zones/${id}.json`;
    case "dns-record":
      if (!context.zoneId) {
        throw new Error("Cloudflare dns-record path requires zoneId");
      }
      return `${CLOUDFLARE_PATH_ROOT}/zones/${encodeCloudflarePathSegment(context.zoneId)}/dns-records/${id}.json`;
    case "notification-webhook":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/webhooks/${id}.json`;
    case "notification-policy":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/policies/${id}.json`;
    case "notification-event":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/events/${id}.json`;
  }
}

export function computeCloudflarePathFromModel(
  model: string,
  objectId: string,
  context: CloudflarePathContext = {},
): string {
  const normalizedType = normalizeNangoCloudflareModel(model);
  if (!normalizedType) {
    throw new Error(`Unsupported Cloudflare object type: ${model}`);
  }
  return computeCloudflarePath(normalizedType, objectId, context);
}

export function normalizeNangoCloudflareModel(
  model: string,
): CloudflarePathObjectType | null {
  const normalized = model.trim().toLowerCase().replace(/[_\s]+/gu, "-");
  switch (normalized) {
    case "cloudflareworkerscript":
    case "worker-script":
    case "workers-script":
      return "worker-script";
    case "cloudflareworkerusage":
    case "worker-usage":
      return "worker-usage";
    case "cloudflareworkererrorrollup":
    case "worker-error-rollup":
    case "workers-error-rollup":
      return "worker-error-rollup";
    case "cloudflarepagesproject":
    case "pages-project":
      return "pages-project";
    case "cloudflared1database":
    case "d1-database":
      return "d1-database";
    case "cloudflarekvnamespace":
    case "kv-namespace":
      return "kv-namespace";
    case "cloudflarer2bucket":
    case "r2-bucket":
      return "r2-bucket";
    case "cloudflarequeue":
    case "queue":
      return "queue";
    case "cloudflaretunnel":
    case "tunnel":
      return "tunnel";
    case "cloudflarezone":
    case "zone":
      return "zone";
    case "cloudflarednsrecord":
    case "dns-record":
      return "dns-record";
    case "cloudflarenotificationwebhook":
    case "notification-webhook":
      return "notification-webhook";
    case "cloudflarenotificationpolicy":
    case "notification-policy":
      return "notification-policy";
    case "cloudflarenotificationevent":
    case "notification-event":
      return "notification-event";
    default:
      return null;
  }
}

function canonicalCollectionPrefix(objectType: CloudflarePathObjectType): string {
  switch (objectType) {
    case "worker-script":
      return `${CLOUDFLARE_PATH_ROOT}/workers/scripts`;
    case "worker-usage":
      return `${CLOUDFLARE_PATH_ROOT}/analytics/workers/scripts`;
    case "worker-error-rollup":
      return CLOUDFLARE_WORKER_ERRORS_ROOT;
    case "pages-project":
      return `${CLOUDFLARE_PATH_ROOT}/pages/projects`;
    case "d1-database":
      return `${CLOUDFLARE_PATH_ROOT}/d1/databases`;
    case "kv-namespace":
      return `${CLOUDFLARE_PATH_ROOT}/kv/namespaces`;
    case "r2-bucket":
      return `${CLOUDFLARE_PATH_ROOT}/r2/buckets`;
    case "queue":
      return `${CLOUDFLARE_PATH_ROOT}/queues`;
    case "tunnel":
      return `${CLOUDFLARE_PATH_ROOT}/tunnels`;
    case "zone":
      return `${CLOUDFLARE_PATH_ROOT}/zones`;
    case "notification-webhook":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/webhooks`;
    case "notification-policy":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/policies`;
    case "notification-event":
      return `${CLOUDFLARE_PATH_ROOT}/notifications/events`;
    case "dns-record":
      throw new Error("dns-record canonicalCollectionPrefix requires zoneId");
  }
}

// ---------------------------------------------------------------------------
// Workers error rollups
//
// Hourly per-script error/outcome rollups derived from Workers Observability
// (Workers Logs). They live under a dedicated `errors/` root inside
// `/cloudflare/workers/` so they never collide with the flat
// `/cloudflare/workers/scripts/<script>.json` inventory records (a script may
// legitimately be named `scripts`), and so a mount scoped to
// `/cloudflare/workers/**` sees them.
//
//   /cloudflare/workers/errors/_index.json                        one row per script (latest error day)
//   /cloudflare/workers/errors/<script>/_index.json               one row per UTC date with errors
//   /cloudflare/workers/errors/<script>/<YYYY-MM-DD>/_index.json  every error hour that day
//   /cloudflare/workers/errors/<script>/<YYYY-MM-DD>/<HH>.json    one UTC hour
// ---------------------------------------------------------------------------

export const CLOUDFLARE_WORKER_ERRORS_ROOT = `${CLOUDFLARE_PATH_ROOT}/workers/errors`;

export interface CloudflareWorkerErrorRollupHour {
  /** UTC date, `YYYY-MM-DD`. */
  date: string;
  /** UTC hour, zero-padded `HH`. */
  hour: string;
  /** ISO timestamp of the start of the UTC hour. */
  hourStart: string;
}

/** Normalize any instant to the UTC hour bucket that contains it. */
export function cloudflareWorkerErrorRollupHour(
  value: string | Date,
): CloudflareWorkerErrorRollupHour {
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Cloudflare worker-error-rollup hourStart is not a valid date: ${String(value)}`);
  }
  const iso = new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString();
  return { date: iso.slice(0, 10), hour: iso.slice(11, 13), hourStart: iso };
}

/** Stable record id for an hourly rollup: `<scriptName>/<hourStart ISO>`. */
export function cloudflareWorkerErrorRollupId(
  scriptName: string,
  hourStart: string | Date,
): string {
  const trimmed = scriptName.trim();
  if (!trimmed) {
    throw new Error("Cloudflare worker-error-rollup requires a scriptName");
  }
  return `${trimmed}/${cloudflareWorkerErrorRollupHour(hourStart).hourStart}`;
}

export function cloudflareWorkerErrorRollupRootIndexPath(): string {
  return `${CLOUDFLARE_WORKER_ERRORS_ROOT}/_index.json`;
}

export function cloudflareWorkerErrorRollupScriptIndexPath(scriptName: string): string {
  return `${CLOUDFLARE_WORKER_ERRORS_ROOT}/${encodeCloudflarePathSegment(scriptName)}/_index.json`;
}

/** Complete index of one script's error hours for the UTC date containing `hourStart`. */
export function cloudflareWorkerErrorRollupDayIndexPath(
  scriptName: string,
  hourStart: string | Date,
): string {
  const { date } = cloudflareWorkerErrorRollupHour(hourStart);
  return `${CLOUDFLARE_WORKER_ERRORS_ROOT}/${encodeCloudflarePathSegment(scriptName)}/${date}/_index.json`;
}

export function cloudflareWorkerErrorRollupPath(
  scriptName: string,
  hourStart: string | Date,
): string {
  const { date, hour } = cloudflareWorkerErrorRollupHour(hourStart);
  return `${CLOUDFLARE_WORKER_ERRORS_ROOT}/${encodeCloudflarePathSegment(scriptName)}/${date}/${hour}.json`;
}

const WORKER_ERROR_ROLLUP_PATH_PATTERN =
  /^\/cloudflare\/workers\/errors\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/(\d{2})\.json$/u;

/** Inverse of {@link cloudflareWorkerErrorRollupPath}; returns null for any other path. */
export function parseCloudflareWorkerErrorRollupPath(
  path: string,
): { scriptName: string; date: string; hour: string; hourStart: string } | null {
  const match = WORKER_ERROR_ROLLUP_PATH_PATTERN.exec(path);
  if (!match) {
    return null;
  }
  const encodedScript = match[1]!;
  const date = match[2]!;
  const hour = match[3]!;
  const hourStart = `${date}T${hour}:00:00.000Z`;
  const parsed = Date.parse(hourStart);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== hourStart) {
    return null;
  }
  let scriptName: string;
  try {
    scriptName = decodeURIComponent(encodedScript);
  } catch {
    return null;
  }
  // Only canonical encodings round-trip (rejects e.g. `%20api` or lowercase `%2f`).
  if (!scriptName.trim() || encodeCloudflarePathSegment(scriptName) !== encodedScript) {
    return null;
  }
  return { scriptName, date, hour, hourStart };
}

/**
 * Inverse of {@link cloudflareWorkerErrorRollupId} (`<scriptName>/<hourStart ISO>`),
 * so bare `{ id, _deleted: true }` tombstones can still be located.
 */
export function parseCloudflareWorkerErrorRollupId(
  id: string,
): { scriptName: string; hourStart: string } | null {
  const separator = id.lastIndexOf("/");
  if (separator <= 0) {
    return null;
  }
  const scriptName = id.slice(0, separator).trim();
  const rawHour = id.slice(separator + 1);
  if (!scriptName || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00(\.000)?Z$/u.test(rawHour)) {
    return null;
  }
  try {
    return { scriptName, hourStart: cloudflareWorkerErrorRollupHour(rawHour).hourStart };
  } catch {
    return null;
  }
}
