export {
  IntegrationAdapter,
  SendGridAdapter,
  type DeleteFileInput,
  type FileSemantics,
  type IngestError,
  type IngestResult,
  type NormalizedWebhook,
  type RelayFileClientLike,
  type WriteFileInput,
  type WriteFileResult,
} from './sendgrid-adapter.js';
export {
  SENDGRID_OBJECT_TYPES,
  SENDGRID_PATH_ROOT,
  computeSendGridPath,
  encodeSendGridPathSegment,
  normalizeSendGridObjectType,
  sendGridContactPath,
  sendGridEventPath,
  sendGridMailPath,
  tryNormalizeSendGridObjectType,
} from './path-mapper.js';
export {
  SENDGRID_CONTACTS_ENDPOINT,
  SENDGRID_MAIL_SEND_ENDPOINT,
  resolveSendGridReadRequest,
  type SendGridReadRequest,
} from './queries.js';
export {
  resolveSendGridWritebackRequest,
  type SendGridWritebackRequest,
} from './writeback.js';
export {
  SENDGRID_PROVIDER,
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
  assertValidSendGridWebhookSignature,
  assertValidSendGridWebhookTimestamp,
  computeSendGridWebhookBodyHmac,
  normalizeSendGridWebhook,
  normalizeSendGridWebhookEvents,
  validateSendGridWebhookSignature,
  validateSendGridWebhookTimestamp,
  type SendGridWebhookConnectionMetadata,
  type SendGridWebhookHeaders,
  type SendGridWebhookSignatureValidationResult,
  type SendGridWebhookTimestampValidationResult,
} from './webhook-normalizer.js';
export type {
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  SendGridAdapterConfig,
  SendGridContact,
  SendGridEvent,
  SendGridMail,
  SendGridMailAddress,
  SendGridMailPersonalization,
  SendGridWebhookPayload,
  SendGridWebhookPayloadRecord,
} from './types.js';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';
export * from './digest.js';
export * from './summary.js';
