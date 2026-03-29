import {
  GRAPH_API_BASE_URL,
  type CreateSubscriptionInput,
  type GraphSubscription,
  type SubscriptionPresetScope,
  type TeamsAdapterConfig,
} from '../types.js';

function getFetch(config: TeamsAdapterConfig): typeof fetch {
  return config.fetchImpl ?? fetch;
}

async function getAccessToken(config: TeamsAdapterConfig): Promise<string> {
  return typeof config.accessToken === 'function' ? config.accessToken() : config.accessToken;
}

async function graphJson<T>(
  config: TeamsAdapterConfig,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  const token = await getAccessToken(config);
  const response = await getFetch(config)(`${config.apiBaseUrl ?? GRAPH_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
    throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
  }

  if (method === 'DELETE' || response.status === 204) {
    return undefined;
  }

  return (await response.json()) as T;
}

export function computeExpirationDateTime(minutesUntilExpiration: number = 55): string {
  const safeMinutes = Math.max(1, Math.min(minutesUntilExpiration, 59));
  return new Date(Date.now() + safeMinutes * 60_000).toISOString();
}

export function shouldRenewSubscription(
  expirationDateTime: string,
  renewBeforeExpiryMs: number = 5 * 60_000,
  now: number = Date.now(),
): boolean {
  return Date.parse(expirationDateTime) - now <= Math.max(0, renewBeforeExpiryMs);
}

export function buildSubscriptionRequest(
  config: TeamsAdapterConfig,
  input: CreateSubscriptionInput,
): CreateSubscriptionInput {
  const includeResourceData = input.includeResourceData ?? config.includeResourceData ?? false;

  return {
    ...input,
    clientState: input.clientState ?? config.clientState,
    includeResourceData,
    encryptionCertificate:
      input.encryptionCertificate ?? (includeResourceData ? config.encryptionCertificate : undefined),
    encryptionCertificateId:
      input.encryptionCertificateId ?? (includeResourceData ? config.encryptionCertificateId : undefined),
    lifecycleNotificationUrl: input.lifecycleNotificationUrl ?? config.lifecycleNotificationUrl,
  };
}

export async function createSubscription(
  config: TeamsAdapterConfig,
  input: CreateSubscriptionInput,
): Promise<GraphSubscription> {
  return (await graphJson<GraphSubscription>(
    config,
    'POST',
    '/subscriptions',
    buildSubscriptionRequest(config, input),
  )) as GraphSubscription;
}

export async function renewSubscription(
  config: TeamsAdapterConfig,
  subscriptionId: string,
  expirationDateTime: string = computeExpirationDateTime(),
): Promise<GraphSubscription> {
  return (await graphJson<GraphSubscription>(
    config,
    'PATCH',
    `/subscriptions/${subscriptionId}`,
    { expirationDateTime },
  )) as GraphSubscription;
}

export async function deleteSubscription(
  config: TeamsAdapterConfig,
  subscriptionId: string,
): Promise<void> {
  await graphJson(config, 'DELETE', `/subscriptions/${subscriptionId}`);
}

export function defaultSubscriptionResources(
  scope: SubscriptionPresetScope,
  identifiers: {
    teamId?: string;
    channelId?: string;
    chatId?: string;
    notificationUrl: string;
    clientState?: string;
    includeResourceData?: boolean;
    minutesUntilExpiration?: number;
  },
): CreateSubscriptionInput[] {
  const expirationDateTime = computeExpirationDateTime(identifiers.minutesUntilExpiration);
  const base = {
    notificationUrl: identifiers.notificationUrl,
    clientState: identifiers.clientState,
    includeResourceData: identifiers.includeResourceData,
    expirationDateTime,
  };

  switch (scope) {
    case 'tenant':
      return [
        { ...base, resource: '/teams/getAllMessages', changeType: 'created,updated,deleted' },
        { ...base, resource: '/chats/getAllMessages', changeType: 'created,updated,deleted' },
        { ...base, resource: '/teams/getAllChannels', changeType: 'created,updated,deleted' },
        { ...base, resource: '/teams', changeType: 'updated,deleted' },
      ];
    case 'team':
      if (!identifiers.teamId) {
        throw new Error('teamId is required for team subscription defaults');
      }
      return [
        { ...base, resource: `/teams/${identifiers.teamId}/channels`, changeType: 'created,updated,deleted' },
        { ...base, resource: `/teams/${identifiers.teamId}`, changeType: 'updated,deleted' },
        { ...base, resource: `/teams/${identifiers.teamId}/members`, changeType: 'created,updated,deleted' },
      ];
    case 'channel':
      if (!identifiers.teamId || !identifiers.channelId) {
        throw new Error('teamId and channelId are required for channel subscription defaults');
      }
      return [
        {
          ...base,
          resource: `/teams/${identifiers.teamId}/channels/${identifiers.channelId}/messages`,
          changeType: 'created,updated,deleted',
        },
      ];
    case 'chat':
      if (!identifiers.chatId) {
        throw new Error('chatId is required for chat subscription defaults');
      }
      return [
        {
          ...base,
          resource: `/chats/${identifiers.chatId}/messages`,
          changeType: 'created,updated,deleted',
        },
      ];
    default:
      throw new Error(`Unsupported Teams subscription scope: ${scope satisfies never}`);
  }
}
