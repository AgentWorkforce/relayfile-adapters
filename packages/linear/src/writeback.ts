import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { resources } from './resources.js';
import type { JsonValue, LinearWritebackRequest } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

/**
 * Resolve a relayfile writeback into a Linear GraphQL mutation request.
 *
 * Supported routes (today):
 *   POST /linear/issues/<slug>--<uuid>/comments/<draft>.json → commentCreate
 *   POST /linear/issues/<draft>.json                         → issueCreate
 *   PATCH/PUT /linear/issues/<slug>--<uuid>.json             → issueUpdate
 *
 * The path-mapper emits issue paths as `<slug>--<32-hex>`. We reverse the
 * suffix to recover the canonical UUID Linear's API requires.
 */
export function resolveWritebackRequest(path: string, content: string): LinearWritebackRequest {
  const route = classifyWrite(path, resources);

  // Comment on an existing issue.
  const newCommentMatch = path.match(/^\/linear\/issues\/([^/]+)\/comments\/([^/]+)\.json$/);
  if (newCommentMatch?.[1] && newCommentMatch[2] && route?.resource.name === 'comments' && route.kind === 'create') {
    return buildCommentCreate(extractLinearId(newCommentMatch[1]), content);
  }

  // Create a brand-new issue from any non-canonical filename.
  const issueFileMatch = path.match(/^\/linear\/issues\/([^/]+)\.json$/);
  if (issueFileMatch?.[1] && route?.resource.name === 'issues' && route.kind === 'create') {
    return buildIssueCreate(content);
  }

  // Update an existing issue's metadata.
  if (issueFileMatch?.[1] && route?.resource.name === 'issues' && route.kind === 'patch') {
    return buildIssueUpdate(extractLinearId(issueFileMatch[1]), content);
  }

  throw new Error(`No Linear writeback rule matched ${path}`);
}

export function resolveDeleteRequest(path: string): LinearWritebackRequest {
  const route = classifyWrite(path, resources, { fsEvent: 'delete' });
  const issueFileMatch = path.match(/^\/linear\/issues\/([^/]+)\.json$/);
  if (!issueFileMatch?.[1] || route?.resource.name !== 'issues' || route.kind !== 'delete') {
    throw new Error(`No Linear delete writeback rule matched ${path}`);
  }

  return {
    action: 'delete_issue',
    method: 'POST',
    endpoint: '/graphql',
    body: {
      query: ISSUE_DELETE_MUTATION,
      variables: { id: extractLinearId(issueFileMatch[1]) },
    },
  };
}

/* ------------------------------------------------------------------ *
 * Path → id resolution
 * ------------------------------------------------------------------ */

/**
 * Reverse the path-mapper's `<slug>--<id>` encoding.
 *
 * Path-mapper emits segments in two shapes:
 *   - `<slug>--<32-hex>`  when a title is present (the common case).
 *     Reformatted to canonical UUID 8-4-4-4-12.
 *   - bare `<id>`         when no title is available. Decoded and passed
 *                         through; the GraphQL layer validates.
 *
 * Legacy 8-char suffixes (pre-fix paths) are rejected explicitly so callers
 * get a "re-sync required" message instead of an opaque downstream 400.
 * Team-prefixed identifiers (e.g. `PROJ-441`) are also rejected — they are
 * the user-facing key, not the canonical UUID writebacks need.
 */
function extractLinearId(segment: string): string {
  const decoded = decodeURIComponent(segment);

  const slugged32 = /(?:--|__)([0-9a-f]{32})$/i.exec(decoded);
  if (slugged32?.[1]) return formatUuid(slugged32[1]);

  if (/(?:--|__)[0-9a-f]{8}$/i.test(decoded)) {
    throw new Error(
      `Linear path "${segment}" uses a legacy 8-char id suffix that cannot be ` +
        `losslessly resolved. Run \`relayfile pull\` to re-sync paths.`,
    );
  }

  if (/^[A-Z]+-\d+$/.test(decoded)) {
    throw new Error(
      `Linear path "${segment}" uses a team-prefixed identifier; writeback ` +
        `requires the canonical UUID. Re-emit the path with the UUID suffix.`,
    );
  }

  const bareHex = /^([0-9a-f]{32})$/i.exec(decoded);
  if (bareHex?.[1]) return formatUuid(bareHex[1]);

  // Canonical UUIDs and synthetic test ids fall through.
  return decoded;
}

/**
 * Reformat a 32-char hex string back to canonical UUID `8-4-4-4-12` form.
 * Inverse of the dehyphenation done by `path-mapper.idSuffix()`.
 */
