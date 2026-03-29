import {
  GRAPH_API_BASE_URL,
  type ChangeNotification,
  type ChangeNotificationPayload,
  type GraphChangeType,
  type NormalizedTeamsWebhook,
  type TeamsAdapterConfig,
  type TeamsChatMessage,
  type TeamsEventType,
  type TeamsObjectType,
} from '../types.js';
import {
  makeObjectId,
  normalizeGraphResource,
  parseResourceUrl,
} from '../path-mapper.js';
import { decryptNotificationContent } from './decryptor.js';
import { validateClientState } from './validator.js';

export interface NotificationHandlerOptions {
  config: TeamsAdapterConfig;
  signal?: AbortSignal;
}

function getFetch(config: TeamsAdapterConfig): typeof fetch {
  return config.fetchImpl ?? fetch;
}

async function getAccessToken(config: TeamsAdapterConfig): Promise<string> {
  return typeof config.accessToken === 'function' ? config.accessToken() : config.accessToken;
}

async function graphFetchResource(
  config: TeamsAdapterConfig,
  resource: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const token = await getAccessToken(config);
  const normalizedResource = normalizeGraphResource(resource);
  const response = await getFetch(config)(`${config.apiBaseUrl ?? GRAPH_API_BASE_URL}${normalizedResource}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal,
  });

  if (response.status === 404 || response.status === 410) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch Graph resource ${normalizedResource}: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function hasHydratedResourceData(resourceData: Record<string, unknown>): boolean {
  const keys = Object.keys(resourceData);
  if (keys.length === 0) {
    return false;
  }

  return keys.some((key) => !['id', '@odata.id', '@odata.type'].includes(key));
}

function inferObjectFromPayload(
  resource: string,
  payload: Record<string, unknown>,
): { objectType: TeamsObjectType; parts: Record<string, string> } | null {
  const parsed = parseResourceUrl(resource);
  if (parsed) {
    if (parsed.objectType === 'message') {
      const replyToId = asString(payload.replyToId);
      if (replyToId) {
        return {
          objectType: 'reply',
          parts: {
            teamId: parsed.parts.teamId,
            channelId: parsed.parts.channelId,
            messageId: replyToId,
            replyId: parsed.parts.messageId,
          },
        };
      }
    }

    if (parsed.objectType === 'member') {
      const userId = asString(payload.userId) ?? asString(asRecord(payload.user)?.id) ?? parsed.parts.userId;
      return {
        objectType: 'member',
        parts: {
          teamId: parsed.parts.teamId,
          userId,
        },
      };
    }

    return parsed;
  }

  const channelIdentity = asRecord(payload.channelIdentity);
  const teamId = asString(channelIdentity?.teamId) ?? asString(payload.teamId);
  const channelId = asString(channelIdentity?.channelId) ?? asString(payload.channelId);
  const chatId = asString(payload.chatId);
  const itemId = asString(payload.id);

  if (teamId && channelId && itemId) {
    const replyToId = asString(payload.replyToId);
    if (replyToId) {
      return {
        objectType: 'reply',
        parts: { teamId, channelId, messageId: replyToId, replyId: itemId },
      };
    }

    return {
      objectType: 'message',
      parts: { teamId, channelId, messageId: itemId },
    };
  }

  if (chatId && itemId) {
    return {
      objectType: 'chat_message',
      parts: { chatId, messageId: itemId },
    };
  }

  return null;
}

async function resolveNotificationPayload(
  notification: ChangeNotification,
  options: NotificationHandlerOptions,
): Promise<Record<string, unknown>> {
  if (notification.encryptedContent && options.config.privateKeyPem) {
    return decryptNotificationContent(notification.encryptedContent, options.config.privateKeyPem);
  }

  if (notification.resourceData && hasHydratedResourceData(notification.resourceData)) {
    return notification.resourceData;
  }

  if (notification.changeType === 'deleted') {
    return {};
  }

  return (await graphFetchResource(options.config, notification.resource, options.signal)) ?? {};
}

function resolveEventType(objectType: TeamsObjectType, changeType: GraphChangeType): TeamsEventType {
  const base = objectType === 'reply' ? 'reply' : objectType;
  if (base === 'message' || base === 'chat_message' || base === 'channel' || base === 'team' || base === 'chat') {
    return `${base}.${changeType}` as TeamsEventType;
  }

  if (base === 'member') {
    return `member.${changeType}` as TeamsEventType;
  }

  return `${base}.updated` as TeamsEventType;
}

function shouldSkipBotMessage(config: TeamsAdapterConfig, payload: Record<string, unknown>): boolean {
  if (config.includeBotMessages) {
    return false;
  }

  const message = payload as TeamsChatMessage;
  return Boolean(message.from?.application?.id);
}

export async function processNotifications(
  payload: ChangeNotificationPayload,
  options: NotificationHandlerOptions,
): Promise<NormalizedTeamsWebhook[]> {
  const events: NormalizedTeamsWebhook[] = [];

  for (const notification of payload.value) {
    if (!validateClientState(notification, options.config.clientState)) {
      continue;
    }

    const hydratedPayload = await resolveNotificationPayload(notification, options);
    if (shouldSkipBotMessage(options.config, hydratedPayload)) {
      continue;
    }

    const resolved = inferObjectFromPayload(notification.resource, hydratedPayload);
    if (!resolved) {
      continue;
    }

    const objectId = makeObjectId(resolved.objectType, resolved.parts);
    events.push({
      provider: 'teams',
      connectionId: options.config.connectionId ?? '',
      eventType: resolveEventType(resolved.objectType, notification.changeType),
      objectType: resolved.objectType,
      objectId,
      payload: {
        ...hydratedPayload,
        ...resolved.parts,
        resource: normalizeGraphResource(notification.resource),
        subscriptionId: notification.subscriptionId,
        changeType: notification.changeType,
        tenantId: notification.tenantId,
        subscriptionExpirationDateTime: notification.subscriptionExpirationDateTime,
      },
    });
  }

  return events;
}
