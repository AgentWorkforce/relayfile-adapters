export const RELAYFILE_ROOT = "/google-drive";
export const OBJECT_RESOURCE_PATH = "/google-drive/files";
export const LIFECYCLE_RESOURCE_PATH = "/google-drive/channels";
const PROVIDER_SLUG: string = "google-drive";

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
  if (!segment) throw new Error('Google Drive path segments must be non-empty');
  return encodeURIComponent(segment).replace(/%2F/gi, '/');
}

export function toObjectRelayfilePath(input: ObjectPathInput): string {
  const id = readIdentifier(input);
  switch (PROVIDER_SLUG) {
    case 'google-drive': return "/google-drive" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'gcs': return "/google-drive" + '/' + encodePathSegment(input.bucket ?? input.account ?? 'bucket') + '/' + encodePathSegment(input.key ?? input.name ?? input.path ?? id);
    case 'sharepoint': return "/google-drive" + '/' + encodePathSegment(input.siteId ?? 'site') + '/' + encodePathSegment(input.driveId ?? 'drive') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'onedrive': return "/google-drive" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'me') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'azure-blob': return "/google-drive" + '/' + encodePathSegment(input.account ?? 'account') + '/' + encodePathSegment(input.container ?? 'container') + '/' + encodePathSegment(input.name ?? input.key ?? input.path ?? id);
    case 'dropbox': return "/google-drive" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/' + encodePathSegment(input.path ?? input.name ?? id).replace(/^\//, '');
    case 'gmail': return "/google-drive" + '/' + encodePathSegment(input.account ?? input.accountId ?? 'me') + '/threads/' + encodePathSegment(input.threadId ?? id) + '.json';
    case 's3': return "/google-drive" + '/' + encodePathSegment(input.bucket ?? input.account ?? 'bucket') + '/' + encodePathSegment(input.key ?? input.name ?? input.path ?? id);
    case 'box': return "/google-drive" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/files/' + encodePathSegment(id) + '.json';
    case 'postgres': return "/google-drive" + '/' + encodePathSegment(input.db ?? 'db') + '/' + encodePathSegment(input.schema ?? 'public') + '/' + encodePathSegment(input.table ?? 'table') + '/' + encodePathSegment(input.primaryKey ?? id) + '.json';
    case 'redis': return "/google-drive" + '/' + encodePathSegment(input.db ?? 0) + '/' + encodePathSegment(input.key ?? input.name ?? id);
    default: return "/google-drive" + '/' + encodePathSegment(id);
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
    throw new Error('Google Drive object path requires an id, key, name, path, threadId, or primaryKey');
  }
  return String(value);
}
