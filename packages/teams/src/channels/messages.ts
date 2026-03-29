import type {
  TeamsChatMessage,
  TeamsMaterializedRecord,
  TeamsReaction,
} from '../types.js';
import { computePath, makeObjectId } from '../path-mapper.js';

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/g;

export function materializeMessage(
  teamId: string,
  channelId: string,
  message: TeamsChatMessage,
): TeamsMaterializedRecord<TeamsChatMessage> {
  if (message.replyToId) {
    return materializeReply(teamId, channelId, message.replyToId, message);
  }

  const objectId = makeObjectId('message', {
    teamId,
    channelId,
    messageId: message.id,
  });

  return {
    objectType: 'message',
    objectId,
    path: computePath('message', objectId),
    payload: message,
  };
}

export function materializeReply(
  teamId: string,
  channelId: string,
  parentMessageId: string,
  reply: TeamsChatMessage,
): TeamsMaterializedRecord<TeamsChatMessage> {
  const objectId = makeObjectId('reply', {
    teamId,
    channelId,
    messageId: parentMessageId,
    replyId: reply.id,
  });

  return {
    objectType: 'reply',
    objectId,
    path: computePath('reply', objectId),
    payload: reply,
  };
}

export function materializeMessageReactions(
  teamId: string,
  channelId: string,
  messageId: string,
  reactions: TeamsReaction[] | undefined,
): TeamsMaterializedRecord<TeamsReaction>[] {
  if (!reactions?.length) {
    return [];
  }

  const files: TeamsMaterializedRecord<TeamsReaction>[] = [];
  for (const reaction of reactions) {
    const userId = reaction.user?.user?.id;
    if (!userId) {
      continue;
    }

    const objectId = makeObjectId('reaction', {
      teamId,
      channelId,
      messageId,
      reactionType: reaction.reactionType,
      userId,
    });

    files.push({
      objectType: 'reaction',
      objectId,
      path: computePath('reaction', objectId),
      payload: reaction,
    });
  }

  return files;
}

export function extractMessageText(message: TeamsChatMessage): string {
  return (
    message.body?.content
      ?.replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

export function extractMessageRelations(
  teamId: string,
  channelId: string,
  message: TeamsChatMessage,
): string[] {
  const relations = new Set<string>();
  relations.add(`team:${teamId}`);
  relations.add(`channel:${teamId}:${channelId}`);

  const senderId = message.from?.user?.id ?? message.from?.application?.id;
  if (senderId) {
    relations.add(`user:${senderId}`);
  }

  if (message.replyToId) {
    relations.add(`reply_to:${teamId}:${channelId}:${message.replyToId}`);
  }

  for (const mention of message.mentions ?? []) {
    const mentionedUserId = mention.mentioned?.user?.id;
    if (mentionedUserId) {
      relations.add(`mentions:user:${mentionedUserId}`);
    }
  }

  const text = extractMessageText(message);
  const inlineUrls = text.match(URL_PATTERN) ?? [];
  const htmlUrls = message.body?.content?.match(/href="([^"]+)"/gi) ?? [];
  const urls = [
    ...inlineUrls,
    ...htmlUrls.map((entry) => entry.replace(/^href="/i, '').replace(/"$/i, '')),
  ];
  for (const url of urls) {
    relations.add(`link:${url}`);
  }

  for (const attachment of message.attachments ?? []) {
    if (attachment.contentUrl) {
      relations.add(`attachment:${attachment.contentUrl}`);
    }
  }

  return [...relations];
}
