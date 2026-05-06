import type { JsonValue, LinearWritebackRequest } from './types.js';

/**
 * Resolve a relayfile writeback into a Linear GraphQL mutation request.
 *
 * Supported routes (today):
 *   POST /linear/issues/<slug>--<uuid>/comments/new.json   → commentCreate
 *   POST /linear/issues/new.json                            → issueCreate
 *   PATCH/PUT /linear/issues/<slug>--<uuid>.json            → issueUpdate
 *
 * The path-mapper emits issue paths as `<slug>--<32-hex>`. We reverse the
 * suffix to recover the canonical UUID Linear's API requires.
 */
export function resolveWritebackRequest(path: string, content: string): LinearWritebackRequest {
  // Comment on an existing issue.
  const newCommentMatch = path.match(/^\/linear\/issues\/([^/]+)\/comments\/new\.json$/);
  if (newCommentMatch?.[1]) {
    return buildCommentCreate(extractLinearId(newCommentMatch[1]), content);
  }

  // Create a brand-new issue.
  if (path === '/linear/issues/new.json' || path === '/linear/issues/') {
    return buildIssueCreate(content);
  }

  // Update an existing issue's metadata.
  const issueUpdateMatch = path.match(/^\/linear\/issues\/([^/]+)\.json$/);
  if (issueUpdateMatch?.[1]) {
    return buildIssueUpdate(extractLinearId(issueUpdateMatch[1]), content);
  }

  throw new Error(`No Linear writeback rule matched ${path}`);
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

  const slugged32 = /--([0-9a-f]{32})$/i.exec(decoded);
  if (slugged32?.[1]) return formatUuid(slugged32[1]);

  if (/--[0-9a-f]{8}$/i.test(decoded)) {
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
      'comments/new.json writeback expects a JSON object or plain string',
    );
  }

  const body = readString(parsed, 'body');
  if (!body) {
    throw new Error('comments/new.json writeback requires a non-empty `body`');
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

function buildIssueCreate(content: string): LinearWritebackRequest {
  const payload = parseJsonObject(content);
  const teamId = readString(payload, 'teamId');
  if (!teamId) {
    throw new Error('issues/new.json writeback requires a `teamId`');
  }
  const title = readString(payload, 'title');
  if (!title) {
    throw new Error('issues/new.json writeback requires a `title`');
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

function buildIssueUpdate(issueId: string, content: string): LinearWritebackRequest {
  const payload = parseJsonObject(content);
  // Drop server-managed fields if present in the payload.
  const denylist = new Set([
    'id',
    'identifier',
    'createdAt',
    'updatedAt',
    'archivedAt',
    'url',
    'team',
    'creator',
    'parent',
  ]);
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (denylist.has(key)) continue;
    input[key] = value;
  }
  if (Object.keys(input).length === 0) {
    throw new Error('issues/<id>.json update writeback requires at least one mutable field');
  }

  return {
    action: 'update_issue',
    method: 'POST',
    endpoint: '/graphql',
    body: { query: ISSUE_UPDATE_MUTATION, variables: { id: issueId, input } },
  };
}

/* ------------------------------------------------------------------ *
 * JSON helpers
 * ------------------------------------------------------------------ */

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === 'boolean' ? (record[key] as boolean) : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
    ? (record[key] as number)
    : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((entry): entry is string => typeof entry === 'string');
  return filtered.length > 0 ? filtered : undefined;
}
