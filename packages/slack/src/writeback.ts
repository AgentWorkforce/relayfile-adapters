import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { resources } from './resources.js';
import type { SlackWritebackRequest } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

type JsonPrimitive = boolean | number | null | string;
type JsonValue = JsonValue[] | { [key: string]: JsonValue } | JsonPrimitive;

export interface SlackRunCost {
  /** Formatted USD amount for the current run, without the leading `$`. */
  thisRun: string;
  /** Formatted seven-day daily USD trend, without the leading `$`. */
  perDay: string;
  /** Seven-day cache-hit percentage, rounded to a whole percent. */
  cachePct: number;
}

export interface SlackRunCostResolverOptions {
  /** Runtime environment override, primarily for non-Node runtimes and tests. */
  env?: Record<string, string | undefined>;
  /** Fetch implementation override, primarily for tests. */
  fetch?: typeof globalThis.fetch;
}

const MESSAGE_RECORD_PATH_PATTERN =
  /^\/slack\/channels\/([^/]+)\/messages\/([^/]+)(?:\.json|\/meta\.json)$/;

/**
 * Resolve a relayfile writeback into a Slack Web API request.
 *
 * Routes:
 *   - POST /slack/channels/<channel>/messages/<draft>.json
 *       → chat.postMessage (top-level message)
 *   - POST /slack/channels/<channel>/messages/<msg>/replies/<draft>.json
 *       → chat.postMessage with thread_ts (thread reply)
 *   - POST /slack/channels/<channel>/messages/<msg>/reactions/<draft>.json
 *       → reactions.add
 *   - POST /slack/users/<user>/messages/<draft>.json
 *       → conversations.open + chat.postMessage (executed by cloud bridge)
 *
 * The `<channel>` segment is whatever `path-mapper.namedSegment(name, id)`
 * produced — either a Slack channel id like `C01ABC123` or a slugified
 * channel name like `customer-success`. Slack's API accepts both forms,
 * so we forward the segment with a `#` prefix when it's clearly a name.
 *
 * The `<msg>` segment is `path-mapper.messageSegment(messageTs, subject?)`,
 * encoded as either `<tsToken>` or `<subjectSlug>--<tsToken>`. The token
 * is the message timestamp with `.` replaced by `_`. We reverse this to
 * recover the canonical `1234567890.001234` form Slack expects.
 */
export function resolveWritebackRequest(path: string, content: string): SlackWritebackRequest {
  return resolveWritebackRequestWithCost(path, content);
}

/**
 * Resolve a Slack writeback and enrich agent-authored message creates with the
 * current proactive run's cost footer when cloud usage data is available.
 *
 * This async entry point is additive so existing synchronous writeback bridges
 * remain compatible. Agent runtimes should use it when they provide
 * `RELAY_RUN_ID`, `WORKFORCE_USAGE_URL`, and `WORKFORCE_DEPLOYMENT_TOKEN`.
 * Missing credentials, an unavailable usage callback, or zero recorded spend
 * all silently preserve the original Slack payload.
 */
export async function resolveWritebackRequestWithRunCost(
  path: string,
  content: string,
  options: SlackRunCostResolverOptions = {},
): Promise<SlackWritebackRequest> {
  const request = resolveWritebackRequestWithCost(path, content);
  if (!isMessageCreateRequest(request)) return request;

  const cost = await fetchSlackRunCost(options);
  return cost ? resolveWritebackRequestWithCost(path, content, cost) : request;
}

