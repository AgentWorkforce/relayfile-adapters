import type { TeamsChannel, TeamsMaterializedRecord, TeamsTab, TeamsTeam } from '../types.js';
import { computePath, makeObjectId } from '../path-mapper.js';

export function materializeTeam(team: TeamsTeam): TeamsMaterializedRecord<TeamsTeam> {
  const objectId = makeObjectId('team', { teamId: team.id });
  return {
    objectType: 'team',
    objectId,
    path: computePath('team', objectId),
    payload: team,
  };
}

export function materializeChannel(
  teamId: string,
  channel: TeamsChannel,
): TeamsMaterializedRecord<TeamsChannel> {
  const objectId = makeObjectId('channel', { teamId, channelId: channel.id });
  return {
    objectType: 'channel',
    objectId,
    path: computePath('channel', objectId),
    payload: channel,
  };
}

export function materializeTab(
  teamId: string,
  channelId: string,
  tab: TeamsTab,
): TeamsMaterializedRecord<TeamsTab> {
  const objectId = makeObjectId('tab', { teamId, channelId, tabId: tab.id });
  return {
    objectType: 'tab',
    objectId,
    path: computePath('tab', objectId),
    payload: tab,
  };
}
