export {
  ConfluenceAdapter,
} from './confluence-adapter.js';
export type {
  ConnectionProvider,
  IngestError,
  IngestResult,
  ProxyRequest,
  ProxyResponse,
} from './confluence-adapter.js';

export {
  CONFLUENCE_OBJECT_TYPES,
  CONFLUENCE_CANONICAL_PAGE_STATUSES,
  CONFLUENCE_PATH_ROOT,
  computeConfluencePath,
  confluenceByIdAliasPath,
  confluenceByTitleAliasPath,
  confluencePageByIdAliasPath,
  confluencePageByParentAliasPath,
  confluencePageBySpaceAliasPath,
  confluencePageByStatePath,
  confluencePageByTitleAliasPath,
  confluencePagePath,
  confluencePagesIndexPath,
  confluenceProviderRootIndexPath,
  confluenceSpaceByIdAliasPath,
  confluenceSpaceByKeyAliasPath,
  confluenceSpaceByTitleAliasPath,
  confluenceSpacePath,
  confluenceSpacesIndexPath,
  encodeConfluencePathSegment,
  extractConfluenceIdFromPathSegment,
  nameWithId,
  normalizeConfluenceObjectType,
  normalizeNangoConfluenceModel,
  parseNameWithId,
  slugifyStatusName,
  tryNormalizeConfluenceObjectType,
} from './path-mapper.js';
export type {
  ConfluencePathObjectType,
  NameWithIdOptions,
  ParseNameWithIdResult,
} from './path-mapper.js';

export {
  aliasCollisionSuffix,
  slugifyAlias,
} from './alias-slug.js';

export {
  confluenceLayoutPromptFile,
  CONFLUENCE_LAYOUT_PROMPT,
} from './layout-prompt.js';

export {
  emitConfluenceAuxiliaryFiles,
} from './emit-auxiliary-files.js';
export type {
  ConfluenceEmitAuxiliaryFilesInput,
  ConfluencePageEmitRecord,
  ConfluenceSpaceEmitRecord,
} from './emit-auxiliary-files.js';

export {
  buildConfluenceIndexFile,
} from './index-emitter.js';
export type {
  ConfluenceIndexBucket,
  ConfluenceIndexFile,
} from './index-emitter.js';

export {
  CONFLUENCE_API_SPACES_ROUTE,
  confluencePageIndexRow,
  confluenceSpaceIndexRow,
  getConfluencePageHumanReadable,
  getConfluenceSpaceHumanReadable,
  resolveConfluenceReadRequest,
} from './queries.js';
export type {
  ConfluenceBaseIndexRow,
  ConfluencePageIndexRow,
  ConfluenceSpaceIndexRow,
} from './queries.js';

export {
  CONFLUENCE_API_PAGES_ROUTE,
} from './types.js';
export type * from './types.js';

export {
  ReadOnlyFieldError,
  resolveConfluenceDeleteRequest,
  resolveConfluenceWritebackRequest,
} from './writeback.js';

export {
  assertValidConfluenceWebhookSignature,
  computeConfluenceWebhookSignature,
  CONFLUENCE_DELIVERY_HEADER,
  CONFLUENCE_EVENT_HEADER,
  CONFLUENCE_PROVIDER,
  CONFLUENCE_SIGNATURE_HEADER,
  extractConfluenceConnectionMetadata,
  extractConfluenceEventType,
  extractConfluenceObjectId,
  extractConfluenceObjectType,
  normalizeConfluenceWebhook,
  parseConfluenceWebhookPayload,
  validateConfluenceWebhookSignature,
  validateConfluenceWebhookTimestamp,
} from './webhook-normalizer.js';
export type {
  ConfluenceWebhookConnectionMetadata,
  ConfluenceWebhookHeaders,
  ConfluenceWebhookSignatureValidationResult,
  ConfluenceWebhookTimestampValidationResult,
} from './webhook-normalizer.js';

export * from './resources.js';
