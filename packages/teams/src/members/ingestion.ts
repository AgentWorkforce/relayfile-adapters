import type { TeamsMaterializedRecord, TeamsMember } from '../types.js';
import { computePath, makeObjectId } from '../path-mapper.js';

export function materializeMember(
  teamId: string,
  member: TeamsMember,
): TeamsMaterializedRecord<TeamsMember> {
  const userId = member.userId ?? member.id;
  const objectId = makeObjectId('member', { teamId, userId });
  return {
    objectType: 'member',
    objectId,
    path: computePath('member', objectId),
    payload: {
      ...member,
      userId,
    },
  };
}
