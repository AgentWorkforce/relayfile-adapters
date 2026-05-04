const SLACK_ROOT = '/slack';

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

function namedSegment(name: string | undefined, id: string): string {
  const slug = name ? slugify(name) : '';
  return slug || normalizeSegment(id);
}

function messageSegment(messageTs: string, subject?: string): string {
  const tsToken = slackTimestampToPathToken(messageTs);
  const subjectSlug = subject ? slugify(subject) : '';
  return subjectSlug ? `${subjectSlug}--${tsToken}` : tsToken;
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

export function channelMetadataPath(channelId: string, channelName?: string): string {
  return joinPath(SLACK_ROOT, 'channels', namedSegment(channelName, channelId), 'meta.json');
}

export function channelMessagesDirectory(channelId: string, channelName?: string): string {
  return joinPath(SLACK_ROOT, 'channels', namedSegment(channelName, channelId), 'messages');
}

export function messagePath(
  channelId: string,
  messageTs: string,
  threadSubject?: string,
  channelName?: string,
): string {
  return joinPath(
    channelMessagesDirectory(channelId, channelName),
    messageSegment(messageTs, threadSubject),
    'message.json',
  );
}

export function channelThreadsDirectory(channelId: string): string {
  return joinPath(SLACK_ROOT, 'channels', normalizeSegment(channelId), 'threads');
}

export function threadPath(channelId: string, threadTs: string): string {
  return joinPath(
    channelThreadsDirectory(channelId),
    slackTimestampToPathToken(threadTs),
    'meta.json',
  );
}

export function threadReplyPath(channelId: string, threadTs: string, replyTs: string): string {
  return joinPath(
    channelThreadsDirectory(channelId),
    slackTimestampToPathToken(threadTs),
    'replies',
    `${slackTimestampToPathToken(replyTs)}.json`,
  );
}

export function userMetadataPath(userId: string, userName?: string): string {
  return joinPath(SLACK_ROOT, 'users', namedSegment(userName, userId), 'meta.json');
}

export function fileMetadataPath(fileId: string, fileName?: string): string {
  return joinPath(SLACK_ROOT, 'files', namedSegment(fileName, fileId), 'meta.json');
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
