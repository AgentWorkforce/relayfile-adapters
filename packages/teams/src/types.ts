export const GRAPH_API_BASE_URL = 'https://graph.microsoft.com/v1.0';

export type AccessTokenProvider = string | (() => Promise<string> | string);

export interface TeamsAdapterConfig {
  accessToken: AccessTokenProvider;
  apiBaseUrl?: string;
  filesRoot?: string;
  connectionId?: string;
  clientState?: string;
  notificationUrl?: string;
  lifecycleNotificationUrl?: string;
  encryptionCertificate?: string;
  encryptionCertificateId?: string;
  privateKeyPem?: string;
  includeResourceData?: boolean;
  includeBotMessages?: boolean;
  fetchImpl?: typeof fetch;
}

export type TeamsObjectType =
  | 'team'
  | 'channel'
  | 'message'
  | 'reply'
  | 'tab'
  | 'member'
  | 'chat'
  | 'chat_message'
  | 'reaction';

export type TeamsEventType =
  | 'team.updated'
  | 'team.deleted'
  | 'channel.created'
  | 'channel.updated'
  | 'channel.deleted'
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'reply.created'
  | 'reply.updated'
  | 'reply.deleted'
  | 'member.created'
  | 'member.updated'
  | 'member.deleted'
  | 'chat.created'
  | 'chat.updated'
  | 'chat.deleted'
  | 'chat_message.created'
  | 'chat_message.updated'
  | 'chat_message.deleted'
  | 'reaction.added'
  | 'reaction.removed';

export type GraphChangeType = 'created' | 'updated' | 'deleted';

export interface ChangeNotificationPayload {
  value: ChangeNotification[];
  validationTokens?: string[];
}

export interface ChangeNotification {
  subscriptionId: string;
  changeType: GraphChangeType;
  resource: string;
  clientState?: string;
  tenantId?: string;
  subscriptionExpirationDateTime?: string;
  resourceData?: GraphResourceData;
  encryptedContent?: EncryptedContent;
}

export interface GraphResourceData {
  '@odata.type'?: string;
  '@odata.id'?: string;
  id?: string;
  [key: string]: unknown;
}

export interface EncryptedContent {
  data: string;
  dataSignature: string;
  dataKey: string;
  encryptionCertificateId: string;
  encryptionCertificateThumbprint?: string;
}

export interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
  includeResourceData?: boolean;
  encryptionCertificate?: string;
  encryptionCertificateId?: string;
  lifecycleNotificationUrl?: string;
  latestSupportedTlsVersion?: string;
}

export interface CreateSubscriptionInput {
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
  includeResourceData?: boolean;
  encryptionCertificate?: string;
  encryptionCertificateId?: string;
  lifecycleNotificationUrl?: string;
}

export interface GraphCollectionResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface TeamsIdentity {
  id?: string;
  displayName?: string;
  userIdentityType?: string;
}

export interface TeamsIdentitySet {
  user?: TeamsIdentity;
  application?: TeamsIdentity;
  device?: TeamsIdentity;
}

export interface TeamsMessageBody {
  contentType?: 'html' | 'text';
  content?: string;
}

export interface TeamsAttachment {
  id?: string;
  contentType?: string;
  contentUrl?: string;
  name?: string;
  content?: string;
  thumbnailUrl?: string;
}

export interface TeamsMention {
  id: number;
  mentionText?: string;
  mentioned?: TeamsIdentitySet;
}

export interface TeamsReaction {
  reactionType: string;
  createdDateTime?: string;
  user?: TeamsIdentitySet;
}

export interface TeamsChannelIdentity {
  teamId?: string;
  channelId?: string;
}

export interface TeamsChatMessage {
  id: string;
  replyToId?: string;
  chatId?: string;
  messageType?: 'message' | 'systemEventMessage' | 'unknownFutureValue';
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  deletedDateTime?: string | null;
  from?: TeamsIdentitySet;
  body?: TeamsMessageBody;
  summary?: string;
  subject?: string;
  importance?: 'normal' | 'high' | 'urgent';
  webUrl?: string;
  locale?: string;
  attachments?: TeamsAttachment[];
  mentions?: TeamsMention[];
  reactions?: TeamsReaction[];
  channelIdentity?: TeamsChannelIdentity;
  etag?: string;
  [key: string]: unknown;
}

export interface TeamsChannel {
  id: string;
  displayName?: string;
  description?: string;
  membershipType?: 'standard' | 'private' | 'shared';
  createdDateTime?: string;
  webUrl?: string;
  isArchived?: boolean;
  [key: string]: unknown;
}

export interface TeamsTeam {
  id: string;
  displayName?: string;
  description?: string;
  createdDateTime?: string;
  visibility?: 'public' | 'private' | 'hiddenMembership';
  webUrl?: string;
  [key: string]: unknown;
}

export interface TeamsMember {
  id: string;
  userId?: string;
  displayName?: string;
  email?: string;
  roles?: string[];
  visibleHistoryStartDateTime?: string;
  [key: string]: unknown;
}

export interface TeamsChat {
  id: string;
  chatType?: 'oneOnOne' | 'group' | 'meeting';
  topic?: string;
  createdDateTime?: string;
  webUrl?: string;
  members?: TeamsMember[];
  [key: string]: unknown;
}

export interface TeamsTab {
  id: string;
  displayName?: string;
  webUrl?: string;
  configuration?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NormalizedTeamsWebhook {
  provider: 'teams';
  connectionId: string;
  eventType: TeamsEventType | string;
  objectType: TeamsObjectType;
  objectId: string;
  payload: Record<string, unknown>;
}

export interface TeamsMaterializedRecord<TPayload = unknown> {
  objectType: TeamsObjectType;
  objectId: string;
  path: string;
  payload: TPayload;
}

export interface BulkIngestOptions {
  includeMembers?: boolean;
  includeMessages?: boolean;
  includeReplies?: boolean;
  includeTabs?: boolean;
  channelIds?: string[];
  messageMode?: 'list' | 'delta';
  deltaLinks?: Record<string, string>;
  signal?: AbortSignal;
}

export interface BulkIngestResult {
  files: TeamsMaterializedRecord[];
  deltaLinks: Record<string, string>;
}

export interface GraphJsonRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  pathOrUrl: string;
  body?: unknown;
  signal?: AbortSignal;
}

export interface WritebackTarget {
  objectType: 'message' | 'reply' | 'chat_message';
  objectId: string;
  method: 'POST';
  url: string;
  body: {
    body: {
      contentType: 'html';
      content: string;
    };
  };
}

export type SubscriptionPresetScope = 'tenant' | 'team' | 'channel' | 'chat';
