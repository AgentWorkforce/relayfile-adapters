import { createHash } from 'node:crypto';

import { GMAIL_LEGACY_PATH_ROOTS, GMAIL_PATH_ROOT } from './identity.js';
import type { JsonObject, JsonValue } from './types.js';

/**
 * Adapter-owned control contract for Cloud's canonical `/gmail` Relayfile mount.
 *
 * It is deliberately independent of the storage bridge. The functions here
 * are pure: they have no credentials, provider client, retry behavior, or
 * persistence. A control plane binds the returned request fingerprint to a
 * durable intent before making at most one provider call, and persists only
 * redacted receipt fields. Legacy mounts remain readable elsewhere during
 * migration but are never a write target for this contract.
 */
export const GOOGLE_MAIL_RELAYFILE_CONTROL_VERSION = 1 as const;
export const GOOGLE_MAIL_RELAYFILE_ROOT = GMAIL_PATH_ROOT;

export const GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES = {
  labels: 'https://www.googleapis.com/auth/gmail.labels',
  settingsBasic: 'https://www.googleapis.com/auth/gmail.settings.basic',
  settingsSharing: 'https://www.googleapis.com/auth/gmail.settings.sharing',
  send: 'https://www.googleapis.com/auth/gmail.send',
  modify: 'https://www.googleapis.com/auth/gmail.modify',
  mailGoogle: 'https://mail.google.com/',
} as const;

export type GoogleMailRelayfileResource =
  | 'labels'
  | 'filters'
  | 'send-as'
  | 'messages'
  | 'threads';

export type GoogleMailRelayfileAction =
  | 'create_label'
  | 'update_label'
  | 'delete_label'
  | 'create_filter'
  | 'delete_filter'
  | 'create_send_as'
  | 'update_send_as'
  | 'delete_send_as'
  | 'send_message'
  | 'modify_message'
  | 'delete_message'
  | 'modify_thread'
  | 'delete_thread';

export type GoogleMailRelayfileTargetKind = 'canonical' | 'by-id-alias' | 'draft';

export type GoogleMailRelayfileTarget = {
  requestedPath: string;
  /** Null means the provider assigns the record id and it must be reconciled. */
  canonicalPath: string | null;
  resource: GoogleMailRelayfileResource;
  resourceId: string;
  kind: GoogleMailRelayfileTargetKind;
};

export type GoogleMailRelayfileSafetyClass =
  | 'reversible'
  | 'non-idempotent'
  | 'destructive'
  | 'account-routing';

/**
 * Gmail History is authoritative only for mailbox changes. Labels, filters,
 * and send-as records are settings resources, and Gmail History does not
 * contain their lifecycle changes; they require a bounded settings refresh.
 */
export type GoogleMailRelayfileReconciliationSelector =
  | {
      kind: 'gmail-history';
      resource: 'messages' | 'threads';
      /** Existing target id or an optional provider reference; never message content. */
      targetId: string | null;
    }
  | {
      kind: 'settings-refresh';
      resource: 'labels' | 'filters' | 'send-as';
      /** Existing target id or an optional provider reference; never message content. */
      targetId: string | null;
    };

export type GoogleMailRelayfileActionDefinition = {
  action: GoogleMailRelayfileAction;
  resource: GoogleMailRelayfileResource;
  method: 'DELETE' | 'PATCH' | 'POST';
  safety: GoogleMailRelayfileSafetyClass;
  /** Least-privilege scope set accepted by the Gmail endpoint. */
  minimumOAuthScopes: readonly string[];
  /** Gmail requires a service account with domain-wide delegation for this action. */
  requiresDomainWideDelegation: boolean;
  requiresExactConfirmation: true;
  requiresStatePrecondition: true;
};