function resolveWritebackRequestWithCost(
  path: string,
  content: string,
  cost?: SlackRunCost,
): SlackWritebackRequest {
  const route = classifyWrite(path, resources);

  if (route?.resource.name === 'messages') {
    const messageMatch = path.match(MESSAGE_RECORD_PATH_PATTERN);
    if (route.kind === 'create' && messageMatch?.[1]) {
      return buildPostMessage(messageMatch[1], undefined, content, cost);
    }
    if (route.kind === 'patch' && messageMatch?.[1] && messageMatch[2]) {
      return buildUpdateMessage(messageMatch[1], extractMessageTimestamp(messageMatch[2]), content);
    }
  }

  if (route?.resource.name === 'direct-messages') {
    const dmMatch = path.match(/^\/slack\/users\/([^/]+)\/messages\/([^/]+)\.json$/);
    if (route.kind === 'create' && dmMatch?.[1]) {
      return buildPostDirectMessage(dmMatch[1], content, cost);
    }
  }

  if (route?.resource.name === 'replies') {
    const replyMatch = path.match(
      /^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/([^/]+)\.json$/,
    );
    if (route.kind === 'create' && replyMatch?.[1] && replyMatch[2]) {
      return buildPostMessage(replyMatch[1], extractMessageTimestamp(replyMatch[2]), content, cost);
    }
    if (route.kind === 'patch' && replyMatch?.[1] && replyMatch[3]) {
      return buildUpdateMessage(replyMatch[1], extractMessageTimestamp(replyMatch[3]), content);
    }
  }

  if (route?.resource.name === 'reactions' && route.kind === 'create') {
    const reactionMatch = path.match(
      /^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/]+)\.json$/,
    );
    if (reactionMatch?.[1] && reactionMatch[2]) {
      return buildAddReaction(
        reactionMatch[1],
        extractMessageTimestamp(reactionMatch[2]),
        content,
      );
    }
  }

  throw new Error(`No Slack writeback rule matched ${path}`);
}

export function resolveDeleteRequest(path: string): SlackWritebackRequest {
  const route = classifyWrite(path, resources, { fsEvent: 'delete' });
  if (route?.kind !== 'delete') {
    throw new Error(`No Slack delete writeback rule matched ${path}`);
  }

  if (route.resource.name === 'messages') {
    const messageMatch = path.match(MESSAGE_RECORD_PATH_PATTERN);
    if (messageMatch?.[1] && messageMatch[2]) {
      return buildDeleteMessage(messageMatch[1], extractMessageTimestamp(messageMatch[2]));
    }
  }

  if (route.resource.name === 'replies') {
    const replyMatch = path.match(/^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/([^/]+)\.json$/);
    if (replyMatch?.[1] && replyMatch[3]) {
      return buildDeleteMessage(replyMatch[1], extractMessageTimestamp(replyMatch[3]));
    }
  }

  if (route.resource.name === 'reactions') {
    const reactionMatch = path.match(/^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/]+)\.json$/);
    if (reactionMatch?.[1] && reactionMatch[2] && reactionMatch[3]) {
      return {
        action: 'remove_reaction',
        method: 'POST',
        endpoint: '/api/reactions.remove',
        body: {
          channel: extractSlackChannel(reactionMatch[1]),
          timestamp: extractMessageTimestamp(reactionMatch[2]),
          name: decodeURIComponent(reactionMatch[3]).split('--')[0],
        },
      };
    }
  }

  throw new Error(`No Slack delete writeback rule matched ${path}`);
}

/* ------------------------------------------------------------------ *
 * Path → Slack id resolution
 * ------------------------------------------------------------------ */

/**
 * Resolve the channel path segment to a value Slack's `channel` parameter
 * accepts. Resolution priority (most → least specific):
 *
 *   1. v2 round-trip-safe form `<channelId>__<slug>` emitted by current
 *      `path-mapper`: extract and return the leading canonical id.
 *   2. Legacy round-trip-safe form `<slug>--<channelId>` emitted by
 *      adapter-slack <= 0.2.2: extract and return the trailing canonical id.
 *      Slack channel names can contain underscores that the slug lossily
 *      replaces with hyphens, so we must rely on the id suffix.
 *   3. Bare Slack id (`^[CDG][A-Z0-9]{7,}$`): forward as-is.
 *   4. Bare slug (no id suffix): forward as `#<slug>` as a best effort.
 *      Channels whose name contains an underscore will silently target the
 *      wrong channel; callers should either re-sync paths into the v2
 *      `<id>__<slug>` form or pass an explicit `channel` field in the JSON
 *      payload to override.
 */