function formatUuid(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}

/* ------------------------------------------------------------------ *
 * Mutation builders
 * ------------------------------------------------------------------ */

const COMMENT_CREATE_MUTATION = `mutation RelayfileCommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id url }
  }
}`;

const ISSUE_CREATE_MUTATION = `mutation RelayfileIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier url }
  }
}`;

const ISSUE_UPDATE_MUTATION = `mutation RelayfileIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id identifier url }
  }
}`;

const ISSUE_DELETE_MUTATION = `mutation RelayfileIssueDelete($id: String!) {
  issueDelete(id: $id) {
    success
  }
}`;

/**
 * Build a `commentCreate` mutation request for the writeback engine.
 *
 * Accepts two payload shapes:
 *   - a plain string: becomes the comment body verbatim.
 *   - a JSON object with a `body` field plus optional `parentId` (thread
 *     reply target) and `doNotSubscribeToIssue` (skip the implicit
 *     subscription Linear adds for commenters).
 */
function buildCommentCreate(issueId: string, content: string): LinearWritebackRequest {
  const parsed = safeParseJson(content);

  // Plain string body becomes a simple comment.
  if (typeof parsed === 'string') {
    return {
      action: 'create_comment',
      method: 'POST',
      endpoint: '/graphql',
      body: {
        query: COMMENT_CREATE_MUTATION,
        variables: { input: { issueId, body: parsed } },
      },
    };
  }

  // JSON object: pull body + optional parentId, doNotSubscribeToIssue, etc.
  if (!isRecord(parsed)) {
    throw new Error(
      'comments/<draft>.json writeback expects a JSON object or plain string',
    );
  }

  const body = readString(parsed, 'body');
  if (!body) {
    throw new Error('comments/<draft>.json writeback requires a non-empty `body`');
  }

  const input: Record<string, unknown> = { issueId, body };
  const parentId = readString(parsed, 'parentId');
  if (parentId) input.parentId = parentId;
  const doNotSubscribe = readBoolean(parsed, 'doNotSubscribeToIssue');
  if (doNotSubscribe !== undefined) input.doNotSubscribeToIssue = doNotSubscribe;

  return {
    action: 'create_comment',
    method: 'POST',
    endpoint: '/graphql',
    body: { query: COMMENT_CREATE_MUTATION, variables: { input } },
  };
}

/**
 * Build an `issueCreate` mutation request for the writeback engine.
 *
 * Requires `teamId` and `title` in the payload. All other Linear
 * `IssueCreateInput` fields are optional and forwarded if present.
 */
function buildIssueCreate(content: string): LinearWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const teamId = readString(payload, 'teamId');
  if (!teamId) {
    throw new Error('issues/<draft>.json writeback requires a `teamId`');
  }
  const title = readString(payload, 'title');
  if (!title) {
    throw new Error('issues/<draft>.json writeback requires a `title`');
  }

  const input: Record<string, unknown> = { teamId, title };
  const description = readString(payload, 'description');
  if (description) input.description = description;
  const priority = readNumber(payload, 'priority');
  if (priority !== undefined) input.priority = priority;
  const assigneeId = readString(payload, 'assigneeId');
  if (assigneeId) input.assigneeId = assigneeId;
  const stateId = readString(payload, 'stateId');
  if (stateId) input.stateId = stateId;
  const projectId = readString(payload, 'projectId');
  if (projectId) input.projectId = projectId;
  const cycleId = readString(payload, 'cycleId');
  if (cycleId) input.cycleId = cycleId;
  const labelIds = readStringArray(payload, 'labelIds');
  if (labelIds) input.labelIds = labelIds;
  const dueDate = readString(payload, 'dueDate');
  if (dueDate) input.dueDate = dueDate;
  const estimate = readNumber(payload, 'estimate');
  if (estimate !== undefined) input.estimate = estimate;
  const parentId = readString(payload, 'parentId');
  if (parentId) input.parentId = parentId;

  return {
    action: 'create_issue',
    method: 'POST',
    endpoint: '/graphql',
    body: { query: ISSUE_CREATE_MUTATION, variables: { input } },
  };
}

/**
 * Envelope marker fields written by `LinearAdapter.renderContent()`. When the
 * payload presents itself as the synced envelope (rather than a bare update
 * input), unwrap to the inner `payload` before applying the allowlist.
 *
 * Without this step, a round-tripped synced file would forward `provider`,
 * `workspaceId`, `objectType`, etc. into the GraphQL mutation and Linear
 * would reject the request.
 */