/** The complete reviewed agent action surface for the Cloud Google Mail mount. */
export const GOOGLE_MAIL_RELAYFILE_ACTIONS: readonly GoogleMailRelayfileActionDefinition[] = [
  { action: 'create_label', resource: 'labels', method: 'POST', safety: 'non-idempotent', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.labels], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'update_label', resource: 'labels', method: 'PATCH', safety: 'reversible', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.labels], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'delete_label', resource: 'labels', method: 'DELETE', safety: 'destructive', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.labels], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'create_filter', resource: 'filters', method: 'POST', safety: 'account-routing', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.settingsBasic], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'delete_filter', resource: 'filters', method: 'DELETE', safety: 'account-routing', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.settingsBasic], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'create_send_as', resource: 'send-as', method: 'POST', safety: 'account-routing', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.settingsSharing], requiresDomainWideDelegation: true, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'update_send_as', resource: 'send-as', method: 'PATCH', safety: 'account-routing', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.settingsBasic], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'delete_send_as', resource: 'send-as', method: 'DELETE', safety: 'account-routing', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.settingsSharing], requiresDomainWideDelegation: true, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'send_message', resource: 'messages', method: 'POST', safety: 'non-idempotent', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.send], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'modify_message', resource: 'messages', method: 'POST', safety: 'reversible', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.modify], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'delete_message', resource: 'messages', method: 'DELETE', safety: 'destructive', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.mailGoogle], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'modify_thread', resource: 'threads', method: 'POST', safety: 'reversible', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.modify], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
  { action: 'delete_thread', resource: 'threads', method: 'DELETE', safety: 'destructive', minimumOAuthScopes: [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.mailGoogle], requiresDomainWideDelegation: false, requiresExactConfirmation: true, requiresStatePrecondition: true },
] as const;

/** Explicitly excluded until an operator-specific contract is reviewed. */
export const GOOGLE_MAIL_RELAYFILE_OPERATOR_ONLY_FAMILIES = [
  'delegates',
  'forwarding',
  'vacation',
  'imap',
  'pop',
  'language',
  'send-as-smtp',
  'smime',
  'client-side-encryption',
  'watch-lifecycle',
  'import-insert',
  'batch-mutations',
] as const;

export type GoogleMailRelayfileWritebackInput = {
  path: string;
  operation: 'upsert' | 'delete';
  /** Parsed only transiently and never suitable for an operation/receipt audit record. */
  content?: string;
};

/**
 * The normalized, execution-ready request. It remains provider-call free.
 * `payloadFingerprint` binds the approved action, request shape, and target.
 */
export type GoogleMailRelayfileResolvedRequest = {
  version: typeof GOOGLE_MAIL_RELAYFILE_CONTROL_VERSION;
  target: GoogleMailRelayfileTarget;
  action: GoogleMailRelayfileAction;
  method: 'DELETE' | 'PATCH' | 'POST';
  endpoint: string;
  body: JsonObject | null;
  payloadFingerprint: string;
  safety: GoogleMailRelayfileActionDefinition;
  reconciliation: GoogleMailRelayfileReconciliationSelector;
};

/** @deprecated Use GoogleMailRelayfileResolvedRequest. */
export type GoogleMailRelayfileExecutionEnvelope = GoogleMailRelayfileResolvedRequest;