function extractSlackChannel(segment: string): string {
  const decoded = decodeURIComponent(segment);

  // v2 round-trip-safe form: <channelId>__<slug>
  const idWithSlug = /^([CDG][A-Z0-9]{7,})__[A-Za-z0-9._+=@-]+/.exec(decoded);
  if (idWithSlug?.[1]) return idWithSlug[1];

  // Legacy round-trip-safe form: <slug>--<channelId>
  const sluggedId = /--([CDG][A-Z0-9]{7,})$/.exec(decoded);
  if (sluggedId?.[1]) return sluggedId[1];

  // Bare canonical id
  if (/^[CDG][A-Z0-9]{7,}$/.test(decoded)) return decoded;

  // Bare slug — best-effort. Documented limitation: lossy for names with `_`.
  return decoded.startsWith('#') ? decoded : `#${decoded}`;
}

function extractSlackUser(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const sluggedId = /--([UW][A-Z0-9]{7,})$/.exec(decoded);
  if (sluggedId?.[1]) return sluggedId[1];
  if (/^[UW][A-Z0-9]{7,}$/.test(decoded)) return decoded;
  return decoded;
}

/**
 * Reverse the message-directory encoding produced by `path-mapper.ts`.
 *
 * The path mapper has historically used two forms:
 *   - v2: `<tsToken>__<textSlug>` (ts leads, slug trails)
 *   - legacy: `<subjectSlug>--<tsToken>` (slug leads, ts trails)
 *   - bare: `<tsToken>` (no slug)
 *
 * `<tsToken>` is `messageTs.replace(/\./g, '_')`. Slack's API expects the
 * canonical `<seconds>.<microseconds>` form, so we replace the *last*
 * underscore back to a dot.
 *
 * The `<tsToken>` itself matches `^\d+_\d+$`, which we use to pick the right
 * token whether it leads (v2) or trails (legacy).
 */
function extractMessageTimestamp(segment: string): string {
  const decoded = decodeURIComponent(segment);

  // v2 form: ts leads, slug trails (separator `__`).
  const v2Split = decoded.split('__');
  if (v2Split.length > 1 && /^\d+_\d+$/.test(v2Split[0]!)) {
    return underscoreToDot(v2Split[0]!);
  }

  // Legacy form: slug leads, ts trails (separator `--`).
  const legacySplit = decoded.split('--');
  const tsToken = legacySplit[legacySplit.length - 1] ?? decoded;
  return underscoreToDot(tsToken);
}

function underscoreToDot(tsToken: string): string {
  const lastUnderscore = tsToken.lastIndexOf('_');
  if (lastUnderscore < 0) return tsToken;
  return `${tsToken.slice(0, lastUnderscore)}.${tsToken.slice(lastUnderscore + 1)}`;
}

/* ------------------------------------------------------------------ *
 * Request builders
 * ------------------------------------------------------------------ */

/**
 * Build a `chat.postMessage` request. When `threadTs` is present, the
 * message becomes a thread reply; otherwise it posts at the top level.
 *
 * Accepts two payload shapes:
 *   - a plain string: becomes the `text` of the message verbatim.
 *   - a JSON object: forwards `text`, `blocks`, `attachments`, optional
 *     `thread_ts` (overrides the URL-derived one), bot identity overrides
 *     (`username`, `icon_emoji`, `icon_url`), and unfurl/mrkdwn flags.
 */
