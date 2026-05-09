import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { GRAPH_API_BASE_URL, type TeamsObjectType, type WritebackTarget } from './types.js';
import {
  makeObjectId,
  parseObjectId,
} from './path-mapper.js';
import { resources } from './resources.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

function normalizeWritebackContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!content || typeof content !== 'object') {
    return '';
  }

  const record = content as Record<string, unknown>;
  rejectReadOnlyFields(record);
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
  const parsed = parseWritebackPath(path);
  if (!parsed) {
    return null;
  }

  const messageContent = normalizeWritebackContent(content);
  if (!messageContent.trim()) {
    throw new Error('Teams message writeback requires `body.content`, `text`, or `content`');
  }
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

const READ_ONLY_FIELDS = new Set([
  'id',
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

export function resolveDeleteRequest(
  path: string,
  apiBaseUrl: string = GRAPH_API_BASE_URL,
): WritebackTarget | null {
  const parsed = parseWritebackPath(path, 'delete');
  if (!parsed || !parsed.canonical) {
    return null;
  }
  const objectId = makeObjectId(parsed.objectType, parsed.parts);

  switch (parsed.objectType) {
    case 'message':
      return {
        objectType: 'message',
        objectId,
        method: 'DELETE',
        url: `${apiBaseUrl}/teams/${parsed.parts.teamId}/channels/${parsed.parts.channelId}/messages/${parsed.parts.messageId}`,
      };
    case 'reply':
      return {
        objectType: 'reply',
        objectId,
        method: 'DELETE',
        url: `${apiBaseUrl}/teams/${parsed.parts.teamId}/channels/${parsed.parts.channelId}/messages/${parsed.parts.messageId}/replies/${parsed.parts.replyId}`,
      };
    case 'chat_message':
      return {
        objectType: 'chat_message',
        objectId,
        method: 'DELETE',
        url: `${apiBaseUrl}/chats/${parsed.parts.chatId}/messages/${parsed.parts.messageId}`,
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

function parseWritebackPath(
  path: string,
  fsEvent: 'write' | 'delete' = 'write',
):
  | { canonical: boolean; objectType: Extract<TeamsObjectType, 'message' | 'reply' | 'chat_message'>; parts: Record<string, string> }
  | null {
  const route = classifyWrite(path, resources, { fsEvent });
  if (!route) return null;

  const messageMatch = path.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (route.resource.path === '/teams/{teamId}/channels/{channelId}/messages' && messageMatch?.[1] && messageMatch[2] && messageMatch[3]) {
    return {
      canonical: route.canonical,
      objectType: 'message',
      parts: { teamId: messageMatch[1], channelId: messageMatch[2], messageId: messageMatch[3] },
    };
  }

  const replyMatch = path.match(/^\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\/replies\/([^/]+)\.json$/);
  if (route.resource.path === '/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies' && replyMatch?.[1] && replyMatch[2] && replyMatch[3] && replyMatch[4]) {
    return {
      canonical: route.canonical,
      objectType: 'reply',
      parts: { teamId: replyMatch[1], channelId: replyMatch[2], messageId: replyMatch[3], replyId: replyMatch[4] },
    };
  }

  const chatMatch = path.match(/^\/teams\/chats\/([^/]+)\/messages\/([^/]+)\.json$/);
  if (route.resource.path === '/teams/chats/{chatId}/messages' && chatMatch?.[1] && chatMatch[2]) {
    return {
      canonical: route.canonical,
      objectType: 'chat_message',
      parts: { chatId: chatMatch[1], messageId: chatMatch[2] },
    };
  }

  return null;
}
