import { parseRelayfilePath } from './path-mapper.js';
import { providerQueries } from './queries.js';
import { resources } from './resources.js';
import type { JsonObject, JsonValue, ProviderWritebackRequest, WritebackOperation } from './types.js';

const READ_ONLY_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'url', '_webhook', '_connection', 'fingerprint', 'etag', 'eTag']);

export class ReadOnlyFieldError extends Error {
  readonly field: string;
  readonly code = 'READ_ONLY_FIELD';

  constructor(field: string) {
    super('Field "' + field + '" is read-only and cannot be written');
    this.name = 'ReadOnlyFieldError';
    this.field = field;
  }
}

export function resolveWritebackRequest(path: string, content: string, operation?: WritebackOperation): ProviderWritebackRequest {
  const parsedPath = parseRelayfilePath(path);
  const payload = content.trim().length > 0 ? parseJsonObject(content) : {};
  rejectReadOnlyFields(payload);
  const resource = resolveResource(parsedPath.resource);
  const canonical = isCanonicalId(resource, parsedPath.id);
  const resolvedOperation: WritebackOperation = operation ?? (content.trim().length === 0 ? 'delete' : canonical ? 'update' : 'create');
  const endpoint = endpointFor(resource, resolvedOperation);

  return {
    action: "gmail" + '.' + resource + '.' + resolvedOperation,
    operation: resolvedOperation,
    method: methodFor(resource, resolvedOperation),
    endpoint,
    resource,
    resourceId: parsedPath.id,
    body: resolvedOperation === 'delete' ? null : payload,
  };
}

type GmailWritebackResource = 'drafts' | 'threads' | 'watches';

/**
 * Drafts follow the file-native writeback contract: a filename matching the
 * resource's declared canonical `idPattern` edits that draft, and any other
 * filename creates a new one. `new.json` carries no special privilege (see
 * `docs/migration/file-native-writeback.md`). `resources.ts` is the single
 * source of truth for the pattern — it is generated from
 * `scripts/writeback-discovery-data.mjs`, so the resolver and the published
 * discovery docs cannot drift apart.
 *
 * Threads and watches keep the legacy reserved-prefix heuristic: only drafts
 * are file-native so far (see the Gmail row in
 * `docs/migration/file-native-writeback.md`), and changing their create/update
 * split would alter behavior this change has no reason to touch. Migrating them
 * is a separate change.
 *
 * Inference is a default, not the only route: a caller that already knows which
 * it wants passes `operation` to `resolveWritebackRequest` explicitly, which
 * bypasses this entirely.
 */
function isCanonicalId(resource: GmailWritebackResource, id: string | null): boolean {
  if (id === null) return false;
  if (resource === 'drafts') {
    const config = resources.find((candidate) => candidate.name === 'drafts');
    return config ? config.idPattern.test(id) : false;
  }
  const reservedPrefix = /^(draft|create|new|upload|tmp|temp)(?:[._-]|$)/i.test(id);
  return !reservedPrefix && /^[A-Za-z0-9_-]+$/.test(id);
}

function resolveResource(parsed: 'object' | 'drafts' | 'lifecycle' | 'unknown'): GmailWritebackResource {
  if (parsed === 'lifecycle') return 'watches';
  if (parsed === 'drafts') return 'drafts';
  return 'threads';
}

function endpointFor(resource: GmailWritebackResource, operation: WritebackOperation): string {
  if (resource === 'watches') return providerQueries.actions.lifecycleWrite;
  if (resource === 'drafts') {
    // drafts.create posts to the collection; update/delete address the draft id.
    return operation === 'create'
      ? providerQueries.actions.draftCreate
      : providerQueries.actions.draftWrite;
  }
  return providerQueries.actions.objectWrite;
}

function methodFor(resource: GmailWritebackResource, operation: WritebackOperation): 'DELETE' | 'PATCH' | 'POST' | 'PUT' {
  if (operation === 'delete') return 'DELETE';
  // Gmail's drafts.update is a PUT that replaces the draft; messages.modify is a PATCH.
  if (operation === 'update') return resource === 'drafts' ? 'PUT' : 'PATCH';
  return 'POST';
}

function parseJsonObject(content: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch (error) {
    throw new Error('Gmail writeback requires valid JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gmail writeback requires a JSON object');
  }
  return parsed;
}

export function rejectReadOnlyFields(payload: JsonObject): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) throw new ReadOnlyFieldError(key);
  }
}