const RESOURCES = new Set<GoogleMailRelayfileResource>([
  'labels', 'filters', 'send-as', 'messages', 'threads',
]);
const SYSTEM_LABEL_IDS = new Set([
  'CHAT', 'CATEGORY_FORUMS', 'CATEGORY_PERSONAL', 'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'DRAFT', 'IMPORTANT', 'INBOX',
  'SENT', 'SPAM', 'STARRED', 'TRASH', 'UNREAD',
  'BLUE_CIRCLE', 'GREEN_CIRCLE', 'ORANGE_CIRCLE', 'PURPLE_CIRCLE',
  'RED_CIRCLE', 'YELLOW_CIRCLE', 'BLUE_STAR', 'GREEN_STAR', 'ORANGE_STAR',
  'PURPLE_STAR', 'RED_STAR', 'YELLOW_STAR',
]);
const IMMUTABLE_MESSAGE_LABEL_IDS = new Set(['DRAFT', 'SENT']);
const DRAFT_FILE_RE = /^(?:draft|create|new|tmp|temp)(?:[._-]|$)/i;
const RESERVED_IDS = new Set(['_index', 'meta', 'metadata', '.', '..']);
const LABEL_MESSAGE_LIST_VISIBILITY = new Set(['show', 'hide']);
const LABEL_LIST_VISIBILITY = new Set(['labelShow', 'labelShowIfUnread', 'labelHide']);
const GMAIL_LABEL_COLORS = new Set([
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#efefef', '#f3f3f3', '#ffffff',
  '#fb4c2f', '#ffad47', '#fad165', '#16a766', '#43d692', '#4a86e8', '#a479e2', '#f691b3',
  '#f6c5be', '#ffe6c7', '#fef1d1', '#b9e4d0', '#c6f3de', '#c9daf8', '#e4d7f5', '#fcdee8',
  '#efa093', '#ffd6a2', '#fce8b3', '#89d3b2', '#a0eac9', '#a4c2f4', '#d0bcf1', '#fbc8d9',
  '#e66550', '#ffbc6b', '#fcda83', '#44b984', '#68dfa9', '#6d9eeb', '#b694e8', '#f7a7c0',
  '#cc3a21', '#eaa041', '#f2c960', '#149e60', '#3dc789', '#3c78d8', '#8e63ce', '#e07798',
  '#ac2b16', '#cf8933', '#d5ae49', '#0b804b', '#2a9c68', '#285bac', '#653e9b', '#b65775',
  '#822111', '#a46a21', '#aa8831', '#076239', '#1a764d', '#1c4587', '#41236d', '#83334c',
  '#464646', '#e7e7e7', '#0d3472', '#b6cff5', '#0d3b44', '#98d7e4', '#3d188e', '#e3d7ff',
  '#711a36', '#fbd3e0', '#8a1c0a', '#f2b2a8', '#7a2e0b', '#ffc8af', '#7a4706', '#ffdeb5',
  '#594c05', '#fbe983', '#684e07', '#fdedc1', '#0b4f30', '#b3efd3', '#04502e', '#a2dcc1',
  '#c2c2c2', '#4986e7', '#2da2bb', '#b99aff', '#994a64', '#f691b2', '#ff7537', '#ffad46',
  '#662e37', '#ebdbde', '#cca6ac', '#094228', '#42d692', '#16a765',
]);
const FILTER_SIZE_COMPARISONS = new Set(['larger', 'smaller']);
const FILTER_CRITERIA_FIELDS = [
  'from', 'to', 'subject', 'query', 'negatedQuery', 'hasAttachment',
  'excludeChats', 'size', 'sizeComparison',
] as const;
const FILTER_ACTION_FIELDS = ['addLabelIds', 'removeLabelIds', 'forward'] as const;
const LABEL_MUTABLE_FIELDS = ['name', 'messageListVisibility', 'labelListVisibility', 'textColor', 'backgroundColor'] as const;
const SEND_AS_MUTABLE_FIELDS = ['displayName', 'replyToAddress', 'signature', 'isDefault', 'treatAsAlias'] as const;
const LABEL_MUTATION_FIELDS = ['addLabelIds', 'removeLabelIds'] as const;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertAllowedKeys(value: JsonObject, allowed: readonly string[], context: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${context} contains unsupported field \`${key}\``);
    }
  }
}

function stringValue(value: JsonValue | undefined, context: string, allowEmpty = false): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${context} must be a string`);
  if (!allowEmpty && !value.trim()) throw new Error(`${context} must be a non-empty string`);
  return allowEmpty ? value : value.trim();
}

function requiredString(value: JsonValue | undefined, context: string): string {
  const result = stringValue(value, context);
  if (result === undefined) throw new Error(`${context} is required`);
  return result;
}

function booleanValue(value: JsonValue | undefined, context: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${context} must be a boolean`);
  return value;
}

function nonNegativeInteger(value: JsonValue | undefined, context: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
  return value;
}

function appendIfDefined(target: JsonObject, key: string, value: JsonValue | undefined): void {
  if (value !== undefined) target[key] = value;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isCanonicalLabelId(id: string): boolean {
  return /^Label_\d+$/u.test(id) || SYSTEM_LABEL_IDS.has(id);
}

/**
 * Gmail exposes system labels at the same canonical mount as user labels, but
 * it does not permit them to be changed or deleted.  Keep that provider rule
 * in the pure mapping so a durable executor never makes a doomed (and, for a
 * delete intent, needlessly alarming) control-plane request.
 */
function isMutableUserLabelId(id: string): boolean {
  return /^Label_\d+$/u.test(id);
}

function isDraftLike(resource: GoogleMailRelayfileResource, id: string): boolean {
  // Send-as creation uses a draft filename, but a canonical send-as id is an
  // email address and may legitimately start with `new`, `draft`, or `temp`.
  if (resource === 'send-as' && id.includes('@')) return false;
  return DRAFT_FILE_RE.test(id);
}

function normalizePath(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes('%') || path.includes('\\')) {
    throw new Error('Google Mail Relayfile target must be an absolute unencoded path');
  }
  if (path.includes('//') || path.includes('/./') || path.includes('/../')) {
    throw new Error('Google Mail Relayfile target contains an unsafe segment');
  }
  if (GMAIL_LEGACY_PATH_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) {
    throw new Error('Google Mail Relayfile writeback requires a canonical /gmail path; resync the legacy mount first');
  }
  return path;
}

