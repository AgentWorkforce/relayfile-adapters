import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './jira-adapter.js';
import type { JiraAdapterConfig } from './types.js';

export const JIRA_PROVIDER = 'jira';
export const JIRA_AUTHORIZATION_HEADER = 'authorization';
export const JIRA_DELIVERY_HEADER = 'x-atlassian-webhook-identifier';
export const JIRA_EVENT_HEADER = 'x-atlassian-webhook-event';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-jira-connection-id',
  'jira-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-jira-provider',
  'jira-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-jira-provider-config-key',
  'jira-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = [
  'x-request-id',
  'x-correlation-id',
  'x-relay-request-id',
] as const;

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;
type JiraRecord = Record<string, unknown>;

export type JiraWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface AtlassianJwtClaims {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  qsh?: string;
  sub?: string;
  [claim: string]: unknown;
}

export interface JiraWebhookNormalizerOptions {
  config: JiraAdapterConfig;
  headers?: JiraWebhookHeaders;
  method?: string;
  path?: string;
  query?: URLSearchParams | Record<string, readonly string[] | string | undefined> | string;
  nowSeconds?: number;
}

export interface JiraWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  webhookEvent?: string;
}

export interface JiraWebhookSignatureValidationResult {
  claims?: AtlassianJwtClaims;
  expectedQsh?: string;
  ok: boolean;
  reason?:
    | 'expired'
    | 'invalid-algorithm'
    | 'invalid-iss'
    | 'invalid-qsh'
    | 'invalid-signature'
    | 'issued-in-future'
    | 'malformed-jwt'
    | 'missing-authorization'
    | 'missing-exp'
    | 'missing-iat'
    | 'missing-iss'
    | 'missing-qsh'
    | 'missing-secret';
}

/**
 * Default clock skew tolerance for `exp` and `iat` validation. Atlassian
 * recommends "no more than a few minutes"; 180s sits in the middle of that
 * range and tolerates modest server clock drift without accepting stale
 * tokens. Override per-deployment via `JiraAdapterConfig.clockSkewSeconds`.
 */
export const DEFAULT_JIRA_CLOCK_SKEW_SECONDS = 180;

interface DecodedJwt {
  claims: AtlassianJwtClaims;
  encodedHeader: string;
  encodedPayload: string;
  signature: string;
}

export function normalizeJiraWebhook(
  rawPayload: unknown,
  options: JiraWebhookNormalizerOptions,
): NormalizedWebhook {
  const payload = parseJiraWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(options.headers ?? {});
  const authorization = readOptionalString(normalizedHeaders[JIRA_AUTHORIZATION_HEADER]);
  const verificationInput: {
    authorization?: string;
    clientKey?: string;
    clockSkewSeconds?: number;
    method: string;
    nowSeconds?: number;
    path: string;
    query?: URLSearchParams | Record<string, readonly string[] | string | undefined> | string;
    sharedSecret?: string;
  } = {
    method: options.method ?? 'POST',
    path: options.path ?? '/',
  };
  if (authorization) verificationInput.authorization = authorization;
  if (options.nowSeconds !== undefined) verificationInput.nowSeconds = options.nowSeconds;
  if (options.query !== undefined) verificationInput.query = options.query;
  if (options.config.sharedSecret) verificationInput.sharedSecret = options.config.sharedSecret;
  if (options.config.clientKey) verificationInput.clientKey = options.config.clientKey;
  if (options.config.clockSkewSeconds !== undefined) {
    verificationInput.clockSkewSeconds = options.config.clockSkewSeconds;
  }
  const validation = verifyAtlassianConnectJwt(verificationInput);
  if (!validation.ok) {
    throw new Error(`Invalid Jira webhook JWT: ${validation.reason ?? 'unknown'}`);
  }

  const objectType = extractJiraObjectType(payload);
  const objectId = extractJiraObjectId(payload, objectType);
  const eventType = extractJiraEventType(payload, normalizedHeaders, objectType);
  const connection = extractJiraConnectionMetadata(payload, normalizedHeaders, options.config);
  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: buildNormalizedPayload(payload, connection, validation.claims, {
      eventType,
      objectId,
      objectType,
    }),
  };

  if (connection.connectionId) {
    normalized.connectionId = connection.connectionId;
  }

  return normalized;
}

