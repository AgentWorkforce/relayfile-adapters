export const RELAYFILE_ROOT = "/dropbox";
export const OBJECT_RESOURCE_PATH = "/dropbox/{accountId}/files";
export const LIFECYCLE_RESOURCE_PATH = "/dropbox/cursors";
const PROVIDER_SLUG: string = "dropbox";

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
  if (!segment) throw new Error('Dropbox path segments must be non-empty');
  return encodeURIComponent(segment).replace(/%2F/gi, '/');
}

export function toObjectRelayfilePath(input: ObjectPathInput): string {
  const id = readIdentifier(input);
  switch (PROVIDER_SLUG) {
    case 'google-drive': return "/dropbox" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'gcs': return "/dropbox" + '/' + encodePathSegment(input.bucket ?? input.account ?? 'bucket') + '/' + encodePathSegment(input.key ?? input.name ?? input.path ?? id);
    case 'sharepoint': return "/dropbox" + '/' + encodePathSegment(input.siteId ?? 'site') + '/' + encodePathSegment(input.driveId ?? 'drive') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'onedrive': return "/dropbox" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'me') + '/' + encodePathSegment(input.path ?? input.name ?? id);
    case 'azure-blob': return "/dropbox" + '/' + encodePathSegment(input.account ?? 'account') + '/' + encodePathSegment(input.container ?? 'container') + '/' + encodePathSegment(input.name ?? input.key ?? input.path ?? id);
    case 'dropbox': return "/dropbox" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/' + encodePathSegment(input.path ?? input.name ?? id).replace(/^\//, '');
    case 'gmail': return "/dropbox" + '/' + encodePathSegment(input.account ?? input.accountId ?? 'me') + '/threads/' + encodePathSegment(input.threadId ?? id) + '.json';
    case 's3': return "/dropbox" + '/' + encodePathSegment(input.bucket ?? input.account ?? 'bucket') + '/' + encodePathSegment(input.key ?? input.name ?? input.path ?? id);
    case 'box': return "/dropbox" + '/' + encodePathSegment(input.accountId ?? input.account ?? 'default') + '/files/' + encodePathSegment(id) + '.json';
    case 'postgres': return "/dropbox" + '/' + encodePathSegment(input.db ?? 'db') + '/' + encodePathSegment(input.schema ?? 'public') + '/' + encodePathSegment(input.table ?? 'table') + '/' + encodePathSegment(input.primaryKey ?? id) + '.json';
    case 'redis': return "/dropbox" + '/' + encodePathSegment(input.db ?? 0) + '/' + encodePathSegment(input.key ?? input.name ?? id);
    default: return "/dropbox" + '/' + encodePathSegment(id);
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
    throw new Error('Dropbox object path requires an id, key, name, path, threadId, or primaryKey');
  }
  return String(value);
}