function buildPostMessage(
  channelSegment: string,
  threadTs: string | undefined,
  content: string,
  cost?: SlackRunCost,
): SlackWritebackRequest {
  const pathChannel = extractSlackChannel(channelSegment);
  const parsed = safeParseJson(content);

  if (typeof parsed === 'string') {
    if (!parsed) throw new Error('Slack message create writeback requires a non-empty body');
    const action: SlackWritebackRequest['action'] = threadTs ? 'reply_in_thread' : 'post_message';
    return {
      action,
      method: 'POST',
      endpoint: '/api/chat.postMessage',
      body: {
        channel: pathChannel,
        text: parsed,
        ...(cost ? { blocks: [buildCostFooter(cost)] } : {}),
        ...(threadTs ? { thread_ts: threadTs } : {}),
      },
    };
  }

  if (!isRecord(parsed)) {
    throw new Error('Slack message create writeback expects a JSON object or plain string');
  }
  rejectReadOnlyFields(parsed);

  const text = readString(parsed, 'text');
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : undefined;
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : undefined;
  if (!text && !blocks && !attachments) {
    throw new Error(
      'Slack message create writeback requires `text`, `blocks`, or `attachments`',
    );
  }

  // Channel: explicit payload override wins over the path-derived channel.
  // This is the documented escape hatch when the path uses a lossy slug
  // (e.g. for channel names containing underscores) and the caller wants
  // to target the canonical id directly.
  const explicitChannel = readString(parsed, 'channel');
  const body: Record<string, unknown> = { channel: explicitChannel ?? pathChannel };
  if (text) body.text = text;
  if (blocks || cost) body.blocks = [...(blocks ?? []), ...(cost ? [buildCostFooter(cost)] : [])];
  if (attachments) body.attachments = attachments;

  // Thread context: URL-derived first, then payload override.
  // NOTE: a `parentRef` field (server-side threading) is intentionally NOT
  // handled here. It names a parent *draft* whose delivered ts isn't known at
  // request-build time; resolving it requires ordered, ack-driven dispatch,
  // which is the cloud writeback DO's job (it injects `thread_ts` from the
  // parent's delivered id). This stateless resolver leaves it for the cloud and
  // drops it from the Slack request (it is never a Slack API field).
  if (threadTs) body.thread_ts = threadTs;
  const explicitThreadTs = readString(parsed, 'thread_ts');
  if (explicitThreadTs) body.thread_ts = explicitThreadTs;

  // Bot identity overrides (only honored for legacy bot tokens).
  const username = readString(parsed, 'username');
  if (username) body.username = username;
  const iconEmoji = readString(parsed, 'icon_emoji');
  if (iconEmoji) body.icon_emoji = iconEmoji;
  const iconUrl = readString(parsed, 'icon_url');
  if (iconUrl) body.icon_url = iconUrl;

  // Unfurl + formatting flags.
  const unfurlLinks = readBoolean(parsed, 'unfurl_links');
  if (unfurlLinks !== undefined) body.unfurl_links = unfurlLinks;
  const unfurlMedia = readBoolean(parsed, 'unfurl_media');
  if (unfurlMedia !== undefined) body.unfurl_media = unfurlMedia;
  const mrkdwn = readBoolean(parsed, 'mrkdwn');
  if (mrkdwn !== undefined) body.mrkdwn = mrkdwn;

  // Reply-broadcasting requires a thread context, regardless of whether
  // the thread_ts came from the URL or the payload override.
  const replyBroadcast = readBoolean(parsed, 'reply_broadcast');
  if (replyBroadcast !== undefined && body.thread_ts) {
    body.reply_broadcast = replyBroadcast;
  }

  // Action follows the *effective* thread state, including payload override.
  const action: SlackWritebackRequest['action'] = body.thread_ts
    ? 'reply_in_thread'
    : 'post_message';

  // Client-supplied idempotency token: surfaced on the request for the cloud
  // writeback engine's dedup, deliberately NOT copied into `body` (it must not
  // be sent to Slack's API).
  const idempotencyKey = readString(parsed, 'idempotencyKey');

  return {
    action,
    method: 'POST',
    endpoint: '/api/chat.postMessage',
    body,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function buildPostDirectMessage(
  userSegment: string,
  content: string,
  cost?: SlackRunCost,
): SlackWritebackRequest {
  const user = extractSlackUser(userSegment);
  const message = buildPostMessage(user, undefined, content, cost);
  const messageBody = { ...message.body };
  delete messageBody.channel;
  return {
    action: 'post_dm',
    method: 'POST',
    endpoint: '/api/conversations.open',
    body: {
      users: user,
      return_im: true,
      message: messageBody,
    },
    ...(message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : {}),
  };
}

function buildCostFooter(cost: SlackRunCost): Record<string, unknown> {
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `$${cost.thisRun} · trending $${cost.perDay}/day · cache ${cost.cachePct}%`,
      },
    ],
  };
}

