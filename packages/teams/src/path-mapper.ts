import type { TeamsObjectType } from './types.js';

const DEFAULT_ROOT = '/teams';

type PathParts = Record<string, string>;

export function normalizeSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '_');
}

export function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

export function normalizeGraphResource(resource: string): string {
  const trimmed = resource.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = new URL(trimmed);
    return url.pathname.replace(/^\/(?:v1\.0|beta)\//, '/').replace(/\/+$/, '');
  }

  const [pathOnly] = trimmed.split('?');
  return `/${pathOnly.replace(/^\/(?:v1\.0|beta)\//, '').replace(/^\/+/, '')}`.replace(/\/+$/, '');
}

export function makeObjectId(objectType: TeamsObjectType, parts: PathParts): string {
  switch (objectType) {
    case 'team':
      return parts.teamId;
    case 'channel':
      return `${parts.teamId}:${parts.channelId}`;
    case 'message':
      return `${parts.teamId}:${parts.channelId}:${parts.messageId}`;
    case 'reply':
      return `${parts.teamId}:${parts.channelId}:${parts.messageId}:${parts.replyId}`;
    case 'tab':
      return `${parts.teamId}:${parts.channelId}:${parts.tabId}`;
    case 'member':
      return `${parts.teamId}:${parts.userId}`;
    case 'chat':
      return parts.chatId;
    case 'chat_message':
      return `${parts.chatId}:${parts.messageId}`;
    case 'reaction':
      return `${parts.teamId}:${parts.channelId}:${parts.messageId}:${parts.reactionType}:${parts.userId}`;
    default:
      throw new Error(`Unsupported Teams object type: ${objectType}`);
  }
}

export function parseObjectId(objectType: TeamsObjectType, objectId: string): PathParts {
  const parts = objectId.split(':');

  switch (objectType) {
    case 'team':
      return { teamId: parts[0] };
    case 'channel':
      return { teamId: parts[0], channelId: parts[1] };
    case 'message':
      return { teamId: parts[0], channelId: parts[1], messageId: parts[2] };
    case 'reply':
      return { teamId: parts[0], channelId: parts[1], messageId: parts[2], replyId: parts[3] };
    case 'tab':
      return { teamId: parts[0], channelId: parts[1], tabId: parts[2] };
    case 'member':
      return { teamId: parts[0], userId: parts[1] };
    case 'chat':
      return { chatId: parts[0] };
    case 'chat_message':
      return { chatId: parts[0], messageId: parts[1] };
    case 'reaction':
      return {
        teamId: parts[0],
        channelId: parts[1],
        messageId: parts[2],
        reactionType: parts[3],
        userId: parts[4],
      };
    default:
      throw new Error(`Unsupported Teams object type: ${objectType}`);
  }
}

export function computePath(
  objectType: TeamsObjectType,
  objectId: string,
  root: string = DEFAULT_ROOT,
): string {
  const parts = parseObjectId(objectType, objectId);

  switch (objectType) {
    case 'team':
      return joinPath(root, parts.teamId, 'metadata.json');
    case 'channel':
      return joinPath(root, parts.teamId, 'channels', parts.channelId, 'metadata.json');
    case 'message':
      return joinPath(root, parts.teamId, 'channels', parts.channelId, 'messages', `${parts.messageId}.json`);
    case 'reply':
      return joinPath(
        root,
        parts.teamId,
        'channels',
        parts.channelId,
        'messages',
        parts.messageId,
        'replies',
        `${parts.replyId}.json`,
      );
    case 'tab':
      return joinPath(root, parts.teamId, 'channels', parts.channelId, 'tabs', `${parts.tabId}.json`);
    case 'member':
      return joinPath(root, parts.teamId, 'members', `${parts.userId}.json`);
    case 'chat':
      return joinPath(root, 'chats', parts.chatId, 'metadata.json');
    case 'chat_message':
      return joinPath(root, 'chats', parts.chatId, 'messages', `${parts.messageId}.json`);
    case 'reaction':
      return joinPath(
        root,
        parts.teamId,
        'channels',
        parts.channelId,
        'messages',
        parts.messageId,
        'reactions',
        `${normalizeSegment(parts.reactionType)}--${parts.userId}.json`,
      );
    default:
      throw new Error(`Cannot compute path for unsupported Teams object type: ${objectType}`);
  }
}

export function parseTeamsPath(path: string): { objectType: TeamsObjectType; parts: PathParts } | null {
  const normalized = path.replace(/\/+$/, '');

  let match =
    normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'reply',
      parts: { teamId: match[1], channelId: match[2], messageId: match[3], replyId: match[4] },
    };
  }

  match =
    normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/-]+)--([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'reaction',
      parts: {
        teamId: match[1],
        channelId: match[2],
        messageId: match[3],
        reactionType: match[4],
        userId: match[5],
      },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'message',
      parts: { teamId: match[1], channelId: match[2], messageId: match[3] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/tabs\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'tab',
      parts: { teamId: match[1], channelId: match[2], tabId: match[3] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/metadata\.json$/);
  if (match) {
    return {
      objectType: 'channel',
      parts: { teamId: match[1], channelId: match[2] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/members\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'member',
      parts: { teamId: match[1], userId: match[2] },
    };
  }

  match = normalized.match(/^\/teams\/chats\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'chat_message',
      parts: { chatId: match[1], messageId: match[2] },
    };
  }

  match = normalized.match(/^\/teams\/chats\/([^/]+)\/metadata\.json$/);
  if (match) {
    return {
      objectType: 'chat',
      parts: { chatId: match[1] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/metadata\.json$/);
  if (match) {
    return {
      objectType: 'team',
      parts: { teamId: match[1] },
    };
  }

  return null;
}

export function parseResourceUrl(resource: string): { objectType: TeamsObjectType; parts: PathParts } | null {
  const normalized = normalizeGraphResource(resource);

  let match =
    normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'reply',
      parts: { teamId: match[1], channelId: match[2], messageId: match[3], replyId: match[4] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'message',
      parts: { teamId: match[1], channelId: match[2], messageId: match[3] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/tabs\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'tab',
      parts: { teamId: match[1], channelId: match[2], tabId: match[3] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'channel',
      parts: { teamId: match[1], channelId: match[2] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'member',
      parts: { teamId: match[1], userId: match[2] },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)$/);
  if (match && !normalized.includes('/channels/') && !normalized.includes('/members/')) {
    return {
      objectType: 'team',
      parts: { teamId: match[1] },
    };
  }

  match = normalized.match(/^\/chats\/([^/]+)\/messages\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'chat_message',
      parts: { chatId: match[1], messageId: match[2] },
    };
  }

  match = normalized.match(/^\/chats\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'chat',
      parts: { chatId: match[1] },
    };
  }

  return null;
}
