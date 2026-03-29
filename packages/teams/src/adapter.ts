import { IntegrationProvider, type RelayFileClient } from '@relayfile/sdk';
import type { FileSemantics, QueuedResponse, WriteFileInput } from '@relayfile/sdk';
import type {
  ChangeNotificationPayload,
  NormalizedTeamsWebhook,
  TeamsAdapterConfig,
  TeamsChatMessage,
  TeamsEventType,
  TeamsMaterializedRecord,
  TeamsObjectType,
} from './types.js';
import { computePath, parseObjectId } from './path-mapper.js';
import { materializeChannel, materializeTab, materializeTeam } from './channels/ingestion.js';
import {
  extractMessageRelations,
  extractMessageText,
  materializeMessage,
  materializeMessageReactions,
} from './channels/messages.js';
import { materializeChat, materializeChatMessage } from './chats/ingestion.js';
import { materializeMember } from './members/ingestion.js';
import { extractValidationToken } from './notification/validator.js';
import { processNotifications } from './notification/handler.js';

const SUPPORTED_EVENTS: TeamsEventType[] = [
  'team.updated',
  'team.deleted',
  'channel.created',
  'channel.updated',
  'channel.deleted',
  'message.created',
  'message.updated',
  'message.deleted',
  'reply.created',
  'reply.updated',
  'reply.deleted',
  'member.created',
  'member.updated',
  'member.deleted',
  'chat.created',
  'chat.updated',
  'chat.deleted',
  'chat_message.created',
  'chat_message.updated',
  'chat_message.deleted',
];

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue(record[key]);
        return acc;
      }, {});
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export class TeamsAdapter extends IntegrationProvider {
  readonly name = 'teams';
  readonly version = '0.1.0';

  constructor(
    client: RelayFileClient,
    private readonly config: TeamsAdapterConfig,
  ) {
    super(client);
  }

  supportedEvents(): string[] {
    return [...SUPPORTED_EVENTS];
  }

  async ingestWebhook(
    workspaceId: string,
    rawInput: unknown,
    signal?: AbortSignal,
  ): Promise<QueuedResponse> {
    const input = (rawInput ?? {}) as {
      queryParams?: Record<string, string | string[] | undefined>;
      body?: ChangeNotificationPayload;
    };

    const validation = input.queryParams ? extractValidationToken(input.queryParams) : { isValidation: false };
    if (validation.isValidation) {
      return {
        status: 'queued',
        id: `validation:${validation.validationToken}`,
      };
    }

    if (!input.body?.value?.length) {
      return {
        status: 'queued',
        id: `teams:no-op:${Date.now()}`,
      };
    }

    const events = await processNotifications(input.body, {
      config: this.config,
      signal,
    });

    for (const event of events) {
      const records = this.materializeEvent(event);
      for (const record of records) {
        if (signal?.aborted) {
          break;
        }

        const semantics = this.computeSemantics(
          record.objectType,
          record.objectId,
          asRecord(record.payload) ?? { value: record.payload },
        );
        const baseRevision = await this.getBaseRevision(workspaceId, record.path);
        const content = stableStringify({
          provider: 'teams',
          connectionId: event.connectionId || this.config.connectionId || '',
          eventType: event.eventType,
          objectType: record.objectType,
          objectId: record.objectId,
          workspaceId,
          payload: record.payload,
        });

        await this.client.writeFile({
          workspaceId,
          path: record.path,
          baseRevision,
          content,
          contentType: 'application/json',
          encoding: 'utf-8',
          semantics,
        } as WriteFileInput);
      }
    }

    return {
      status: 'queued',
      id: `teams:ingest:${events.length}:${Date.now()}`,
    };
  }

  computePath(objectType: string, objectId: string): string {
    return computePath(
      objectType as TeamsObjectType,
      objectId,
      this.config.filesRoot ?? '/teams',
    );
  }

  computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const properties: Record<string, string> = {
      object_type: objectType,
      object_id: objectId,
    };
    const relations = new Set<string>();
    const permissions = new Set<string>();
    const comments = new Set<string>();

    const message = payload as TeamsChatMessage;
    const senderId = message.from?.user?.id ?? message.from?.application?.id;
    if (senderId) {
      properties.user_id = senderId;
      relations.add(`user:${senderId}`);
    }

    if (objectType === 'message' || objectType === 'reply') {
      const teamId = asString(payload.teamId);
      const channelId = asString(payload.channelId);
      if (teamId) {
        properties.team_id = teamId;
        relations.add(`team:${teamId}`);
      }
      if (channelId) {
        properties.channel_id = channelId;
        relations.add(`channel:${teamId ?? 'unknown'}:${channelId}`);
      }
      if (message.replyToId) {
        properties.reply_to_id = message.replyToId;
      }

      const preview = extractMessageText(message);
      if (preview) {
        properties.text_preview = preview.slice(0, 200);
      }
      if (message.importance) {
        properties.importance = message.importance;
      }
      for (const relation of extractMessageRelations(teamId ?? 'unknown', channelId ?? 'unknown', message)) {
        relations.add(relation);
      }
      permissions.add('scope:team');
    } else if (objectType === 'chat_message') {
      const chatId = asString(payload.chatId);
      if (chatId) {
        properties.chat_id = chatId;
        relations.add(`chat:${chatId}`);
      }
      const preview = extractMessageText(message);
      if (preview) {
        properties.text_preview = preview.slice(0, 200);
      }
      permissions.add('scope:chat');
    } else if (objectType === 'member') {
      const teamId = asString(payload.teamId);
      const userId = asString(payload.userId) ?? asString(payload.id);
      if (teamId) {
        properties.team_id = teamId;
        relations.add(`team:${teamId}`);
      }
      if (userId) {
        properties.user_id = userId;
        relations.add(`user:${userId}`);
      }
      permissions.add('scope:membership');
    } else if (objectType === 'reaction') {
      const reactionType = asString(payload.reactionType);
      if (reactionType) {
        properties.reaction_type = reactionType;
        comments.add(`reaction:${reactionType}`);
      }
    }

    if (message.createdDateTime) {
      properties.created_at = message.createdDateTime;
    }
    if (message.lastModifiedDateTime) {
      properties.updated_at = message.lastModifiedDateTime;
    }
    if (message.deletedDateTime) {
      properties.deleted_at = message.deletedDateTime;
    }

    return {
      properties,
      relations: [...relations],
      permissions: [...permissions],
      comments: [...comments],
    };
  }

  private materializeEvent(event: NormalizedTeamsWebhook): TeamsMaterializedRecord[] {
    const payload = event.payload ?? {};
    const record = asRecord(payload);
    const fallbackParts = parseObjectId(event.objectType, event.objectId);

    switch (event.objectType) {
      case 'team': {
        const teamId = (record?.teamId as string) ?? fallbackParts.teamId;
        return [materializeTeam({ ...(record ?? {}), id: (record?.id as string) ?? teamId })];
      }
      case 'channel':
        return [
          materializeChannel((record?.teamId as string) ?? fallbackParts.teamId, {
            ...(record ?? {}),
            id: (record?.channelId as string) ?? (record?.id as string) ?? fallbackParts.channelId,
          }),
        ];
      case 'tab':
        return [
          materializeTab(
            (record?.teamId as string) ?? fallbackParts.teamId,
            (record?.channelId as string) ?? fallbackParts.channelId,
            {
              ...(record ?? {}),
              id: (record?.tabId as string) ?? (record?.id as string) ?? fallbackParts.tabId,
            },
          ),
        ];
      case 'member':
        return [
          materializeMember((record?.teamId as string) ?? fallbackParts.teamId, {
            ...(record ?? {}),
            id: (record?.id as string) ?? (record?.userId as string) ?? fallbackParts.userId,
            userId: (record?.userId as string) ?? (record?.id as string) ?? fallbackParts.userId,
          }),
        ];
      case 'chat':
        return [
          materializeChat({
            ...(record ?? {}),
            id: (record?.chatId as string) ?? (record?.id as string) ?? fallbackParts.chatId,
          }),
        ];
      case 'chat_message':
        return [
          materializeChatMessage((record?.chatId as string) ?? fallbackParts.chatId, {
            ...(record ?? {}),
            id: (record?.messageId as string) ?? (record?.id as string) ?? fallbackParts.messageId,
          } as TeamsChatMessage),
        ];
      case 'message':
      case 'reply': {
        const teamId = (record?.teamId as string) ?? fallbackParts.teamId;
        const channelId = (record?.channelId as string) ?? fallbackParts.channelId;
        const sourceMessage = {
          ...(record ?? {}),
          id:
            (record?.replyId as string) ??
            (record?.messageId as string) ??
            (record?.id as string) ??
            (event.objectType === 'reply' ? fallbackParts.replyId : fallbackParts.messageId),
          replyToId:
            event.objectType === 'reply'
              ? ((record?.messageId as string) ?? (record?.replyToId as string) ?? fallbackParts.messageId)
              : (record?.replyToId as string | undefined),
        } as TeamsChatMessage;
        const primary = materializeMessage(teamId, channelId, sourceMessage);
        return [
          primary,
          ...materializeMessageReactions(
            teamId,
            channelId,
            event.objectType === 'reply'
              ? ((record?.replyId as string) ?? fallbackParts.replyId ?? sourceMessage.id)
              : ((record?.messageId as string) ?? fallbackParts.messageId ?? sourceMessage.id),
            sourceMessage.reactions,
          ),
        ];
      }
      case 'reaction':
        return [
          {
            objectType: 'reaction',
            objectId: event.objectId,
            path: this.computePath('reaction', event.objectId),
            payload,
          },
        ];
      default:
        return [];
    }
  }

  private async getBaseRevision(workspaceId: string, path: string): Promise<string> {
    try {
      const existing = await this.client.readFile(workspaceId, path);
      return existing.revision;
    } catch {
      return '0';
    }
  }
}
