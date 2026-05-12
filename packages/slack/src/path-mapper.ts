import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';

const SLACK_ROOT = '/slack';
const MAX_MESSAGE_TEXT_SLUG_LENGTH = 40;

export type SlackPathObjectType =
  | 'channel'
  | 'file'
  | 'file_comment'
  | 'message'
  | 'reaction'
  | 'thread'
  | 'thread_reply'
  | 'user';

export interface SlackMessageReference {
  channelId: string;
  messageTs: string;
}

export interface SlackThreadReference {
  channelId: string;
  threadTs: string;
}

export interface SlackThreadReplyReference extends SlackThreadReference {
  replyTs: string;
}

export interface SlackReactionReference {
  targetType: 'file' | 'file_comment' | 'message' | 'thread' | 'thread_reply';
  reaction: string;
  userId: string;
  fileCommentId?: string;
  fileId?: string;
  channelId?: string;
  messageTs?: string;
  threadTs?: string;
  replyTs?: string;
}

export interface SlackReactionObjectIdParts extends SlackReactionReference {}

function normalizeSegment(value: string, fallback = 'unknown'): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.replace(/[^A-Za-z0-9._+=@-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Slugify a message body for a `<ts>__<slug>` directory segment. Truncates to
 * roughly the first {@link MAX_MESSAGE_TEXT_SLUG_LENGTH} chars and trims
 * trailing partial words so the slug stays readable.
 */
function slugifyMessageText(text: string): string {
  const slug = slugify(text).slice(0, MAX_MESSAGE_TEXT_SLUG_LENGTH);
  if (slug.length < MAX_MESSAGE_TEXT_SLUG_LENGTH) {
    return slug;
  }
  const cutIndex = slug.lastIndexOf('-');
  const bounded = cutIndex > 0 ? slug.slice(0, cutIndex) : slug;
  return bounded.replace(/^-+|-+$/g, '');
}

/**
 * Compose an `<id>__<slug>` segment, mirroring `github`'s `nameWithId` and the
 * convention used across v2 adapters. When `humanReadable` slugifies to empty
 * (no name available, emoji-only, etc.) returns the bare normalized id.
 */
export function slackNameWithId(humanReadable: string | undefined, id: string): string {
  const normalizedId = normalizeSegment(id);
  const slug = humanReadable ? slugify(humanReadable) : '';
  return slug ? `${normalizedId}__${slug}` : normalizedId;
}

/**
 * `<channelId>__<channelName>` directory segment for paths that need to
 * round-trip back to a Slack channel id at writeback time. The id is the
 * leading token before `__`, so writeback resolvers can recover it.
 */
function channelSegmentV2(channelName: string | undefined, channelId: string): string {
  return slackNameWithId(channelName, channelId);
}

/**
 * @deprecated Use {@link channelSegmentV2}. Legacy `<slug>--<channelId>` form
 * kept so reader code can compute matching paths for blobs emitted by
 * adapter-slack <= 0.2.2.
 */
function channelSegmentLegacy(channelName: string | undefined, channelId: string): string {
  const slug = channelName ? slugify(channelName) : '';
  const normalizedId = normalizeSegment(channelId);
  return slug ? `${slug}--${normalizedId}` : normalizedId;
}

function messageSegmentV2(messageTs: string, messageText?: string): string {
  const tsToken = slackTimestampToPathToken(messageTs);
  const subjectSlug = messageText ? slugifyMessageText(messageText) : '';
  return subjectSlug ? `${tsToken}__${subjectSlug}` : tsToken;
}

function joinPath(...segments: string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .map((segment, index) => {
      if (index === 0) {
        return segment.replace(/\/+$/g, '') || '/';
      }
      return segment.replace(/^\/+|\/+$/g, '');
    })
    .join('/');
}

export function sanitizeSlackPathSegment(value: string, fallback = 'unknown'): string {
  return normalizeSegment(value, fallback);
}

export function slackTimestampToPathToken(ts: string): string {
  return normalizeSegment(ts.replace(/\./g, '_'), '0');
}

export function createSlackMessageObjectId(channelId: string, messageTs: string): string {
  return `${channelId}:${messageTs}`;
}

export function createSlackThreadObjectId(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

export function createSlackThreadReplyObjectId(
  channelId: string,
  threadTs: string,
  replyTs: string,
): string {
  return `${channelId}:${threadTs}:${replyTs}`;
}

export function createSlackReactionObjectId(reference: SlackReactionReference): string {
  const reaction = sanitizeSlackPathSegment(reference.reaction);
  const userId = sanitizeSlackPathSegment(reference.userId);

  switch (reference.targetType) {
    case 'message': {
      const channelId = sanitizeSlackPathSegment(reference.channelId ?? '');
      const messageTs = sanitizeSlackPathSegment(reference.messageTs ?? '');
      return `message:${channelId}:${messageTs}:${reaction}:${userId}`;
    }
    case 'thread': {
      const channelId = sanitizeSlackPathSegment(reference.channelId ?? '');
      const threadTs = sanitizeSlackPathSegment(reference.threadTs ?? '');
      return `thread:${channelId}:${threadTs}:${reaction}:${userId}`;
    }
    case 'thread_reply': {
      const channelId = sanitizeSlackPathSegment(reference.channelId ?? '');
      const threadTs = sanitizeSlackPathSegment(reference.threadTs ?? '');
      const replyTs = sanitizeSlackPathSegment(reference.replyTs ?? '');
      return `thread_reply:${channelId}:${threadTs}:${replyTs}:${reaction}:${userId}`;
    }
    case 'file': {
      const fileId = sanitizeSlackPathSegment(reference.fileId ?? '');
      return `file:${fileId}:${reaction}:${userId}`;
    }
    case 'file_comment': {
      const fileCommentId = sanitizeSlackPathSegment(reference.fileCommentId ?? '');
      return `file_comment:${fileCommentId}:${reaction}:${userId}`;
    }
  }
}

export function parseSlackMessageObjectId(objectId: string): SlackMessageReference | null {
  const [channelId, messageTs, extra] = objectId.split(':');
  if (!channelId || !messageTs || extra) {
    return null;
  }

  return { channelId, messageTs };
}

export function parseSlackThreadObjectId(objectId: string): SlackThreadReference | null {
  const [channelId, threadTs, extra] = objectId.split(':');
  if (!channelId || !threadTs || extra) {
    return null;
  }

  return { channelId, threadTs };
}

export function parseSlackThreadReplyObjectId(objectId: string): SlackThreadReplyReference | null {
  const [channelId, threadTs, replyTs, extra] = objectId.split(':');
  if (!channelId || !threadTs || !replyTs || extra) {
    return null;
  }

  return { channelId, threadTs, replyTs };
}

export function parseSlackReactionObjectId(objectId: string): SlackReactionObjectIdParts | null {
  const segments = objectId.split(':');
  const [targetType] = segments;

  switch (targetType) {
    case 'message': {
      const [, channelId, messageTs, reaction, userId, extra] = segments;
      if (!channelId || !messageTs || !reaction || !userId || extra) {
        return null;
      }
      return { targetType, channelId, messageTs, reaction, userId };
    }
    case 'thread': {
      const [, channelId, threadTs, reaction, userId, extra] = segments;
      if (!channelId || !threadTs || !reaction || !userId || extra) {
        return null;
      }
      return { targetType, channelId, threadTs, reaction, userId };
    }
    case 'thread_reply': {
      const [, channelId, threadTs, replyTs, reaction, userId, extra] = segments;
      if (!channelId || !threadTs || !replyTs || !reaction || !userId || extra) {
        return null;
      }
      return { targetType, channelId, threadTs, replyTs, reaction, userId };
    }
    case 'file': {
      const [, fileId, reaction, userId, extra] = segments;
      if (!fileId || !reaction || !userId || extra) {
        return null;
      }
      return { targetType, fileId, reaction, userId };
    }
    case 'file_comment': {
      const [, fileCommentId, reaction, userId, extra] = segments;
      if (!fileCommentId || !reaction || !userId || extra) {
        return null;
      }
      return { targetType, fileCommentId, reaction, userId };
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Canonical record paths (v2: `<id>__<slug>` segments, `meta.json` records). */
/* -------------------------------------------------------------------------- */

export function channelMetadataPath(channelId: string, channelName?: string): string {
  return joinPath(SLACK_ROOT, 'channels', channelSegmentV2(channelName, channelId), 'meta.json');
}

export function channelMessagesDirectory(channelId: string, channelName?: string): string {
  return joinPath(SLACK_ROOT, 'channels', channelSegmentV2(channelName, channelId), 'messages');
}

/**
 * Canonical message record path. Filename is `meta.json` — matches the
 * convention shared with `adapter-github`, `adapter-linear`, etc. Adapters
 * <= 0.2.2 wrote `message.json`; readers should fall back to that filename
 * via {@link slackMessageReadCandidatePaths}.
 *
 * @param channelId - Slack channel id (e.g. `C0ADE9B71CN`).
 * @param messageTs - Slack timestamp (`<seconds>.<microseconds>`).
 * @param messageText - First ~40 chars of message text; used to build the
 *   `<ts>__<short_slug>` directory segment. Falls back to a bare `<ts>` dir
 *   when omitted (file uploads, deleted messages, etc.).
 * @param channelName - Slack channel name; used for the channel dir segment.
 */
export function messagePath(
  channelId: string,
  messageTs: string,
  messageText?: string,
  channelName?: string,
): string {
  return joinPath(
    channelMessagesDirectory(channelId, channelName),
    messageSegmentV2(messageTs, messageText),
    'meta.json',
  );
}

/**
 * @deprecated v0.2.2 emitted `.../message.json`. Use {@link messagePath}.
 * Retained for back-compat reads only — see {@link slackMessageReadCandidatePaths}.
 */
export function messageLegacyPath(
  channelId: string,
  messageTs: string,
  threadSubject?: string,
  channelName?: string,
): string {
  const tsToken = slackTimestampToPathToken(messageTs);
  const subjectSlug = threadSubject ? slugify(threadSubject) : '';
  const messageSeg = subjectSlug ? `${subjectSlug}--${tsToken}` : tsToken;
  return joinPath(
    SLACK_ROOT,
    'channels',
    channelSegmentLegacy(channelName, channelId),
    'messages',
    messageSeg,
    'message.json',
  );
}

/**
 * Reader hint: candidate paths for a Slack message canonical record, in
 * order of preference. Use to read a message that may have been written by
 * either v2 (this adapter) or a legacy `<= 0.2.2` adapter:
 *
 * ```ts
 * for (const candidate of slackMessageReadCandidatePaths(channelId, ts, text, name)) {
 *   const blob = await vfs.read(candidate);
 *   if (blob) return JSON.parse(blob);
 * }
 * ```
 */
export function slackMessageReadCandidatePaths(
  channelId: string,
  messageTs: string,
  messageText?: string,
  channelName?: string,
): string[] {
  return [
    messagePath(channelId, messageTs, messageText, channelName),
    messageLegacyPath(channelId, messageTs, messageText, channelName),
  ];
}

export function channelThreadsDirectory(channelId: string, channelName?: string): string {
  return joinPath(SLACK_ROOT, 'channels', channelSegmentV2(channelName, channelId), 'threads');
}

export function threadPath(channelId: string, threadTs: string, channelName?: string): string {
  return joinPath(
    channelThreadsDirectory(channelId, channelName),
    slackTimestampToPathToken(threadTs),
    'meta.json',
  );
}

export function threadReplyPath(
  channelId: string,
  threadTs: string,
  replyTs: string,
  channelName?: string,
): string {
  return joinPath(
    channelThreadsDirectory(channelId, channelName),
    slackTimestampToPathToken(threadTs),
    'replies',
    `${slackTimestampToPathToken(replyTs)}.json`,
  );
}

export function userMetadataPath(userId: string, userName?: string): string {
  return joinPath(SLACK_ROOT, 'users', slackNameWithId(userName, userId), 'meta.json');
}

export function fileMetadataPath(fileId: string, fileName?: string): string {
  return joinPath(SLACK_ROOT, 'files', slackNameWithId(fileName, fileId), 'meta.json');
}

export function fileCommentPath(fileCommentId: string): string {
  return joinPath(SLACK_ROOT, 'files', 'comments', `${normalizeSegment(fileCommentId)}.json`);
}

export function reactionPath(reference: SlackReactionReference): string {
  const reactionToken = `${sanitizeSlackPathSegment(reference.reaction)}--${sanitizeSlackPathSegment(
    reference.userId,
  )}.json`;

  switch (reference.targetType) {
    case 'message':
      return joinPath(
        channelMessagesDirectory(reference.channelId ?? ''),
        slackTimestampToPathToken(reference.messageTs ?? ''),
        'reactions',
        reactionToken,
      );
    case 'thread':
      return joinPath(
        channelThreadsDirectory(reference.channelId ?? ''),
        slackTimestampToPathToken(reference.threadTs ?? ''),
        'reactions',
        reactionToken,
      );
    case 'thread_reply':
      return joinPath(
        channelThreadsDirectory(reference.channelId ?? ''),
        slackTimestampToPathToken(reference.threadTs ?? ''),
        'replies',
        slackTimestampToPathToken(reference.replyTs ?? ''),
        'reactions',
        reactionToken,
      );
    case 'file':
      return joinPath(SLACK_ROOT, 'files', normalizeSegment(reference.fileId ?? ''), 'reactions', reactionToken);
    case 'file_comment':
      return joinPath(
        SLACK_ROOT,
        'files',
        'comments',
        normalizeSegment(reference.fileCommentId ?? ''),
        'reactions',
        reactionToken,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Index paths (v2).                                                          */
/* -------------------------------------------------------------------------- */

export function slackRootIndexPath(): string {
  return joinPath(SLACK_ROOT, '_index.json');
}

export function slackChannelsIndexPath(): string {
  return joinPath(SLACK_ROOT, 'channels', '_index.json');
}

export function slackUsersIndexPath(): string {
  return joinPath(SLACK_ROOT, 'users', '_index.json');
}

/* -------------------------------------------------------------------------- */
/* By-name and bot alias paths (v2).                                          */
/* -------------------------------------------------------------------------- */

function aliasFilename(name: string, id: string, colliding: boolean): string {
  const slug = slugifyAlias(name);
  return colliding ? `${slug}-${aliasCollisionSuffix(id)}` : slug;
}

/**
 * Alias path for a Slack channel by its name — `/slack/channels/by-name/<slug>.json`.
 * Mirrors `githubByTitleAliasPath`. Multiple channels can occasionally share a
 * display name; pass `colliding=true` to disambiguate with an id-derived
 * 8-char hash suffix.
 */
export function slackByNameChannelAliasPath(
  channelName: string,
  channelId: string,
  colliding = false,
): string {
  return joinPath(
    SLACK_ROOT,
    'channels',
    'by-name',
    `${aliasFilename(channelName, channelId, colliding)}.json`,
  );
}

/**
 * Alias path for a Slack user by their display name —
 * `/slack/users/by-name/<slug>.json`. Slack user display names are non-unique
 * by design, so callers should pass `colliding=true` when emitting an alias
 * whose slug already exists for a different user id.
 */
export function slackByNameUserAliasPath(
  userName: string,
  userId: string,
  colliding = false,
): string {
  return joinPath(
    SLACK_ROOT,
    'users',
    'by-name',
    `${aliasFilename(userName, userId, colliding)}.json`,
  );
}

/**
 * Alias path for a Slack bot user — `/slack/users/bots/<id>__<slug>.json`.
 * Living under `bots/` makes `ls /slack/users/bots` a one-line "list every
 * bot user" discovery query. The filename uses the canonical `<id>__<slug>`
 * convention so it round-trips by id.
 */
export function slackBotsAliasPath(userId: string, userName?: string): string {
  return joinPath(SLACK_ROOT, 'users', 'bots', `${slackNameWithId(userName, userId)}.json`);
}

export function computeSlackPath(objectType: string, objectId: string): string {
  switch (objectType as SlackPathObjectType) {
    case 'channel':
      return channelMetadataPath(objectId);
    case 'message': {
      const reference = parseSlackMessageObjectId(objectId);
      return reference
        ? messagePath(reference.channelId, reference.messageTs)
        : joinPath(SLACK_ROOT, 'messages', `${normalizeSegment(objectId)}.json`);
    }
    case 'thread': {
      const reference = parseSlackThreadObjectId(objectId);
      return reference
        ? threadPath(reference.channelId, reference.threadTs)
        : joinPath(SLACK_ROOT, 'threads', `${normalizeSegment(objectId)}.json`);
    }
    case 'thread_reply': {
      const reference = parseSlackThreadReplyObjectId(objectId);
      return reference
        ? threadReplyPath(reference.channelId, reference.threadTs, reference.replyTs)
        : joinPath(SLACK_ROOT, 'threads', 'replies', `${normalizeSegment(objectId)}.json`);
    }
    case 'reaction': {
      const reference = parseSlackReactionObjectId(objectId);
      return reference
        ? reactionPath(reference)
        : joinPath(SLACK_ROOT, 'reactions', `${normalizeSegment(objectId)}.json`);
    }
    case 'user':
      return userMetadataPath(objectId);
    case 'file':
      return fileMetadataPath(objectId);
    case 'file_comment':
      return fileCommentPath(objectId);
    default:
      return joinPath(SLACK_ROOT, 'objects', normalizeSegment(objectType), `${normalizeSegment(objectId)}.json`);
  }
}

export { SLACK_ROOT };