export function verifyAtlassianConnectJwt(input: {
  authorization?: string;
  clientKey?: string;
  clockSkewSeconds?: number;
  method: string;
  nowSeconds?: number;
  path: string;
  query?: URLSearchParams | Record<string, readonly string[] | string | undefined> | string;
  sharedSecret?: string;
}): JiraWebhookSignatureValidationResult {
  if (!input.sharedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const token = extractJwtToken(input.authorization);
  if (!token) {
    return { ok: false, reason: 'missing-authorization' };
  }

  const decoded = decodeJwt(token);
  if (!decoded) {
    return { ok: false, reason: 'malformed-jwt' };
  }

  const header = decodeJsonSegment(decoded.encodedHeader);
  if (!isRecord(header) || header.alg !== 'HS256') {
    return { ok: false, reason: 'invalid-algorithm' };
  }

  const signingInput = `${decoded.encodedHeader}.${decoded.encodedPayload}`;
  const expectedSignature = hmacSha256Base64Url(signingInput, input.sharedSecret);
  if (!safeEqualBase64Url(expectedSignature, decoded.signature)) {
    return { ok: false, claims: decoded.claims, reason: 'invalid-signature' };
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skewSeconds = input.clockSkewSeconds ?? DEFAULT_JIRA_CLOCK_SKEW_SECONDS;

  // `iss` is mandatory per Atlassian Connect; without checking it, a leaked
  // sharedSecret could be used to mint tokens under arbitrary issuers. We
  // only enforce when the caller has configured `clientKey`; that allows
  // the adapter to keep working in environments that don't bind a single
  // issuer (e.g. tenant-per-row orgs), while still flagging the soft
  // requirement.
  if (typeof decoded.claims.iss !== 'string' || decoded.claims.iss.length === 0) {
    return { ok: false, claims: decoded.claims, reason: 'missing-iss' };
  }
  if (input.clientKey && decoded.claims.iss !== input.clientKey) {
    return { ok: false, claims: decoded.claims, reason: 'invalid-iss' };
  }

  // `iat` is mandatory per spec; reject tokens issued meaningfully in the
  // future (beyond clock skew). `iat` from the past is fine — only `exp`
  // bounds the upper edge of the validity window.
  if (typeof decoded.claims.iat !== 'number') {
    return { ok: false, claims: decoded.claims, reason: 'missing-iat' };
  }
  if (decoded.claims.iat > nowSeconds + skewSeconds) {
    return { ok: false, claims: decoded.claims, reason: 'issued-in-future' };
  }

  if (typeof decoded.claims.exp !== 'number') {
    return { ok: false, claims: decoded.claims, reason: 'missing-exp' };
  }
  if (nowSeconds > decoded.claims.exp + skewSeconds) {
    return { ok: false, claims: decoded.claims, reason: 'expired' };
  }

  if (typeof decoded.claims.qsh !== 'string' || decoded.claims.qsh.length === 0) {
    return { ok: false, claims: decoded.claims, reason: 'missing-qsh' };
  }

  const qshInput: {
    method: string;
    path: string;
    query?: URLSearchParams | Record<string, readonly string[] | string | undefined> | string;
  } = {
    method: input.method,
    path: input.path,
  };
  if (input.query !== undefined) qshInput.query = input.query;
  const expectedQsh = computeAtlassianQueryStringHash(qshInput);
  if (!safeEqualString(expectedQsh, decoded.claims.qsh)) {
    return {
      ok: false,
      claims: decoded.claims,
      expectedQsh,
      reason: 'invalid-qsh',
    };
  }

  return {
    ok: true,
    claims: decoded.claims,
    expectedQsh,
  };
}

export function computeAtlassianQueryStringHash(input: {
  method: string;
  path: string;
  query?: URLSearchParams | Record<string, readonly string[] | string | undefined> | string;
}): string {
  return createHash('sha256')
    .update(canonicalizeAtlassianRequest(input), 'utf8')
    .digest('hex');
}

export function canonicalizeAtlassianRequest(input: {
  method: string;
  path: string;
  query?: URLSearchParams | Record<string, readonly string[] | string | undefined> | string;
}): string {
  const method = input.method.trim().toUpperCase();
  const path = canonicalizePath(input.path);
  const query = canonicalizeQuery(input.query);
  return `${method}&${path}&${query}`;
}

export function parseJiraWebhookPayload(rawPayload: unknown): JiraRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Jira webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractJiraConnectionMetadata(
  payload: unknown,
  headers: JiraWebhookHeaders = {},
  config: JiraAdapterConfig = {},
): JiraWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseJiraWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: JiraWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(config.provider) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      JIRA_PROVIDER,
  };

  const connectionId =
    readHeaderValue(normalizedHeaders, CONNECTION_ID_HEADER_KEYS) ??
    readOptionalString(config.connectionId) ??
    readOptionalString(record.connectionId) ??
    readOptionalString(record.connection_id) ??
    readOptionalString(metadata?.connectionId) ??
    readOptionalString(metadata?.connection_id) ??
    readOptionalString(normalizedConnection?.connectionId) ??
    readOptionalString(normalizedConnection?.connection_id) ??
    readOptionalString(connection?.id);
  if (connectionId) {
    result.connectionId = connectionId;
  }

  const providerConfigKey =
    readHeaderValue(normalizedHeaders, PROVIDER_CONFIG_KEY_HEADER_KEYS) ??
    readOptionalString(config.providerConfigKey) ??
    readOptionalString(record.providerConfigKey) ??
    readOptionalString(record.provider_config_key) ??
    readOptionalString(metadata?.providerConfigKey) ??
    readOptionalString(metadata?.provider_config_key) ??
    readOptionalString(normalizedConnection?.providerConfigKey) ??
    readOptionalString(normalizedConnection?.provider_config_key);
  if (providerConfigKey) {
    result.providerConfigKey = providerConfigKey;
  }

  const deliveryId =
    readOptionalString(normalizedHeaders[JIRA_DELIVERY_HEADER]) ??
    readOptionalString(record.deliveryId) ??
    readOptionalString(record.delivery_id) ??
    readOptionalString(metadata?.deliveryId) ??
    readOptionalString(metadata?.delivery_id) ??
    readOptionalString(webhook?.deliveryId) ??
    readOptionalString(webhook?.delivery_id);
  if (deliveryId) {
    result.deliveryId = deliveryId;
  }

  const requestId =
    readHeaderValue(normalizedHeaders, REQUEST_ID_HEADER_KEYS) ??
    readOptionalString(record.requestId) ??
    readOptionalString(record.request_id) ??
    readOptionalString(metadata?.requestId) ??
    readOptionalString(metadata?.request_id) ??
    readOptionalString(normalizedConnection?.requestId) ??
    readOptionalString(normalizedConnection?.request_id);
  if (requestId) {
    result.requestId = requestId;
  }

  const webhookEvent =
    readOptionalString(normalizedHeaders[JIRA_EVENT_HEADER]) ??
    readOptionalString(record.webhookEvent) ??
    readOptionalString(record.webhook_event);
  if (webhookEvent) {
    result.webhookEvent = webhookEvent;
  }

  return result;
}

