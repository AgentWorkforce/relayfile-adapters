import type { KnownProviderName, KnownTriggerName } from "../triggers/catalog.generated.js";

export const EVENT_SUBSCRIPTION_SCHEMA = "relayfile.event-subscription/1" as const;
export const ADAPTER_EVENT_SCHEMA = "relayfile.adapter-event/1" as const;

export type EventJson = null | boolean | number | string | readonly EventJson[]
  | { readonly [key: string]: EventJson };

/** A declaration, not proof of connection authorization or successful matching. */
export interface EventSubscription<P extends KnownProviderName = KnownProviderName> {
  readonly schema: typeof EVENT_SUBSCRIPTION_SCHEMA;
  readonly provider: P;
  /** Exact adapter event names, without adding a provider prefix or wildcards. */
  readonly eventTypes: readonly KnownTriggerName<P>[];
  /** A reference resolved and authorized by the host. Never a credential. */
  readonly connectionId: string;
  /** Optional concrete Relayfile subtrees. At least one affected path must match. */
  readonly pathPrefixes?: readonly string[];
}

export type EventSubscriptionInput<P extends KnownProviderName> =
  Omit<EventSubscription<P>, "schema">;

/** Validated input to a handler; the host must authorize and match it first. */
export interface AdapterEvent<P extends KnownProviderName = KnownProviderName> {
  readonly schema: typeof ADAPTER_EVENT_SCHEMA;
  /** Existing logical event identity, stable across retries. Never minted here. */
  readonly id: string;
  readonly provider: P;
  readonly eventType: KnownTriggerName<P>;
  readonly workspaceId: string;
  readonly connectionId: string;
  /** Transport delivery identity, if present; it does not replace logical id. */
  readonly deliveryId?: string;
  readonly occurredAt: string;
  /** Concrete affected paths supplied by adapter-owned path mapping. */
  readonly paths: readonly string[];
  /** Adapter payload preserved as JSON. Provider-specific schemas remain separate. */
  readonly payload: EventJson;
}

export type AdapterEventInput<P extends KnownProviderName> = Omit<AdapterEvent<P>, "schema">;
