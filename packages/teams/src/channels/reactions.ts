import type { TeamsMaterializedRecord, TeamsReaction } from '../types.js';
import { computePath, makeObjectId } from '../path-mapper.js';

export function materializeReaction(
  teamId: string,
  channelId: string,
  messageId: string,
  reaction: TeamsReaction,
  userId: string,
): TeamsMaterializedRecord<TeamsReaction> {
  const objectId = makeObjectId('reaction', {
    teamId,
    channelId,
    messageId,
    reactionType: reaction.reactionType,
    userId,
  });

  return {
    objectType: 'reaction',
    objectId,
    path: computePath('reaction', objectId),
    payload: reaction,
  };
}
