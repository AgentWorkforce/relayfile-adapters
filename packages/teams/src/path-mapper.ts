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

  const [pathOnly = ''] = trimmed.split('?');
  return `/${pathOnly.replace(/^\/(?:v1\.0|beta)\//, '').replace(/^\/+/, '')}`.replace(/\/+$/, '');
}

function requirePart(parts: PathParts, key: string, objectType: TeamsObjectType): string {
  const value = parts[key];
  if (!value) {
    throw new Error(`Missing ${key} for Teams ${objectType} object`);
  }
  return value;
}

function capture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error('Unexpected Teams path parser match without capture group');
  }
  return value;
}

export function makeObjectId(objectType: TeamsObjectType, parts: PathParts): string {
  switch (objectType) {
    case 'team':
      return requirePart(parts, 'teamId', objectType);
    case 'channel':
      return `${requirePart(parts, 'teamId', objectType)}:${requirePart(parts, 'channelId', objectType)}`;
    case 'message':
      return `${requirePart(parts, 'teamId', objectType)}:${requirePart(parts, 'channelId', objectType)}:${requirePart(parts, 'messageId', objectType)}`;
    case 'reply':
      return `${requirePart(parts, 'teamId', objectType)}:${requirePart(parts, 'channelId', objectType)}:${requirePart(parts, 'messageId', objectType)}:${requirePart(parts, 'replyId', objectType)}`;
    case 'tab':
      return `${requirePart(parts, 'teamId', objectType)}:${requirePart(parts, 'channelId', objectType)}:${requirePart(parts, 'tabId', objectType)}`;
    case 'member':
      return `${requirePart(parts, 'teamId', objectType)}:${requirePart(parts, 'userId', objectType)}`;
    case 'chat':
      return requirePart(parts, 'chatId', objectType);
    case 'chat_message':
      return `${requirePart(parts, 'chatId', objectType)}:${requirePart(parts, 'messageId', objectType)}`;
    case 'reaction':
      return `${requirePart(parts, 'teamId', objectType)}:${requirePart(parts, 'channelId', objectType)}:${requirePart(parts, 'messageId', objectType)}:${requirePart(parts, 'reactionType', objectType)}:${requirePart(parts, 'userId', objectType)}`;
    default:
      throw new Error(`Unsupported Teams object type: ${objectType}`);
  }
}

