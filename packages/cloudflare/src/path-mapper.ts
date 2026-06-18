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

export function cloudflareCollectionIndexPath(
  objectType: CloudflarePathObjectType,
  context: { zoneId?: string } = {},
): string {
  switch (objectType) {
    case "worker-script":
      return `${CLOUDFLARE_PATH_ROOT}/workers/scripts/_index.json`;
    case "worker-usage":
      return `${CLOUDFLARE_PATH_ROOT}/analytics/workers/scripts/_index.json`;
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
  context: { zoneId?: string } = {},
): string {
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
  context: { zoneId?: string } = {},
): string {
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
  context: { zoneId?: string } = {},
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
