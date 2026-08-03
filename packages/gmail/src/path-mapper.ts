import { GMAIL_PATH_ROOT, GMAIL_PATH_ROOTS } from "./identity.js";

export const RELAYFILE_ROOT = GMAIL_PATH_ROOT;
export const OBJECT_RESOURCE_PATH = `${RELAYFILE_ROOT}/{account}/threads`;
export const LIFECYCLE_RESOURCE_PATH = `${RELAYFILE_ROOT}/watches`;
export const DRAFTS_RESOURCE_PATH = `${RELAYFILE_ROOT}/drafts`;

const DRAFTS_SEGMENT = 'drafts';

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
  if (!segment) throw new Error('Gmail path segments must be non-empty');
  return encodeURIComponent(segment).replace(/%2F/gi, '/');
}

export function toObjectRelayfilePath(input: ObjectPathInput): string {
  const id = readIdentifier(input);
  return (
    RELAYFILE_ROOT +
    '/' +
    encodePathSegment(input.account ?? input.accountId ?? 'me') +
    '/threads/' +
    encodePathSegment(input.threadId ?? id) +
    '.json'
  );
}

export function toLifecycleRelayfilePath(id: string | number): string {
  return LIFECYCLE_RESOURCE_PATH + '/' + encodePathSegment(id) + '.json';
}

export function parseRelayfilePath(path: string): { resource: 'object' | 'drafts' | 'lifecycle' | 'unknown'; id: string | null; segments: string[] } {
  const normalized = path.startsWith('/') ? path : '/' + path;
  const segments = normalized.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment.replace(/\.json$/, '')));
  const lifecycleSuffix = LIFECYCLE_RESOURCE_PATH.slice(RELAYFILE_ROOT.length);
  if (
    GMAIL_PATH_ROOTS.some((root) =>
      matchesPathPrefix(segments, `${root}${lifecycleSuffix}`),
    )
  ) {
    return { resource: 'lifecycle', id: segments.at(-1) ?? null, segments };
  }
  if (matchedRoot(segments) !== null && isDraftsPath(segments)) {
    return { resource: 'drafts', id: segments.at(-1) ?? null, segments };
  }
  if (matchedRoot(segments) !== null) {
    return { resource: 'object', id: segments.at(-1) ?? null, segments };
  }
  return { resource: 'unknown', id: null, segments };
}

function matchedRoot(segments: readonly string[]): string | null {
  return GMAIL_PATH_ROOTS.find((root) => matchesPathPrefix(segments, root)) ?? null;
}

/**
 * Drafts are addressed both with and without an account segment:
 * `/gmail/drafts/<id>.json` (the writeback-discovery form) and
 * `/gmail/<account>/drafts/<id>.json` (the mounted form).
 */
function isDraftsPath(segments: readonly string[]): boolean {
  return segments[1] === DRAFTS_SEGMENT || segments[2] === DRAFTS_SEGMENT;
}

function matchesPathPrefix(segments: readonly string[], pathPrefix: string): boolean {
  const prefixSegments = pathPrefix.split('/').filter(Boolean);
  return prefixSegments.every((segment, index) => segment === segments[index]);
}

function readIdentifier(input: ObjectPathInput): string {
  const value = input.id ?? input.key ?? input.name ?? input.path ?? input.threadId ?? input.primaryKey;
  if (value === undefined || value === null || String(value).trim().length === 0) {
    throw new Error('Gmail object path requires an id, key, name, path, threadId, or primaryKey');
  }
  return String(value);
}
