import { ReadOnlyFieldError } from '@relayfile/adapter-core';
import { resources, type AdapterResourceConfig } from './resources.js';
import type { SlackWritebackRequest } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

type JsonPrimitive = boolean | number | null | string;
type JsonValue = JsonValue[] | { [key: string]: JsonValue } | JsonPrimitive;

/**
 * Resolve a relayfile writeback into a Slack Web API request.
 *
 * Routes:
 *   - POST /slack/channels/<channel>/messages/new.json
 *       → chat.postMessage (top-level message)
 *   - POST /slack/channels/<channel>/messages/<msg>/replies/new.json
 *       → chat.postMessage with thread_ts (thread reply)
 *   - POST /slack/channels/<channel>/messages/<msg>/reactions/new.json
 *       → reactions.add
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
  const messageFile = matchResourceFile(path, '/slack/channels/{channelId}/messages');
  const newMessageMatch = path.match(/^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (newMessageMatch?.[1] && messageFile && !messageFile.canonical) {
    return buildPostMessage(newMessageMatch[1], undefined, content);
  }

  const messagePatchMatch = path.match(/^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (messagePatchMatch?.[1] && messagePatchMatch[2] && messageFile?.canonical) {
    return buildPostMessage(messagePatchMatch[1], extractMessageTimestamp(messagePatchMatch[2]), content);
  }

  const replyFile = matchResourceFile(path, '/slack/channels/{channelId}/messages/{messageTs}/replies');
  const replyMatch = path.match(
    /^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/([^/]+)\.json$/,
  );
  if (replyMatch?.[1] && replyMatch?.[2] && replyFile && !replyFile.canonical) {
    return buildPostMessage(replyMatch[1], extractMessageTimestamp(replyMatch[2]), content);
  }

  const reactionFile = matchResourceFile(path, '/slack/channels/{channelId}/messages/{messageTs}/reactions');
  const reactionMatch = path.match(
    /^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/]+)\.json$/,
  );
  if (reactionMatch?.[1] && reactionMatch?.[2] && reactionFile && !reactionFile.canonical) {
    return buildAddReaction(
      reactionMatch[1],
      extractMessageTimestamp(reactionMatch[2]),
      content,
    );
  }

  throw new Error(`No Slack writeback rule matched ${path}`);
}

export function resolveDeleteRequest(path: string): SlackWritebackRequest {
  const messageMatch = path.match(/^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (messageMatch?.[1] && messageMatch[2] && matchResourceFile(path, '/slack/channels/{channelId}/messages')?.canonical) {
    return buildDeleteMessage(messageMatch[1], extractMessageTimestamp(messageMatch[2]));
  }

  const replyMatch = path.match(/^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/([^/]+)\.json$/);
  if (replyMatch?.[1] && replyMatch[3] && matchResourceFile(path, '/slack/channels/{channelId}/messages/{messageTs}/replies')?.canonical) {
    return buildDeleteMessage(replyMatch[1], extractMessageTimestamp(replyMatch[3]));
  }

  const reactionMatch = path.match(/^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/]+)\.json$/);
  if (reactionMatch?.[1] && reactionMatch[2] && reactionMatch[3] && matchResourceFile(path, '/slack/channels/{channelId}/messages/{messageTs}/reactions')?.canonical) {
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

  throw new Error(`No Slack delete writeback rule matched ${path}`);
}

/* ------------------------------------------------------------------ *
 * Path → Slack id resolution
 * ------------------------------------------------------------------ */

/**
 * Resolve the channel path segment to a value Slack's `channel` parameter
 * accepts. Resolution priority (most → least specific):
 *
 *   1. `<slug>--<channelId>` form emitted by `path-mapper.channelSegment()`:
 *      extract and return the canonical id. This is the round-trip-safe
 *      shape — Slack channel names can contain underscores that the slug
 *      lossily replaces with hyphens, so we must rely on the id suffix.
 *   2. Bare Slack id (`^[CDG][A-Z0-9]{7,}$`): forward as-is.
 *   3. Bare slug (no id suffix): forward as `#<slug>` as a best effort.
 *      Channels whose name contains an underscore will silently target the
 *      wrong channel; callers should either re-sync paths into the new
 *      `<slug>--<id>` form or pass an explicit `channel` field in the JSON
 *      payload to override.
 */