function canonicalPath(resource: GoogleMailRelayfileResource, id: string): string {
  return `${GOOGLE_MAIL_RELAYFILE_ROOT}/${resource}/${id}.json`;
}

/** Parses one approved canonical resource path or a bounded by-id alias. */
export function resolveGoogleMailRelayfileTarget(path: string): GoogleMailRelayfileTarget {
  const requestedPath = normalizePath(path);
  const canonicalMatch = requestedPath.match(new RegExp(
    `^${GOOGLE_MAIL_RELAYFILE_ROOT}/(labels|filters|send-as|messages|threads)/([^/]+)\\.json$`,
    'u',
  ));
  const aliasMatch = requestedPath.match(new RegExp(
    `^${GOOGLE_MAIL_RELAYFILE_ROOT}/(messages|threads)/by-id/([^/]+)\\.json$`,
    'u',
  ));
  const match = canonicalMatch ?? aliasMatch;
  if (!match?.[1] || !match[2] || !RESOURCES.has(match[1] as GoogleMailRelayfileResource)) {
    throw new Error('Google Mail Relayfile target is not a supported canonical resource or by-id alias');
  }
  const resource = match[1] as GoogleMailRelayfileResource;
  const resourceId = match[2];
  // Send-as identifiers are email addresses, so literal `@` and `+` are valid.
  // Encoded aliases are forbidden above to preserve one unambiguous target.
  if (!/^[A-Za-z0-9_.:@+-]+$/u.test(resourceId) || RESERVED_IDS.has(resourceId)) {
    throw new Error('Google Mail Relayfile target id is invalid');
  }
  const kind: GoogleMailRelayfileTargetKind = aliasMatch
    ? 'by-id-alias'
    : isDraftLike(resource, resourceId) ? 'draft' : 'canonical';
  return {
    requestedPath,
    canonicalPath: kind === 'draft' ? null : canonicalPath(resource, resourceId),
    resource,
    resourceId,
    kind,
  };
}

/** A SHA-256 over the exact canonicalized ephemeral provider request. */
export function fingerprintGoogleMailRelayfilePayload(input: {
  action: GoogleMailRelayfileAction;
  endpoint: string;
  body: JsonObject | null;
  target: GoogleMailRelayfileTarget;
}): string {
  return sha256(canonicalJson({
    version: GOOGLE_MAIL_RELAYFILE_CONTROL_VERSION,
    action: input.action,
    method: actionDefinition(input.action).method,
    endpoint: input.endpoint,
    body: input.body,
    target: {
      requestedPath: input.target.requestedPath,
      canonicalPath: input.target.canonicalPath,
      resource: input.target.resource,
      resourceId: input.target.resourceId,
      kind: input.target.kind,
    },
  }));
}

function parsePayload(content: string | undefined): JsonObject {
  if (content === undefined || !content.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw new Error('Google Mail Relayfile writeback requires a JSON object payload');
  }
  if (!isRecord(value)) throw new Error('Google Mail Relayfile writeback requires a JSON object payload');
  if (value.smtpMsa !== undefined) {
    throw new Error('Google Mail SMTP credentials are operator-only and cannot enter Relayfile writeback');
  }
  return value;
}

function actionDefinition(action: GoogleMailRelayfileAction): GoogleMailRelayfileActionDefinition {
  const definition = GOOGLE_MAIL_RELAYFILE_ACTIONS.find((candidate) => candidate.action === action);
  if (!definition) throw new Error(`Unknown Google Mail Relayfile action: ${action}`);
  return definition;
}

function reconciliationSelector(
  target: GoogleMailRelayfileTarget,
  targetId: string | null,
): GoogleMailRelayfileReconciliationSelector {
  if (target.resource === 'messages' || target.resource === 'threads') {
    return { kind: 'gmail-history', resource: target.resource, targetId };
  }
  return { kind: 'settings-refresh', resource: target.resource, targetId };
}

