import { ADAPTER_EVENT_SCHEMA, type AdapterEvent, type AdapterEventInput } from "./types.js";
import type { KnownProviderName } from "../triggers/catalog.generated.js";
import * as validate from "./validation.js";

/** Preserve an upstream identity; this function performs no matching, auth, or deduplication. */
export function createAdapterEvent<P extends KnownProviderName>(input: AdapterEventInput<P>): AdapterEvent<P> {
  const value = validate.record(input, "event");
  validate.knownKeys(value, ["id", "provider", "eventType", "workspaceId", "connectionId", "deliveryId", "occurredAt", "paths", "payload"], "event");
  return parseAdapterEvent({ ...value, schema: ADAPTER_EVENT_SCHEMA }) as AdapterEvent<P>;
}

export function parseAdapterEvent(input: unknown): AdapterEvent {
  const value = validate.record(input, "event");
  validate.knownKeys(value, ["schema", "id", "provider", "eventType", "workspaceId", "connectionId", "deliveryId", "occurredAt", "paths", "payload"], "event");
  if (value.schema !== ADAPTER_EVENT_SCHEMA) throw new TypeError("Unsupported adapter event schema");
  const provider = validate.provider(value.provider);
  return Object.freeze({
    schema: ADAPTER_EVENT_SCHEMA,
    id: validate.text(value.id, "id"),
    provider,
    eventType: validate.eventType(value.eventType, provider) as AdapterEvent["eventType"],
    workspaceId: validate.text(value.workspaceId, "workspaceId"),
    connectionId: validate.text(value.connectionId, "connectionId"),
    ...(value.deliveryId === undefined ? {} : { deliveryId: validate.text(value.deliveryId, "deliveryId") }),
    occurredAt: validate.timestamp(value.occurredAt),
    paths: validate.list(value.paths, "paths", validate.path),
    payload: validate.json(value.payload),
  });
}