function extractJiraObjectType(payload: JiraRecord): string {
  const event = readOptionalString(payload.webhookEvent)?.toLowerCase() ?? '';
  if (isRecord(payload.comment)) return 'comment';
  if (isRecord(payload.sprint)) return 'sprint';
  if (isRecord(payload.project)) return 'project';
  if (isRecord(payload.issue)) return 'issue';
  if (event.includes('comment')) return 'comment';
  if (event.includes('sprint')) return 'sprint';
  if (event.includes('project')) return 'project';
  if (event.includes('issue')) return 'issue';
  throw new Error('Jira webhook object type could not be inferred.');
}

function extractJiraObjectId(payload: JiraRecord, objectType: string): string {
  const source = getRecord(payload[objectType]);
  const id = readOptionalString(source?.id) ?? readOptionalNumber(source?.id);
  if (id) return id;
  if (objectType === 'issue') {
    const issue = getRecord(payload.issue);
    const issueKey = readOptionalString(issue?.key);
    if (issueKey) return issueKey;
  }
  throw new Error(`Jira ${objectType} webhook is missing object id.`);
}

function extractJiraEventType(
  payload: JiraRecord,
  headers: Record<string, string>,
  objectType: string,
): string {
  const explicit =
    readOptionalString(headers[JIRA_EVENT_HEADER]) ??
    readOptionalString(payload.webhookEvent) ??
    readOptionalString(payload.webhook_event);
  const action = normalizeJiraAction(
    deriveJiraTransitionAction(payload) ??
    readOptionalString(payload.issue_event_type_name) ??
    readOptionalString(payload.eventType) ??
    explicit,
  );
  if (explicit && explicit.includes(':')) {
    const [, explicitAction] = explicit.split(':');
    return `${objectType}.${action === 'updated' ? normalizeJiraAction(explicitAction) : action}`;
  }
  return `${objectType}.${action}`;
}