export function parseObjectId(objectType: TeamsObjectType, objectId: string): PathParts {
  const parts = objectId.split(':');
  const get = (index: number, key: string): string => {
    const value = parts[index];
    if (!value) {
      throw new Error(`Invalid Teams ${objectType} object id "${objectId}": missing ${key}`);
    }
    return value;
  };

  switch (objectType) {
    case 'team':
      return { teamId: get(0, 'teamId') };
    case 'channel':
      return { teamId: get(0, 'teamId'), channelId: get(1, 'channelId') };
    case 'message':
      return { teamId: get(0, 'teamId'), channelId: get(1, 'channelId'), messageId: get(2, 'messageId') };
    case 'reply':
      return { teamId: get(0, 'teamId'), channelId: get(1, 'channelId'), messageId: get(2, 'messageId'), replyId: get(3, 'replyId') };
    case 'tab':
      return { teamId: get(0, 'teamId'), channelId: get(1, 'channelId'), tabId: get(2, 'tabId') };
    case 'member':
      return { teamId: get(0, 'teamId'), userId: get(1, 'userId') };
    case 'chat':
      return { chatId: get(0, 'chatId') };
    case 'chat_message':
      return { chatId: get(0, 'chatId'), messageId: get(1, 'messageId') };
    case 'reaction':
      return {
        teamId: get(0, 'teamId'),
        channelId: get(1, 'channelId'),
        messageId: get(2, 'messageId'),
        reactionType: get(3, 'reactionType'),
        userId: get(4, 'userId'),
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
      return joinPath(root, requirePart(parts, 'teamId', objectType), 'metadata.json');
    case 'channel':
      return joinPath(root, requirePart(parts, 'teamId', objectType), 'channels', requirePart(parts, 'channelId', objectType), 'metadata.json');
    case 'message':
      return joinPath(root, requirePart(parts, 'teamId', objectType), 'channels', requirePart(parts, 'channelId', objectType), 'messages', `${requirePart(parts, 'messageId', objectType)}.json`);
    case 'reply':
      return joinPath(
        root,
        requirePart(parts, 'teamId', objectType),
        'channels',
        requirePart(parts, 'channelId', objectType),
        'messages',
        requirePart(parts, 'messageId', objectType),
        'replies',
        `${requirePart(parts, 'replyId', objectType)}.json`,
      );
    case 'tab':
      return joinPath(root, requirePart(parts, 'teamId', objectType), 'channels', requirePart(parts, 'channelId', objectType), 'tabs', `${requirePart(parts, 'tabId', objectType)}.json`);
    case 'member':
      return joinPath(root, requirePart(parts, 'teamId', objectType), 'members', `${requirePart(parts, 'userId', objectType)}.json`);
    case 'chat':
      return joinPath(root, 'chats', requirePart(parts, 'chatId', objectType), 'metadata.json');
    case 'chat_message':
      return joinPath(root, 'chats', requirePart(parts, 'chatId', objectType), 'messages', `${requirePart(parts, 'messageId', objectType)}.json`);
    case 'reaction':
      return joinPath(
        root,
        requirePart(parts, 'teamId', objectType),
        'channels',
        requirePart(parts, 'channelId', objectType),
        'messages',
        requirePart(parts, 'messageId', objectType),
        'reactions',
        `${normalizeSegment(requirePart(parts, 'reactionType', objectType))}--${requirePart(parts, 'userId', objectType)}.json`,
      );
    default:
      throw new Error(`Cannot compute path for unsupported Teams object type: ${objectType}`);
  }
}

export function parseTeamsPath(path: string): { objectType: TeamsObjectType; parts: PathParts } | null {
  const normalized = path.replace(/\/+$/, '');

  let match =
    normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/new\.json$/);
  if (match) {
    return {
      objectType: 'reply',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2), messageId: capture(match, 3), replyId: 'new' },
    };
  }

  match =
    normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'reply',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2), messageId: capture(match, 3), replyId: capture(match, 4) },
    };
  }

  match =
    normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/-]+)--([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'reaction',
      parts: {
        teamId: capture(match, 1),
        channelId: capture(match, 2),
        messageId: capture(match, 3),
        reactionType: capture(match, 4),
        userId: capture(match, 5),
      },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/new\.json$/);
  if (match) {
    return {
      objectType: 'message',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2), messageId: 'new' },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'message',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2), messageId: capture(match, 3) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/tabs\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'tab',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2), tabId: capture(match, 3) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/metadata\.json$/);
  if (match) {
    return {
      objectType: 'channel',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/members\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'member',
      parts: { teamId: capture(match, 1), userId: capture(match, 2) },
    };
  }

  match = normalized.match(/^\/teams\/chats\/([^/]+)\/messages\/new\.json$/);
  if (match) {
    return {
      objectType: 'chat_message',
      parts: { chatId: capture(match, 1), messageId: 'new' },
    };
  }

  match = normalized.match(/^\/teams\/chats\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (match) {
    return {
      objectType: 'chat_message',
      parts: { chatId: capture(match, 1), messageId: capture(match, 2) },
    };
  }

  match = normalized.match(/^\/teams\/chats\/([^/]+)\/metadata\.json$/);
  if (match) {
    return {
      objectType: 'chat',
      parts: { chatId: capture(match, 1) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/metadata\.json$/);
  if (match) {
    return {
      objectType: 'team',
      parts: { teamId: capture(match, 1) },
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
      parts: { teamId: capture(match, 1), channelId: capture(match, 2), messageId: capture(match, 3), replyId: capture(match, 4) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'message',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2), messageId: capture(match, 3) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/tabs\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'tab',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2), tabId: capture(match, 3) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/channels\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'channel',
      parts: { teamId: capture(match, 1), channelId: capture(match, 2) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'member',
      parts: { teamId: capture(match, 1), userId: capture(match, 2) },
    };
  }

  match = normalized.match(/^\/teams\/([^/]+)$/);
  if (match && !normalized.includes('/channels/') && !normalized.includes('/members/')) {
    return {
      objectType: 'team',
      parts: { teamId: capture(match, 1) },
    };
  }

  match = normalized.match(/^\/chats\/([^/]+)\/messages\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'chat_message',
      parts: { chatId: capture(match, 1), messageId: capture(match, 2) },
    };
  }

  match = normalized.match(/^\/chats\/([^/]+)$/);
  if (match) {
    return {
      objectType: 'chat',
      parts: { chatId: capture(match, 1) },
    };
  }

  return null;
}