function envelope(input: {
  target: GoogleMailRelayfileTarget;
  action: GoogleMailRelayfileAction;
  endpoint: string;
  body: JsonObject | null;
  targetId?: string | null;
}): GoogleMailRelayfileResolvedRequest {
  const safety = actionDefinition(input.action);
  const target = input.target;
  return {
    version: GOOGLE_MAIL_RELAYFILE_CONTROL_VERSION,
    target,
    action: input.action,
    method: safety.method,
    endpoint: input.endpoint,
    body: input.body,
    payloadFingerprint: fingerprintGoogleMailRelayfilePayload({
      action: input.action,
      endpoint: input.endpoint,
      body: input.body,
      target,
    }),
    safety,
    reconciliation: reconciliationSelector(
      target,
      input.targetId ?? (target.kind === 'draft' ? null : target.resourceId),
    ),
  };
}

function draftTarget(target: GoogleMailRelayfileTarget): GoogleMailRelayfileTarget {
  return { ...target, canonicalPath: null, kind: 'draft' };
}

function requireCanonicalTarget(target: GoogleMailRelayfileTarget, message: string): void {
  if (target.kind === 'draft' || !target.canonicalPath) throw new Error(message);
}

function requireDraftTarget(target: GoogleMailRelayfileTarget, message: string): void {
  if (target.kind !== 'draft') throw new Error(message);
}

function assertExactIdentity(payload: JsonObject, key: string, targetId: string, context: string): void {
  const identity = stringValue(payload[key], `${context}.${key}`);
  if (identity !== undefined && identity !== targetId) {
    throw new Error(`${context}.${key} must match the target id`);
  }
}

function validEmail(value: string, context: string): string {
  if (!/^[^\s@]+@[^\s@]+$/u.test(value)) throw new Error(`${context} must be an email address`);
  return value;
}

