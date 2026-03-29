import type {
  TeamsChat,
  TeamsChatMessage,
  TeamsMaterializedRecord,
} from '../types.js';
import { computePath, makeObjectId } from '../path-mapper.js';

export function materializeChat(chat: TeamsChat): TeamsMaterializedRecord<TeamsChat> {
  const objectId = makeObjectId('chat', { chatId: chat.id });
  return {
    objectType: 'chat',
    objectId,
    path: computePath('chat', objectId),
    payload: chat,
  };
}

export function materializeChatMessage(
  chatId: string,
  message: TeamsChatMessage,
): TeamsMaterializedRecord<TeamsChatMessage> {
  const objectId = makeObjectId('chat_message', { chatId, messageId: message.id });
  return {
    objectType: 'chat_message',
    objectId,
    path: computePath('chat_message', objectId),
    payload: {
      ...message,
      chatId,
    },
  };
}