function isMessageCreateRequest(request: SlackWritebackRequest): boolean {
  return (
    request.action === 'post_message' ||
    request.action === 'reply_in_thread' ||
    request.action === 'post_dm'
  );
}

/**
 * Fetch cost data from the proactive runtime's deployment usage endpoint. The
 * endpoint aggregates `harness_spend_events` by `run_id`, so it can expose
 * spend while the agent run is still active and before its final run row is
 * persisted.
 */
async function fetchSlackRunCost(
  options: SlackRunCostResolverOptions,
): Promise<SlackRunCost | undefined> {
  const env = options.env ?? process.env;
  const runId = readEnv(env, 'RELAY_RUN_ID');
  const usageUrl = resolveUsageUrl(env);
  const token =
    readEnv(env, 'WORKFORCE_DEPLOYMENT_TOKEN') ??
    readEnv(env, 'CLOUD_API_ACCESS_TOKEN') ??
    readEnv(env, 'WORKFORCE_WORKSPACE_TOKEN') ??
    readEnv(env, 'WORKFORCE_AGENT_TOKEN');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!runId || !usageUrl || !token || !fetchImpl) return undefined;

  try {
    const separator = usageUrl.includes('?') ? '&' : '?';
    const url = `${usageUrl}${separator}runId=${encodeURIComponent(runId)}`;
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return undefined;

    const payload: unknown = await response.json();
    return runCostFromUsagePayload(payload);
  } catch {
    return undefined;
  }
}

function resolveUsageUrl(env: Record<string, string | undefined>): string | undefined {
  const explicit = readEnv(env, 'WORKFORCE_USAGE_URL');
  if (explicit) return explicit;

  const cloudApiUrl = readEnv(env, 'CLOUD_API_URL') ?? readEnv(env, 'WORKFORCE_CLOUD_BASE_URL');
  const workspaceId = readEnv(env, 'WORKFORCE_WORKSPACE_ID');
  const agentId = readEnv(env, 'WORKFORCE_AGENT_ID');
  if (!cloudApiUrl || !workspaceId || !agentId) return undefined;
  return (
    `${cloudApiUrl.replace(/\/+$/, '')}/api/v1/workspaces/${encodeURIComponent(workspaceId)}` +
    `/deployments/${encodeURIComponent(agentId)}/usage`
  );
}

function runCostFromUsagePayload(payload: unknown): SlackRunCost | undefined {
  if (!isRecord(payload)) return undefined;
  const cost = isRecord(payload.cost) ? payload.cost : payload;
  const thisRun =
    formatUsd(cost.thisRun, false) ??
    formatUsdMicros(cost.thisRunUsdMicros ?? cost.costUsdMicros, false);
  const perDay =
    formatUsd(cost.perDay, true) ??
    formatUsdMicros(cost.perDayUsdMicros ?? cost.dailyCostUsdMicros, true);
  const cachePct = readPercentage(cost.cachePct ?? cost.cacheHitPct);
  if (!thisRun || !perDay || cachePct === undefined) return undefined;
  return { thisRun, perDay, cachePct };
}

function formatUsd(value: unknown, allowZero: boolean): string | undefined {
  const amount =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) return undefined;
  const formatted = amount.toFixed(2);
  return !allowZero && formatted === '0.00' ? undefined : formatted;
}

