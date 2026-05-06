import type { SlackWritebackRequest } from './types.js';

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
  const newMessageMatch = path.match(/^\/slack\/channels\/([^/]+)\/messages\/new\.json$/);
  if (newMessageMatch?.[1]) {
    return buildPostMessage(newMessageMatch[1], undefined, content);
  }

  const replyMatch = path.match(
    /^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/new\.json$/,
  );
  if (replyMatch?.[1] && replyMatch?.[2]) {
    return buildPostMessage(replyMatch[1], extractMessageTimestamp(replyMatch[2]), content);
  }

  const reactionMatch = path.match(
    /^\/slack\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/new\.json$/,
  );
  if (reactionMatch?.[1] && reactionMatch?.[2]) {
    return buildAddReaction(
      reactionMatch[1],
      extractMessageTimestamp(reactionMatch[2]),
      content,
    );
  }

  throw new Error(`No Slack writeback rule matched ${path}`);
}

/* ------------------------------------------------------------------ *
 * Path → Slack id resolution
 * ------------------------------------------------------------------ */

/**
 * Resolve the channel path segment to a value Slack's `channel` parameter
 * accepts: a raw Slack id (e.g. `C01ABC123`) is forwarded as-is; anything
 * else is treated as a channel name and prefixed with `#` so the bot can
 * post via the channel name without needing an id lookup.
 */
function extractSlackChannel(segment: string): string {
  const decoded = decodeURIComponent(segment);
  // Slack ids: C (public), G (private/legacy), D (DM) prefix + uppercase alphanumerics.
  if (/^[CDG][A-Z0-9]{7,}$/.test(decoded)) return decoded;
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
  const channel = extractSlackChannel(channelSegment);
  const parsed = safeParseJson(content);
  const action: SlackWritebackRequest['action'] = threadTs ? 'reply_in_thread' : 'post_message';

  if (typeof parsed === 'string') {
    if (!parsed) throw new Error('messages/new.json writeback requires a non-empty body');
    return {
      action,
      method: 'POST',
      endpoint: '/api/chat.postMessage',
      body: {
        channel,
        text: parsed,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      },
    };
  }

  if (!isRecord(parsed)) {
    throw new Error('messages/new.json writeback expects a JSON object or plain string');
  }

  const text = readString(parsed, 'text');
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : undefined;
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : undefined;
  if (!text && !blocks && !attachments) {
    throw new Error(
      'messages/new.json writeback requires `text`, `blocks`, or `attachments`',
    );
  }

  const body: Record<string, unknown> = { channel };
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

  // Reply-broadcasting (thread reply also visible in channel).
  const replyBroadcast = readBoolean(parsed, 'reply_broadcast');
  if (replyBroadcast !== undefined && threadTs) body.reply_broadcast = replyBroadcast;

  return {
    action,
    method: 'POST',
    endpoint: '/api/chat.postMessage',
    body,
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
  const channel = extractSlackChannel(channelSegment);
  const parsed = safeParseJson(content);

  let name: string | undefined;
  if (typeof parsed === 'string') {
    name = parsed.trim().replace(/^:|:$/g, '');
  } else if (isRecord(parsed)) {
    name = readString(parsed, 'name') ?? readString(parsed, 'reaction');
    if (name) name = name.replace(/^:|:$/g, '');
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
      channel,
      timestamp: messageTs,
      name,
    },
  };
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