const ENVELOPE_MARKER_KEYS = ['provider', 'objectType', 'objectId', 'workspaceId'] as const;
const READ_ONLY_FIELDS = new Set([
  'id',
  'identifier',
  'url',
  'createdAt',
  'updatedAt',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);

function looksLikeSyncedEnvelope(payload: Record<string, unknown>): boolean {
  if (!isRecord(payload.payload)) return false;
  return ENVELOPE_MARKER_KEYS.some((key) => key in payload);
}

/**
 * Fields Linear's `IssueUpdateInput` accepts. We use an explicit allowlist
 * (rather than a denylist) so that synced-file fields the read API returns
 * — `state_name`, `assignee_name`, `priority_label`, `created_at`, `_webhook`,
 * etc. — get silently dropped instead of being forwarded into the mutation
 * and rejected with `Field "X" is not defined by type "IssueUpdateInput"`.
 *
 * Mirrors the field set buildIssueCreate already accepts (which is itself a
 * subset of `IssueCreateInput`), plus update-specific fields that are
 * commonly edited in a synced-file workflow:
 *   - `subscriberIds`     — change watchers
 *   - `sortOrder`         — manual reordering
 *   - `descriptionData`   — Linear's prosemirror-doc form of `description`
 *
 * If you need to set a field not in this list (e.g. `addedLabelIds` /
 * `removedLabelIds` for incremental label changes), add it here and add a
 * regression test in `__tests__/writeback-allowlist.test.ts`.
 */
const ISSUE_UPDATE_ALLOWLIST: ReadonlySet<string> = new Set([
  'title',
  'description',
  'descriptionData',
  'priority',
  'assigneeId',
  'stateId',
  'projectId',
  'cycleId',
  'labelIds',
  'dueDate',
  'estimate',
  'parentId',
  'subscriberIds',
  'sortOrder',
]);

/**
 * Build an `issueUpdate` mutation request for the writeback engine.
 *
 * Accepts two payload shapes:
 *   - the full synced envelope produced by `LinearAdapter.renderContent()`,
 *     with editable fields under `payload`. We unwrap automatically.
 *   - a bare update input where the top-level object IS the input — covers
 *     both hand-written workflow payloads and edits to the synced-file
 *     denormalized read (where the user keeps the full `{state_name,
 *     assignee_name, ...}` envelope and just changes a field). Synced-only
 *     fields are silently dropped via the allowlist.
 */
function buildIssueUpdate(issueId: string, content: string): LinearWritebackRequest {
  const parsed = parseJsonObject(content);
  rejectReadOnlyFields(parsed);
  const source = looksLikeSyncedEnvelope(parsed)
    ? (parsed.payload as Record<string, unknown>)
    : parsed;
  rejectReadOnlyFields(source);

  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!ISSUE_UPDATE_ALLOWLIST.has(key)) continue;
    input[key] = value;
  }
  if (Object.keys(input).length === 0) {
    throw new Error(
      'issues/<id>.json update writeback requires at least one mutable field ' +
        '(see ISSUE_UPDATE_ALLOWLIST in @relayfile/adapter-linear/writeback for the accepted set)',
    );
  }

  return {
    action: 'update_issue',
    method: 'POST',
    endpoint: '/graphql',
    body: { query: ISSUE_UPDATE_MUTATION, variables: { id: issueId, input } },
  };
}

function rejectReadOnlyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
}

/* ------------------------------------------------------------------ *
 * JSON helpers
 * ------------------------------------------------------------------ */

/** Parse `content` as a JSON object, throwing if it isn't an object. */
function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

/**
 * Parse `content` as JSON, falling back to the trimmed raw string when
 * parsing fails. Lets a caller accept both `'"hello"'` and `hello` for
 * plain-text comment bodies.
 */
function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

/** Type guard: is the value a non-array, non-null object? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Return the value at `key` if it is a non-empty string, otherwise `undefined`. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Return the value at `key` if it is a boolean, otherwise `undefined`. */
function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === 'boolean' ? (record[key] as boolean) : undefined;
}

/** Return the value at `key` if it is a finite number, otherwise `undefined`. */
function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
    ? (record[key] as number)
    : undefined;
}

/**
 * Return the value at `key` if it is a non-empty array of strings, otherwise
 * `undefined`. Non-string entries are filtered out.
 */
function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((entry): entry is string => typeof entry === 'string');
  return filtered.length > 0 ? filtered : undefined;
}