function labelIds(value: JsonValue | undefined, context: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${context} must be a non-empty array of label ids`);
  if (value.length > 100) throw new Error(`${context} cannot contain more than 100 label ids`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(entry)) {
      throw new Error(`${context}[${index}] must be a Gmail label id`);
    }
    if (IMMUTABLE_MESSAGE_LABEL_IDS.has(entry)) {
      throw new Error(`${context}[${index}] is a Gmail-managed label and cannot be changed`);
    }
    if (seen.has(entry)) throw new Error(`${context} cannot contain duplicate label ids`);
    seen.add(entry);
    return entry;
  });
}

function assertDisjointLabelMutations(
  addLabelIds: readonly string[] | undefined,
  removeLabelIds: readonly string[] | undefined,
  context: string,
): void {
  if (!addLabelIds || !removeLabelIds) return;
  const added = new Set(addLabelIds);
  if (removeLabelIds.some((labelId) => added.has(labelId))) {
    throw new Error(`${context} cannot add and remove the same label id`);
  }
}

function labelMutationBody(payload: JsonObject, context: string): JsonObject {
  assertAllowedKeys(payload, ['id', ...LABEL_MUTATION_FIELDS], context);
  const body: JsonObject = {};
  const addLabelIds = labelIds(payload.addLabelIds, `${context}.addLabelIds`);
  const removeLabelIds = labelIds(payload.removeLabelIds, `${context}.removeLabelIds`);
  assertDisjointLabelMutations(addLabelIds, removeLabelIds, context);
  appendIfDefined(body, 'addLabelIds', addLabelIds);
  appendIfDefined(body, 'removeLabelIds', removeLabelIds);
  if (Object.keys(body).length === 0) throw new Error(`${context} requires addLabelIds or removeLabelIds`);
  return body;
}

function labelBody(payload: JsonObject, target: GoogleMailRelayfileTarget, create: boolean): JsonObject {
  assertAllowedKeys(payload, create ? LABEL_MUTABLE_FIELDS : ['id', ...LABEL_MUTABLE_FIELDS], 'Google Mail label payload');
  if (!create) assertExactIdentity(payload, 'id', target.resourceId, 'Google Mail label payload');
  const body: JsonObject = {};
  const name = stringValue(payload.name, 'Google Mail label payload.name');
  if (create && name === undefined) throw new Error('Google Mail label creation requires a name');
  if (create && name !== undefined && SYSTEM_LABEL_IDS.has(name)) {
    throw new Error('Google Mail label creation cannot use a reserved system label name');
  }
  appendIfDefined(body, 'name', name);

  const messageListVisibility = stringValue(payload.messageListVisibility, 'Google Mail label payload.messageListVisibility');
  if (messageListVisibility !== undefined && !LABEL_MESSAGE_LIST_VISIBILITY.has(messageListVisibility)) {
    throw new Error('Google Mail label payload.messageListVisibility is invalid');
  }
  appendIfDefined(body, 'messageListVisibility', messageListVisibility);

  const labelListVisibility = stringValue(payload.labelListVisibility, 'Google Mail label payload.labelListVisibility');
  if (labelListVisibility !== undefined && !LABEL_LIST_VISIBILITY.has(labelListVisibility)) {
    throw new Error('Google Mail label payload.labelListVisibility is invalid');
  }
  appendIfDefined(body, 'labelListVisibility', labelListVisibility);

  const textColor = stringValue(payload.textColor, 'Google Mail label payload.textColor');
  const backgroundColor = stringValue(payload.backgroundColor, 'Google Mail label payload.backgroundColor');
  if (textColor !== undefined || backgroundColor !== undefined) {
    if (textColor === undefined || backgroundColor === undefined) {
      throw new Error('Google Mail label color requires both textColor and backgroundColor');
    }
    if (!GMAIL_LABEL_COLORS.has(textColor) || !GMAIL_LABEL_COLORS.has(backgroundColor)) {
      throw new Error('Google Mail label colors must use Gmail predefined values');
    }
    body.color = { textColor, backgroundColor };
  }
  if (!create && Object.keys(body).length === 0) throw new Error('Google Mail label update requires a mutable field');
  return body;
}

function filterCriteria(value: JsonObject): JsonObject {
  assertAllowedKeys(value, FILTER_CRITERIA_FIELDS, 'Google Mail filter criteria');
  const result: JsonObject = {};
  for (const key of ['from', 'to', 'subject', 'query', 'negatedQuery'] as const) {
    appendIfDefined(result, key, stringValue(value[key], `Google Mail filter criteria.${key}`));
  }
  for (const key of ['hasAttachment', 'excludeChats'] as const) {
    appendIfDefined(result, key, booleanValue(value[key], `Google Mail filter criteria.${key}`));
  }
  appendIfDefined(result, 'size', nonNegativeInteger(value.size, 'Google Mail filter criteria.size'));
  const sizeComparison = stringValue(value.sizeComparison, 'Google Mail filter criteria.sizeComparison');
  if (sizeComparison !== undefined && !FILTER_SIZE_COMPARISONS.has(sizeComparison)) {
    throw new Error('Google Mail filter criteria.sizeComparison is invalid');
  }
  if (sizeComparison !== undefined && result.size === undefined) {
    throw new Error('Google Mail filter criteria.sizeComparison requires size');
  }
  appendIfDefined(result, 'sizeComparison', sizeComparison);
  if (Object.keys(result).length === 0) throw new Error('Google Mail filter create requires non-empty criteria');
  return result;
}

function filterAction(value: JsonObject): JsonObject {
  assertAllowedKeys(value, FILTER_ACTION_FIELDS, 'Google Mail filter action');
  const result: JsonObject = {};
  const addLabelIds = labelIds(value.addLabelIds, 'Google Mail filter action.addLabelIds');
  const removeLabelIds = labelIds(value.removeLabelIds, 'Google Mail filter action.removeLabelIds');
  assertDisjointLabelMutations(addLabelIds, removeLabelIds, 'Google Mail filter action');
  appendIfDefined(result, 'addLabelIds', addLabelIds);
  appendIfDefined(result, 'removeLabelIds', removeLabelIds);
  const forward = stringValue(value.forward, 'Google Mail filter action.forward');
  if (forward !== undefined) result.forward = validEmail(forward, 'Google Mail filter action.forward');
  if (Object.keys(result).length === 0) throw new Error('Google Mail filter create requires non-empty action');
  return result;
}

function filterBody(payload: JsonObject): JsonObject {
  const hasNestedFields = payload.criteria !== undefined || payload.action !== undefined;
  if (hasNestedFields) {
    assertAllowedKeys(payload, ['criteria', 'action'], 'Google Mail filter payload');
    if (!isRecord(payload.criteria) || !isRecord(payload.action)) {
      throw new Error('Google Mail filter payload requires object criteria and action');
    }
    return { criteria: filterCriteria(payload.criteria), action: filterAction(payload.action) };
  }
  assertAllowedKeys(payload, [...FILTER_CRITERIA_FIELDS, ...FILTER_ACTION_FIELDS], 'Google Mail filter payload');
  const criteria: JsonObject = {};
  const action: JsonObject = {};
  for (const key of FILTER_CRITERIA_FIELDS) {
    if (payload[key] !== undefined) criteria[key] = payload[key];
  }
  for (const key of FILTER_ACTION_FIELDS) {
    if (payload[key] !== undefined) action[key] = payload[key];
  }
  return { criteria: filterCriteria(criteria), action: filterAction(action) };
}

function sendAsBody(payload: JsonObject, target: GoogleMailRelayfileTarget, create: boolean): JsonObject {
  const allowed = create
    ? ['sendAsEmail', ...SEND_AS_MUTABLE_FIELDS]
    : ['id', 'sendAsEmail', ...SEND_AS_MUTABLE_FIELDS];
  assertAllowedKeys(payload, allowed, 'Google Mail send-as payload');
  if (!create) {
    assertExactIdentity(payload, 'id', target.resourceId, 'Google Mail send-as payload');
    assertExactIdentity(payload, 'sendAsEmail', target.resourceId, 'Google Mail send-as payload');
  }
  const body: JsonObject = {};
  if (create) {
    body.sendAsEmail = validEmail(requiredString(payload.sendAsEmail, 'Google Mail send-as payload.sendAsEmail'), 'Google Mail send-as payload.sendAsEmail');
  }
  appendIfDefined(body, 'displayName', stringValue(payload.displayName, 'Google Mail send-as payload.displayName', true));
  const replyToAddress = stringValue(payload.replyToAddress, 'Google Mail send-as payload.replyToAddress', true);
  if (replyToAddress !== undefined) body.replyToAddress = replyToAddress === '' ? '' : validEmail(replyToAddress, 'Google Mail send-as payload.replyToAddress');
  appendIfDefined(body, 'signature', stringValue(payload.signature, 'Google Mail send-as payload.signature', true));
  const isDefault = booleanValue(payload.isDefault, 'Google Mail send-as payload.isDefault');
  if (isDefault === false) throw new Error('Google Mail send-as payload.isDefault may only be true');
  appendIfDefined(body, 'isDefault', isDefault);
  appendIfDefined(body, 'treatAsAlias', booleanValue(payload.treatAsAlias, 'Google Mail send-as payload.treatAsAlias'));
  if (!create && Object.keys(body).length === 0) throw new Error('Google Mail send-as update requires a mutable field');
  return body;
}

function isBase64Url(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+={0,2}$/u.test(value)) return false;
  const unpaddedLength = value.replace(/=+$/u, '').length;
  const paddingLength = value.length - unpaddedLength;
  if (unpaddedLength % 4 === 1) return false;
  return paddingLength === 0 || (value.length % 4 === 0 && paddingLength === (4 - (unpaddedLength % 4)) % 4);
}

function messageSendBody(payload: JsonObject): JsonObject {
  assertAllowedKeys(payload, ['raw', 'threadId'], 'Google Mail message send payload');
  const raw = requiredString(payload.raw, 'Google Mail message send payload.raw');
  if (!isBase64Url(raw)) throw new Error('Gmail send requires base64url RFC 2822 raw content');
  const body: JsonObject = { raw };
  const threadId = stringValue(payload.threadId, 'Google Mail message send payload.threadId');
  if (threadId !== undefined) {
    if (!/^[A-Za-z0-9_-]+$/u.test(threadId)) throw new Error('Google Mail message send payload.threadId is invalid');
    body.threadId = threadId;
  }
  return body;
}

function validateInput(input: GoogleMailRelayfileWritebackInput): void {
  if (!input || (input.operation !== 'upsert' && input.operation !== 'delete')) {
    throw new Error('Google Mail Relayfile writeback operation must be upsert or delete');
  }
  if (input.content !== undefined && typeof input.content !== 'string') {
    throw new Error('Google Mail Relayfile writeback content must be a string');
  }
}

/**
 * Resolves one mounted file operation into the adapter-owned request shape.
 * It cannot make a Gmail request and it never accepts a broad path or ignored
 * payload field. Durable callers must bind the fingerprint before submission.
 */
export function resolveGoogleMailRelayfileWriteback(
  input: GoogleMailRelayfileWritebackInput,
): GoogleMailRelayfileResolvedRequest {
  validateInput(input);
  const target = resolveGoogleMailRelayfileTarget(input.path);
  if (input.operation === 'delete') {
    if (input.content?.trim()) throw new Error('Google Mail delete writeback must not include a payload');
    requireCanonicalTarget(target, 'Google Mail deletion requires a resolved canonical target');
    switch (target.resource) {
      case 'labels':
        if (!isMutableUserLabelId(target.resourceId)) throw new Error('Google Mail system labels cannot be deleted');
        return envelope({ target, action: 'delete_label', endpoint: `/gmail/v1/users/me/labels/${encodeURIComponent(target.resourceId)}`, body: null });
      case 'filters':
        return envelope({ target, action: 'delete_filter', endpoint: `/gmail/v1/users/me/settings/filters/${encodeURIComponent(target.resourceId)}`, body: null });
      case 'send-as':
        return envelope({ target, action: 'delete_send_as', endpoint: `/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(target.resourceId)}`, body: null });
      case 'messages':
        return envelope({ target, action: 'delete_message', endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(target.resourceId)}`, body: null });
      case 'threads':
        return envelope({ target, action: 'delete_thread', endpoint: `/gmail/v1/users/me/threads/${encodeURIComponent(target.resourceId)}`, body: null });
    }
  }

  const payload = parsePayload(input.content);
  switch (target.resource) {
    case 'labels': {
      const create = !isCanonicalLabelId(target.resourceId);
      if (create) requireDraftTarget(target, 'Google Mail label creation requires a draft target');
      if (!create) requireCanonicalTarget(target, 'Google Mail label update requires a canonical target');
      if (!create && !isMutableUserLabelId(target.resourceId)) {
        throw new Error('Google Mail system labels cannot be updated');
      }
      const body = labelBody(payload, target, create);
      return create
        ? envelope({ target: draftTarget(target), action: 'create_label', endpoint: '/gmail/v1/users/me/labels', body, targetId: null })
        : envelope({ target, action: 'update_label', endpoint: `/gmail/v1/users/me/labels/${encodeURIComponent(target.resourceId)}`, body });
    }
    case 'filters': {
      requireDraftTarget(target, 'Gmail filters cannot be updated in place; use a confirmed delete then create');
      return envelope({ target: draftTarget(target), action: 'create_filter', endpoint: '/gmail/v1/users/me/settings/filters', body: filterBody(payload), targetId: null });
    }
    case 'send-as': {
      const create = target.kind === 'draft';
      if (!create) requireCanonicalTarget(target, 'Google Mail send-as update requires a canonical target');
      const body = sendAsBody(payload, target, create);
      return create
        ? envelope({ target: draftTarget(target), action: 'create_send_as', endpoint: '/gmail/v1/users/me/settings/sendAs', body, targetId: null })
        : envelope({ target, action: 'update_send_as', endpoint: `/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(target.resourceId)}`, body });
    }
    case 'messages': {
      if (target.kind === 'draft') {
        const body = messageSendBody(payload);
        return envelope({ target: draftTarget(target), action: 'send_message', endpoint: '/gmail/v1/users/me/messages/send', body, targetId: stringValue(body.threadId, 'Google Mail message send body.threadId') ?? null });
      }
      requireCanonicalTarget(target, 'Google Mail message update requires a canonical target');
      assertExactIdentity(payload, 'id', target.resourceId, 'Google Mail message update payload');
      return envelope({
        target,
        action: 'modify_message',
        endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(target.resourceId)}/modify`,
        body: labelMutationBody(payload, 'Google Mail message update payload'),
      });
    }
    case 'threads': {
      requireCanonicalTarget(target, 'Google Mail thread update requires a canonical target');
      assertExactIdentity(payload, 'id', target.resourceId, 'Google Mail thread update payload');
      return envelope({
        target,
        action: 'modify_thread',
        endpoint: `/gmail/v1/users/me/threads/${encodeURIComponent(target.resourceId)}/modify`,
        body: labelMutationBody(payload, 'Google Mail thread update payload'),
      });
    }
  }
}

/** Backward-compatible name for the pure request resolver. */
export function normalizeGoogleMailRelayfileWriteback(
  input: GoogleMailRelayfileWritebackInput,
): GoogleMailRelayfileResolvedRequest {
  return resolveGoogleMailRelayfileWriteback(input);
}
