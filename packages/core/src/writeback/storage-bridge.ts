export {
  buildStorageBridgeCreateResult,
  dispatchStorageBridgeWriteback,
  parseStorageBridgeWriteback,
} from "../storage-bridge/writeback.js";

export type {
  DispatchStorageBridgeWritebackOptions,
  ParsedStorageBridgeWriteback,
  StorageBridgeWritebackCreated,
  StorageBridgeWritebackHandlers,
  StorageBridgeWritebackMethod,
  StorageBridgeWritebackRequest,
} from "../storage-bridge/writeback.js";

export {
  assertReadOnlyFieldsRejected,
  collectReadOnlyFields,
  findResourceByPath,
  ReadOnlyFieldError,
} from "../storage-bridge/discovery.js";

export type {
  AdapterResourceConfig,
  AdapterResourceOperation,
  JsonSchemaObject,
} from "../storage-bridge/discovery.js";