function normalizeJiraAction(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized.includes('delete') || normalized === 'deleted') return 'deleted';
  if (normalized.includes('create') || normalized === 'created') return 'created';
  if (
    normalized.includes('done')
    || normalized.includes('complete')
    || normalized.includes('resolve')
    || normalized.includes('closed')
  ) {
    return 'completed';
  }
  return 'updated';
}

function deriveJiraTransitionAction(payload: JiraRecord): string | undefined {
  const issue = getRecord(payload.issue);
  const fields = getRecord(issue?.fields);
  const status = getRecord(fields?.status);
  const statusName = readOptionalString(status?.name);
  const statusCategory = getRecord(status?.statusCategory);
  const statusCategoryKey = readOptionalString(statusCategory?.key);
  const resolution = getRecord(fields?.resolution);
  const resolutionName = readOptionalString(resolution?.name);
  if (isJiraTerminalValue(statusName) || isJiraTerminalValue(statusCategoryKey) || isJiraTerminalValue(resolutionName)) {
    return 'completed';
  }

  const changelog = getRecord(payload.changelog) ?? getRecord(issue?.changelog);
  const histories = Array.isArray(changelog?.histories) ? changelog.histories : [];
  for (const history of histories) {
    if (!isRecord(history)) continue;
    const items = Array.isArray(history.items) ? history.items : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const field = readOptionalString(item.field)?.toLowerCase();
      if (field !== 'status' && field !== 'resolution') continue;
      if (isJiraTerminalValue(readOptionalString(item.toString) ?? readOptionalString(item.to))) {
        return 'completed';
      }
    }
  }

  return undefined;
}

function isJiraTerminalValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  return (
    normalized === 'done'
    || normalized === 'resolved'
    || normalized === 'closed'
    || normalized === 'complete'
    || normalized === 'completed'
    || normalized === 'done category'
  );
}

function buildNormalizedPayload(
  payload: JiraRecord,
  connection: JiraWebhookConnectionMetadata,
  claims: AtlassianJwtClaims | undefined,
  summary: {
    eventType: string;
    objectId: string;
    objectType: string;
  },
): Record<string, unknown> {
  const objectPayload = getRecord(payload[summary.objectType]) ?? payload;
  return compactObject({
    ...objectPayload,
    _webhook: compactObject({
      claims,
      deliveryId: connection.deliveryId,
      eventType: summary.eventType,
      objectId: summary.objectId,
      objectType: summary.objectType,
      providerConfigKey: connection.providerConfigKey,
      requestId: connection.requestId,
      webhookEvent: connection.webhookEvent ?? readOptionalString(payload.webhookEvent),
    }),
    _connection: compactObject({
      connectionId: connection.connectionId,
      provider: connection.provider,
      providerConfigKey: connection.providerConfigKey,
    }),
  });
}

