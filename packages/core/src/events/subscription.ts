import { EVENT_SUBSCRIPTION_SCHEMA, type EventSubscription, type EventSubscriptionInput } from "./types.js";
import type { KnownProviderName } from "../triggers/catalog.generated.js";
import * as validate from "./validation.js";

/** Snapshot a source declaration. The runtime resolves the connection before activation. */
export function defineEventSubscription<P extends KnownProviderName>(input: EventSubscriptionInput<P>): EventSubscription<P> {
  const value = validate.record(input, "subscription");
  validate.knownKeys(value, ["provider", "eventTypes", "connectionId", "pathPrefixes"], "subscription");
  return parseEventSubscription({ ...value, schema: EVENT_SUBSCRIPTION_SCHEMA }) as EventSubscription<P>;
}

/** Parse untrusted serialized declarations; reject unsupported selectors rather than ignore them. */
export function parseEventSubscription(input: unknown): EventSubscription {
  const value = validate.record(input, "subscription");
  validate.knownKeys(value, ["schema", "provider", "eventTypes", "connectionId", "pathPrefixes"], "subscription");
  if (value.schema !== EVENT_SUBSCRIPTION_SCHEMA) throw new TypeError("Unsupported event subscription schema");
  const provider = validate.provider(value.provider);
  return Object.freeze({
    schema: EVENT_SUBSCRIPTION_SCHEMA,
    provider,
    eventTypes: validate.list(value.eventTypes, "eventTypes", type => validate.eventType(type, provider)) as EventSubscription["eventTypes"],
    connectionId: validate.text(value.connectionId, "connectionId"),
    ...(value.pathPrefixes === undefined ? {} : {
      pathPrefixes: validate.list(value.pathPrefixes, "pathPrefixes", validate.path),
    }),
  });
}
