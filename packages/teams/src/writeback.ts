import { GRAPH_API_BASE_URL, type TeamsObjectType, type WritebackTarget } from './types.js';
import {
  makeObjectId,
  parseObjectId,
  parseTeamsPath,
} from './path-mapper.js';

function normalizeWritebackContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!content || typeof content !== 'object') {
    return '';
  }

  const record = content as Record<string, unknown>;
  const body = record.body;
  if (typeof body === 'string') {
    return body;
  }
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).content === 'string') {
    return (body as Record<string, string>).content;
  }
  if (typeof record.text === 'string') {
    return record.text;
  }
  if (typeof record.content === 'string') {
    return record.content;
  }

  return '';
}

export function resolveWriteback(
  path: string,
  content: unknown,
  apiBaseUrl: string = GRAPH_API_BASE_URL,
): WritebackTarget | null {
  const parsed = parseTeamsPath(path);
  if (!parsed) {
    return null;
  }

  const messageContent = normalizeWritebackContent(content);
  const objectId = makeObjectId(parsed.objectType, parsed.parts);

  switch (parsed.objectType) {
    case 'message':
      return {
        objectType: 'message',
        objectId,
        method: 'POST',
        url: `${apiBaseUrl}/teams/${parsed.parts.teamId}/channels/${parsed.parts.channelId}/messages`,
        body: {
          body: {
            contentType: 'html',
            content: messageContent,
          },
        },
      };
    case 'reply':
      return {
        objectType: 'reply',
        objectId,
        method: 'POST',
        url: `${apiBaseUrl}/teams/${parsed.parts.teamId}/channels/${parsed.parts.channelId}/messages/${parsed.parts.messageId}/replies`,
        body: {
          body: {
            contentType: 'html',
            content: messageContent,
          },
        },
      };
    case 'chat_message':
      return {
        objectType: 'chat_message',
        objectId,
        method: 'POST',
        url: `${apiBaseUrl}/chats/${parsed.parts.chatId}/messages`,
        body: {
          body: {
            contentType: 'html',
            content: messageContent,
          },
        },
      };
    default:
      return null;
  }
}

export function resolveWritebackForObject(
  objectType: Extract<TeamsObjectType, 'message' | 'reply' | 'chat_message'>,
  objectId: string,
  content: unknown,
  apiBaseUrl: string = GRAPH_API_BASE_URL,
): WritebackTarget | null {
  const parts = parseObjectId(objectType, objectId);

  switch (objectType) {
    case 'message':
      return resolveWriteback(
        `/teams/${parts.teamId}/channels/${parts.channelId}/messages/${parts.messageId}.json`,
        content,
        apiBaseUrl,
      );
    case 'reply':
      return resolveWriteback(
        `/teams/${parts.teamId}/channels/${parts.channelId}/messages/${parts.messageId}/replies/${parts.replyId}.json`,
        content,
        apiBaseUrl,
      );
    case 'chat_message':
      return resolveWriteback(
        `/teams/chats/${parts.chatId}/messages/${parts.messageId}.json`,
        content,
        apiBaseUrl,
      );
    default:
      return null;
  }
}