function extractJwtToken(authorization: string | undefined): string | undefined {
  const value = authorization?.trim();
  if (!value) return undefined;
  const jwtMatch = /^JWT\s+(.+)$/iu.exec(value);
  if (jwtMatch?.[1]) return jwtMatch[1].trim();
  const bearerMatch = /^Bearer\s+(.+)$/iu.exec(value);
  if (bearerMatch?.[1]) return bearerMatch[1].trim();
  return value.includes('.') ? value : undefined;
}

function decodeJwt(token: string): DecodedJwt | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return undefined;
  }
  const claims = decodeJsonSegment(parts[1]);
  if (!isRecord(claims)) {
    return undefined;
  }
  return {
    claims: claims as AtlassianJwtClaims,
    encodedHeader: parts[0],
    encodedPayload: parts[1],
    signature: parts[2],
  };
}

function decodeJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(base64UrlToBase64(segment), 'base64').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function hmacSha256Base64Url(value: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(value, 'utf8')
    .digest('base64url');
}

function safeEqualBase64Url(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function canonicalizePath(path: string): string {
  const parsed = path.includes('://') ? new URL(path).pathname : path.split('?')[0] ?? path;
  const normalized = parsed.startsWith('/') ? parsed : `/${parsed}`;
  return normalized.replace(/\/{2,}/gu, '/');
}

function canonicalizeQuery(
  query: URLSearchParams | Record<string, readonly string[] | string | undefined> | string | undefined,
): string {
  const params = collectQueryParams(query);
  if (params.length === 0) return '';
  return params
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey);
      return keyComparison === 0 ? leftValue.localeCompare(rightValue) : keyComparison;
    })
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function collectQueryParams(
  query: URLSearchParams | Record<string, readonly string[] | string | undefined> | string | undefined,
): Array<[string, string]> {
  if (!query) return [];
  if (typeof query === 'string') {
    const trimmed = query.startsWith('?') ? query.slice(1) : query;
    return Array.from(new URLSearchParams(trimmed).entries()).filter(([key]) => key !== 'jwt');
  }
  if (query instanceof URLSearchParams) {
    return Array.from(query.entries()).filter(([key]) => key !== 'jwt');
  }
  const params: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(query)) {
    if (key === 'jwt' || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.push([key, entry]);
      }
    } else if (typeof value === 'string') {
      params.push([key, value]);
    } else {
      for (const entry of value) {
        params.push([key, entry]);
      }
    }
  }
  return params;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function base64UrlToBase64(value: string): string {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return `${value.replace(/-/gu, '+').replace(/_/gu, '/')}${padding}`;
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (typeof rawPayload === 'string') {
    return JSON.parse(rawPayload) as unknown;
  }
  if (rawPayload instanceof Uint8Array) {
    return JSON.parse(Buffer.from(rawPayload).toString('utf8')) as unknown;
  }
  return rawPayload;
}

function normalizeHeaders(headers: JiraWebhookHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key.toLowerCase()] = value;
    });
    return normalized;
  }
  if (isIterableHeaders(headers)) {
    for (const [key, value] of headers) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }
  for (const [key, value] of Object.entries(headers)) {
    const normalizedValue = readHeaderEntry(value);
    if (normalizedValue !== undefined) {
      normalized[key.toLowerCase()] = normalizedValue;
    }
  }
  return normalized;
}

function isIterableHeaders(value: unknown): value is Iterable<readonly [string, string]> {
  return !isRecord(value) && typeof (value as { [Symbol.iterator]?: unknown })?.[Symbol.iterator] === 'function';
}

function readHeaderEntry(value: HeaderValue): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.find((entry) => typeof entry === 'string');
  return undefined;
}

function readHeaderValue(headers: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(headers[key]);
    if (value) return value;
  }
  return undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalNumber(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}