function formatUsdMicros(value: unknown, allowZero: boolean): string | undefined {
  const micros = readUsdMicros(value);
  if (micros === undefined || (!allowZero && micros === 0n)) return undefined;
  const cents = (micros + 5_000n) / 10_000n;
  if (!allowZero && cents === 0n) return undefined;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function readUsdMicros(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value >= 0n ? value : undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function readPercentage(value: unknown): number | undefined {
  const percentage =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return undefined;
  return Math.round(percentage);
}

function readEnv(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

/**
 * Build a `chat.update` request for editing an existing top-level message
 * or thread reply. `chat.postMessage` (used by buildPostMessage) creates a
 * new message — for PATCH semantics on a canonical `<ts>.json` filename we
 * must call `chat.update` with the same `ts` to mutate the existing record.
 *
 * Accepts the same body shapes as buildPostMessage. Slack ignores
 * `thread_ts` on update calls (the message's thread membership is fixed at
 * post time), so we omit it.
 */
function buildUpdateMessage(
  channelSegment: string,
  ts: string,
  content: string,
): SlackWritebackRequest {
  const pathChannel = extractSlackChannel(channelSegment);
  const parsed = safeParseJson(content);

  if (typeof parsed === 'string') {
    if (!parsed) throw new Error('Slack message update writeback requires a non-empty body');
    return {
      action: 'update_message',
      method: 'POST',
      endpoint: '/api/chat.update',
      body: { channel: pathChannel, ts, text: parsed },
    };
  }

  if (!isRecord(parsed)) {
    throw new Error('Slack message update writeback expects a JSON object or plain string');
  }
  rejectReadOnlyFields(parsed);

  const text = readString(parsed, 'text');
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : undefined;
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : undefined;
  if (!text && !blocks && !attachments) {
    throw new Error(
      'Slack message update writeback requires `text`, `blocks`, or `attachments`',
    );
  }

  const explicitChannel = readString(parsed, 'channel');
  const body: Record<string, unknown> = {
    channel: explicitChannel ?? pathChannel,
    ts,
  };
  if (text) body.text = text;
  if (blocks) body.blocks = blocks;
  if (attachments) body.attachments = attachments;

  return {
    action: 'update_message',
    method: 'POST',
    endpoint: '/api/chat.update',
    body,
  };
}

function buildDeleteMessage(channelSegment: string, tsSegment: string): SlackWritebackRequest {
  return {
    action: 'delete_message',
    method: 'POST',
    endpoint: '/api/chat.delete',
    body: {
      channel: extractSlackChannel(channelSegment),
      ts: tsSegment,
    },
  };
}

/**
 * Build a `reactions.add` request. Accepts:
 *   - a plain string: the emoji name (with or without surrounding colons,
 *     e.g. `eyes` or `:eyes:`).
 *   - a JSON object with `name` (or `reaction`).
 */
function buildAddReaction(
  channelSegment: string,
  messageTs: string,
  content: string,
): SlackWritebackRequest {
  const pathChannel = extractSlackChannel(channelSegment);
  const parsed = safeParseJson(content);

  let name: string | undefined;
  let explicitChannel: string | undefined;
  if (typeof parsed === 'string') {
    name = parsed.trim().replace(/^:|:$/g, '');
  } else if (isRecord(parsed)) {
    name = readString(parsed, 'name') ?? readString(parsed, 'reaction');
    if (name) name = name.replace(/^:|:$/g, '');
    explicitChannel = readString(parsed, 'channel');
  } else {
    throw new Error(
      'Slack reaction create writeback expects a JSON object with `name` or a plain string',
    );
  }

  if (!name) {
    throw new Error(
      'Slack reaction create writeback requires `name` (emoji name without colons)',
    );
  }

  return {
    action: 'add_reaction',
    method: 'POST',
    endpoint: '/api/reactions.add',
    body: {
      channel: explicitChannel ?? pathChannel,
      timestamp: messageTs,
      name,
    },
  };
}

const READ_ONLY_FIELDS = new Set([
  'id',
  'ts',
  'createdAt',
  'updatedAt',
  'url',
  'identifier',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);

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

/**
 * Parse `content` as JSON, falling back to the trimmed raw string when
 * parsing fails. Lets a caller accept both `'"hello"'` and `hello` for
 * plain-text message bodies and reaction names.
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
