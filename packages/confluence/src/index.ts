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
  computeConfluencePath,
  confluencePagePath,
  confluenceSpacePath,
  encodeConfluencePathSegment,
  extractConfluenceIdFromPathSegment,
  normalizeConfluenceObjectType,
} from './path-mapper.js';
export {
  CONFLUENCE_API_PAGES_ROUTE,
} from './types.js';
export {
  CONFLUENCE_API_SPACES_ROUTE,
  resolveConfluenceReadRequest,
} from './queries.js';
export {
  resolveConfluenceDeleteRequest,
  resolveConfluenceWritebackRequest,
} from './writeback.js';
export type * from './types.js';
export * from './resources.js';