function extractSlackChannel(segment: string): string {
  const decoded = decodeURIComponent(segment);

  // Round-trip-safe form: <slug>--<channelId>
  const sluggedId = /--([CDG][A-Z0-9]{7,})$/.exec(decoded);
  if (sluggedId?.[1]) return sluggedId[1];

  // Bare canonical id
  if (/^[CDG][A-Z0-9]{7,}$/.test(decoded)) return decoded;

  // Bare slug — best-effort. Documented limitation: lossy for names with `_`.
  return decoded.startsWith('#') ? decoded : `#${decoded}`;
}

/**
 * Reverse the `messageSegment` encoding produced by `path-mapper.ts`.
 *
 * `messageSegment(ts, subject)` emits one of:
 *   - `<subjectSlug>--<tsToken>` (when a subject was available)
 *   - `<tsToken>` (otherwise)
 *
 * `<tsToken>` is `messageTs.replace(/\./g, '_')`. Slack's API expects the
 * canonical `<seconds>.<microseconds>` form, so we replace the *last*
 * underscore back to a dot.
 */
function extractMessageTimestamp(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const slugSplit = decoded.split('--');
  const tsToken = slugSplit[slugSplit.length - 1] ?? decoded;
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
): SlackWritebackRequest {
  const pathChannel = extractSlackChannel(channelSegment);
  const parsed = safeParseJson(content);

  if (typeof parsed === 'string') {
    if (!parsed) throw new Error('messages/new.json writeback requires a non-empty body');
    const action: SlackWritebackRequest['action'] = threadTs ? 'reply_in_thread' : 'post_message';
    return {
      action,
      method: 'POST',
      endpoint: '/api/chat.postMessage',
      body: {
        channel: pathChannel,
        text: parsed,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      },
    };
  }

  if (!isRecord(parsed)) {
    throw new Error('messages/new.json writeback expects a JSON object or plain string');
  }
  rejectReadOnlyFields(parsed);

  const text = readString(parsed, 'text');
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : undefined;
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : undefined;
  if (!text && !blocks && !attachments) {
    throw new Error(
      'messages/new.json writeback requires `text`, `blocks`, or `attachments`',
    );
  }

  // Channel: explicit payload override wins over the path-derived channel.
  // This is the documented escape hatch when the path uses a lossy slug
  // (e.g. for channel names containing underscores) and the caller wants
  // to target the canonical id directly.
  const explicitChannel = readString(parsed, 'channel');
  const body: Record<string, unknown> = { channel: explicitChannel ?? pathChannel };
  if (text) body.text = text;
  if (blocks) body.blocks = blocks;
  if (attachments) body.attachments = attachments;

  // Thread context: URL-derived first, then payload override.
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

  return {
    action,
    method: 'POST',
    endpoint: '/api/chat.postMessage',
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
      'reactions/new.json writeback expects a JSON object with `name` or a plain string',
    );
  }

  if (!name) {
    throw new Error(
      'reactions/new.json writeback requires `name` (emoji name without colons)',
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

function matchResourceFile(path: string, resourcePath: string): { canonical: boolean; id: string } | undefined {
  const resource = resources.find((candidate) => candidate.path === resourcePath);
  if (!resource) {
    return undefined;
  }
  return matchFile(path, resource);
}

function matchFile(path: string, resource: AdapterResourceConfig): { canonical: boolean; id: string } | undefined {
  if (!path.endsWith('.json') || !resource.pathPattern.test(path)) {
    return undefined;
  }
  const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1, -'.json'.length));
  return { canonical: resource.idPattern.test(id), id };
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
