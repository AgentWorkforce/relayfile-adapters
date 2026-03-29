import {
  GRAPH_API_BASE_URL,
  type BulkIngestOptions,
  type BulkIngestResult,
  type GraphCollectionResponse,
  type TeamsAdapterConfig,
  type TeamsChannel,
  type TeamsChat,
  type TeamsChatMessage,
  type TeamsMaterializedRecord,
  type TeamsMember,
  type TeamsTab,
  type TeamsTeam,
} from './types.js';
import { materializeChannel, materializeTab, materializeTeam } from './channels/ingestion.js';
import { materializeMessage, materializeMessageReactions } from './channels/messages.js';
import { materializeChat, materializeChatMessage } from './chats/ingestion.js';
import { materializeMember } from './members/ingestion.js';

function getFetch(config: TeamsAdapterConfig): typeof fetch {
  return config.fetchImpl ?? fetch;
}

async function getAccessToken(config: TeamsAdapterConfig): Promise<string> {
  return typeof config.accessToken === 'function' ? config.accessToken() : config.accessToken;
}

async function graphJson<T>(
  config: TeamsAdapterConfig,
  pathOrUrl: string,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getAccessToken(config);
  const isAbsolute = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://');
  const url = isAbsolute ? pathOrUrl : `${config.apiBaseUrl ?? GRAPH_API_BASE_URL}${pathOrUrl}`;
  const response = await getFetch(config)(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`GET ${pathOrUrl} failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function graphCollection<T>(
  config: TeamsAdapterConfig,
  pathOrUrl: string,
  signal?: AbortSignal,
): Promise<GraphCollectionResponse<T>> {
  return graphJson<GraphCollectionResponse<T>>(config, pathOrUrl, signal);
}

async function graphCollectAll<T>(
  config: TeamsAdapterConfig,
  pathOrUrl: string,
  signal?: AbortSignal,
): Promise<{ items: T[]; deltaLink?: string }> {
  const items: T[] = [];
  let nextUrl: string | undefined = pathOrUrl;
  let deltaLink: string | undefined;

  while (nextUrl) {
    const page: GraphCollectionResponse<T> = await graphCollection<T>(config, nextUrl, signal);
    items.push(...page.value);
    nextUrl = page['@odata.nextLink'];
    deltaLink = page['@odata.deltaLink'] ?? deltaLink;
  }

  return { items, deltaLink };
}

async function collectChannelMessages(
  config: TeamsAdapterConfig,
  teamId: string,
  channelId: string,
  options: BulkIngestOptions,
): Promise<{ files: TeamsMaterializedRecord[]; deltaLink?: string }> {
  const basePath =
    options.messageMode === 'delta'
      ? options.deltaLinks?.[channelId] ?? `/teams/${teamId}/channels/${channelId}/messages/delta`
      : `/teams/${teamId}/channels/${channelId}/messages`;

  const { items: rootMessages, deltaLink } = await graphCollectAll<TeamsChatMessage>(
    config,
    basePath,
    options.signal,
  );

  const files: TeamsMaterializedRecord[] = [];
  for (const message of rootMessages) {
    const materialized = materializeMessage(teamId, channelId, message);
    files.push(materialized);

    const reactionOwnerId = message.replyToId ? message.replyToId : message.id;
    files.push(...materializeMessageReactions(teamId, channelId, reactionOwnerId, message.reactions));

    if (!options.includeReplies || message.replyToId) {
      continue;
    }

    const replies = await graphCollectAll<TeamsChatMessage>(
      config,
      `/teams/${teamId}/channels/${channelId}/messages/${message.id}/replies`,
      options.signal,
    );

    for (const reply of replies.items) {
      files.push(materializeMessage(teamId, channelId, { ...reply, replyToId: message.id }));
      files.push(...materializeMessageReactions(teamId, channelId, reply.id, reply.reactions));
    }
  }

  return { files, deltaLink };
}

export async function bulkIngestTeam(
  config: TeamsAdapterConfig,
  teamId: string,
  options: BulkIngestOptions = {},
): Promise<BulkIngestResult> {
  const files: TeamsMaterializedRecord[] = [];
  const deltaLinks: Record<string, string> = {};

  const team = await graphJson<TeamsTeam>(config, `/teams/${teamId}`, options.signal);
  files.push(materializeTeam(team));

  if (options.includeMembers !== false) {
    const members = await graphCollectAll<TeamsMember>(
      config,
      `/teams/${teamId}/members`,
      options.signal,
    );
    for (const member of members.items) {
      files.push(materializeMember(teamId, member));
    }
  }

  const channels = await graphCollectAll<TeamsChannel>(
    config,
    `/teams/${teamId}/channels`,
    options.signal,
  );

  for (const channel of channels.items) {
    if (options.channelIds?.length && !options.channelIds.includes(channel.id)) {
      continue;
    }

    files.push(materializeChannel(teamId, channel));

    if (options.includeTabs) {
      const tabs = await graphCollectAll<TeamsTab>(
        config,
        `/teams/${teamId}/channels/${channel.id}/tabs`,
        options.signal,
      );
      for (const tab of tabs.items) {
        files.push(materializeTab(teamId, channel.id, tab));
      }
    }

    if (options.includeMessages === false) {
      continue;
    }

    const messageResult = await collectChannelMessages(config, teamId, channel.id, {
      includeReplies: options.includeReplies !== false,
      messageMode: options.messageMode ?? 'list',
      deltaLinks: options.deltaLinks,
      signal: options.signal,
    });
    files.push(...messageResult.files);
    if (messageResult.deltaLink) {
      deltaLinks[channel.id] = messageResult.deltaLink;
    }
  }

  return { files, deltaLinks };
}

export async function bulkIngestChat(
  config: TeamsAdapterConfig,
  chatId: string,
  signal?: AbortSignal,
): Promise<TeamsMaterializedRecord[]> {
  const files: TeamsMaterializedRecord[] = [];

  const chat = await graphJson<TeamsChat>(config, `/chats/${chatId}`, signal);
  files.push(materializeChat(chat));

  const messages = await graphCollectAll<TeamsChatMessage>(
    config,
    `/chats/${chatId}/messages`,
    signal,
  );

  for (const message of messages.items) {
    files.push(materializeChatMessage(chatId, message));
  }

  return files;
}
