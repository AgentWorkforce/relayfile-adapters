export { TeamsAdapter } from './adapter.js';
export {
  computePath,
  makeObjectId,
  normalizeGraphResource,
  normalizeSegment,
  parseObjectId,
  parseResourceUrl,
  parseTeamsPath,
} from './path-mapper.js';
export { bulkIngestChat, bulkIngestTeam } from './bulk-ingest.js';
export {
  createSubscription,
  renewSubscription,
  deleteSubscription,
  computeExpirationDateTime,
  buildSubscriptionRequest,
  defaultSubscriptionResources,
  shouldRenewSubscription,
} from './notification/subscription.js';
export {
  createValidationResponse,
  extractValidationToken,
  validateClientState,
} from './notification/validator.js';
export { decryptNotificationContent } from './notification/decryptor.js';
export { processNotifications } from './notification/handler.js';
export { resolveWriteback, resolveWritebackForObject } from './writeback.js';
export { materializeChannel, materializeTab, materializeTeam } from './channels/ingestion.js';
export {
  extractMessageRelations,
  extractMessageText,
  materializeMessage,
  materializeMessageReactions,
  materializeReply,
} from './channels/messages.js';
export { materializeReaction } from './channels/reactions.js';
export { materializeChat, materializeChatMessage } from './chats/ingestion.js';
export { materializeMember } from './members/ingestion.js';

export type {
  AccessTokenProvider,
  BulkIngestOptions,
  BulkIngestResult,
  ChangeNotification,
  ChangeNotificationPayload,
  CreateSubscriptionInput,
  EncryptedContent,
  GraphCollectionResponse,
  GraphJsonRequestOptions,
  GraphResourceData,
  GraphSubscription,
  NormalizedTeamsWebhook,
  SubscriptionPresetScope,
  TeamsAdapterConfig,
  TeamsAttachment,
  TeamsChannel,
  TeamsChannelIdentity,
  TeamsChat,
  TeamsChatMessage,
  TeamsEventType,
  TeamsIdentity,
  TeamsIdentitySet,
  TeamsMaterializedRecord,
  TeamsMember,
  TeamsMention,
  TeamsMessageBody,
  TeamsObjectType,
  TeamsReaction,
  TeamsTab,
  TeamsTeam,
  WritebackTarget,
} from './types.js';
export type { ValidationResult } from './notification/validator.js';
