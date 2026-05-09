export const RELAYFILE_ROOT = "/gcs";
export const OBJECT_RESOURCE_PATH = "/gcs/{bucket}/objects";
export const LIFECYCLE_RESOURCE_PATH = "/gcs/notifications/{bucketId}";
const PROVIDER_SLUG: string = "gcs";

export interface ObjectPathInput {
  accountId?: string | number;
  bucket?: string;
  account?: string;
  container?: string;
  db?: string | number;
  schema?: string;
  table?: string;
  siteId?: string;
  driveId?: string;
  id?: string | number;
  key?: string;
  name?: string;
  path?: string;
  threadId?: string;
  primaryKey?: string | number;
}

export function encodePathSegment(value: string | number): string {
  const segment = String(value).trim();
  if (!segment) throw new Error('Google Cloud Storage path segments must be non-empty');
  return encodeURIComponent(segment).replace(/%2F/gi, '/');
}

export function toObjectRelayfilePath(input: ObjectPathInput): string {
  const id = readIdentifier(input);
  switch (PROVIDER_SLUG) {
    case 'google-drive': return "/gcs" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'gcs': return "/gcs" + '/' + encodePathSegment(input.bucket ?? input.account ?? 'bucket') + '/' + encodePathSegment(input.key ?? input.name ?? input.path ?? id);
    case 'sharepoint': return "/gcs" + '/' + encodePathSegment(input.siteId ?? 'site') + '/' + encodePathSegment(input.driveId ?? 'drive') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'onedrive': return "/gcs" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'me') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'azure-blob': return "/gcs" + '/' + encodePathSegment(input.account ?? 'account') + '/' + encodePathSegment(input.container ?? 'container') + '/' + encodePathSegment(input.name ?? input.key ?? input.path ?? id);
    case 'dropbox': return "/gcs" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/' + encodePathSegment(input.path ?? input.name ?? id).replace(/^\//, '');
    case 'gmail': return "/gcs" + '/' + encodePathSegment(input.account ?? input.accountId ?? 'me') + '/threads/' + encodePathSegment(input.threadId ?? id) + '.json';
    case 's3': return "/gcs" + '/' + encodePathSegment(input.bucket ?? input.account ?? 'bucket') + '/' + encodePathSegment(input.key ?? input.name ?? input.path ?? id);
    case 'box': return "/gcs" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/files/' + encodePathSegment(id) + '.json';
    case 'postgres': return "/gcs" + '/' + encodePathSegment(input.db ?? 'db') + '/' + encodePathSegment(input.schema ?? 'public') + '/' + encodePathSegment(input.table ?? 'table') + '/' + encodePathSegment(input.primaryKey ?? id) + '.json';
    case 'redis': return "/gcs" + '/' + encodePathSegment(input.db ?? 0) + '/' + encodePathSegment(input.key ?? input.name ?? id);
    default: return "/gcs" + '/' + encodePathSegment(id);
  }
}

export function toLifecycleRelayfilePath(id: string | number): string {
  return LIFECYCLE_RESOURCE_PATH + '/' + encodePathSegment(id) + '.json';
}

export function parseRelayfilePath(path: string): { resource: 'object' | 'lifecycle' | 'unknown'; id: string | null; segments: string[] } {
  const normalized = path.startsWith('/') ? path : '/' + path;
  const segments = normalized.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment.replace(/\.json$/, '')));
  const lifecycleSegments = LIFECYCLE_RESOURCE_PATH.split('/').filter(Boolean);
  if (lifecycleSegments.every((segment, index) => segment.startsWith('{') || segment === segments[index])) {
    return { resource: 'lifecycle', id: segments.at(-1) ?? null, segments };
  }
  if (segments[0] === RELAYFILE_ROOT.slice(1)) {
    return { resource: 'object', id: segments.at(-1) ?? null, segments };
  }
  return { resource: 'unknown', id: null, segments };
}

function readIdentifier(input: ObjectPathInput): string {
  const value = input.id ?? input.key ?? input.name ?? input.path ?? input.threadId ?? input.primaryKey;
  if (value === undefined || value === null || String(value).trim().length === 0) {
    throw new Error('Google Cloud Storage object path requires an id, key, name, path, threadId, or primaryKey');
  }
  return String(value);
}
