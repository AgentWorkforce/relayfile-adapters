export const INBOUND_CAPABILITY_SCHEMA = "relayfile.inbound-capability/1" as const;
export const INBOUND_CAPABILITY_CATALOG_SCHEMA =
  "relayfile.inbound-capability-catalog/1" as const;
export const LOGICAL_EVENT_KEY_VERSION = "relayfile.ingest.logical/1" as const;

export type InboundSource = "nango" | "hookdeck";
export type InboundLogicalKeyStrategy =
  | "provider-delivery-id"
  | "nango-sync-page"
  | "hookdeck-delivery-id"
  | "semantic-payload"
  | "raw-body";

export interface InboundCapabilityDetection {
  /**
   * A Hookdeck capability is selected when at least one normalized request
   * header in this list is present.
   */
  readonly headerAny?: readonly string[];
}

export interface InboundLogicalKeyPolicy {
  readonly version: "1";
  /**
   * Ordered strategies for adapter-declared event kinds. Exact raw bytes are
   * deliberately excluded: they are evidence, not universal business identity.
   */
  readonly strategies: readonly Exclude<
    InboundLogicalKeyStrategy,
    "raw-body"
  >[];
  readonly providerDeliveryIdHeaders?: readonly string[];
  readonly hookdeckDeliveryIdHeaders?: readonly string[];
  readonly unknownEventFallback: "raw-body";
  readonly semanticPayload: "canonical-json-v1";
}

export interface InboundCapabilityDeclaration {
  readonly schema: typeof INBOUND_CAPABILITY_SCHEMA;
  readonly id: string;
  readonly providerId: string;
  readonly pathRoot: `/${string}`;
  readonly providerConfigAliases: readonly string[];
  readonly source: InboundSource;
  readonly eventKinds: readonly string[];
  readonly detection?: InboundCapabilityDetection;
  readonly logicalKey: InboundLogicalKeyPolicy;
}

export interface InboundLogicalEventInput {
  readonly source: InboundSource;
  readonly headers?: Headers | Readonly<Record<string, string | undefined>>;
  readonly payload: unknown;
  /**
   * Exact provider request bytes. Strings are encoded as UTF-8 without JSON
   * parsing or reserialization.
   */
  readonly rawBody: string | Uint8Array | ArrayBuffer;
}

export interface LogicalEventKeyEvidence {
  readonly providerDeliveryId?: string;
  readonly sourceCursor?: string;
  readonly rawBodySha256: string;
}

export interface LogicalEventKeyResult {
  readonly version: typeof LOGICAL_EVENT_KEY_VERSION;
  readonly key: string;
  readonly strategy: InboundLogicalKeyStrategy;
  readonly capabilityId: string;
  readonly providerId: string;
  readonly evidence: LogicalEventKeyEvidence;
}

export function defineInboundCapabilities<
  const T extends readonly InboundCapabilityDeclaration[],
>(capabilities: T): T {
  return capabilities;
}

export interface DefineNangoInboundCapabilityInput {
  readonly id: string;
  readonly providerId: string;
  readonly pathRoot: `/${string}`;
  readonly providerConfigAliases: readonly string[];
  readonly eventKinds?: readonly string[];
}

export function defineNangoInboundCapability(
  input: DefineNangoInboundCapabilityInput,
): InboundCapabilityDeclaration {
  return {
    schema: INBOUND_CAPABILITY_SCHEMA,
    id: input.id,
    providerId: input.providerId,
    pathRoot: input.pathRoot,
    providerConfigAliases: input.providerConfigAliases,
    source: "nango",
    eventKinds: input.eventKinds ?? ["forward", "sync", "webhook"],
    logicalKey: {
      version: "1",
      strategies: [
        "provider-delivery-id",
        "nango-sync-page",
        "semantic-payload",
      ],
      providerDeliveryIdHeaders: [
        "x-nango-delivery-id",
        "x-nango-webhook-id",
        "x-nango-id",
        "webhook-id",
      ],
      unknownEventFallback: "raw-body",
      semanticPayload: "canonical-json-v1",
    },
  };
}

export interface DefineHookdeckInboundCapabilityInput {
  readonly id: string;
  readonly providerId: string;
  readonly pathRoot: `/${string}`;
  readonly providerConfigAliases: readonly string[];
  readonly detectionHeaders: readonly string[];
  readonly providerDeliveryIdHeaders?: readonly string[];
  readonly hookdeckDeliveryIdHeaders?: readonly string[];
  readonly eventKinds?: readonly string[];
}

export function defineHookdeckInboundCapability(
  input: DefineHookdeckInboundCapabilityInput,
): InboundCapabilityDeclaration {
  const providerDeliveryIdHeaders =
    input.providerDeliveryIdHeaders?.length
      ? input.providerDeliveryIdHeaders
      : undefined;
  return {
    schema: INBOUND_CAPABILITY_SCHEMA,
    id: input.id,
    providerId: input.providerId,
    pathRoot: input.pathRoot,
    providerConfigAliases: input.providerConfigAliases,
    source: "hookdeck",
    eventKinds: input.eventKinds ?? ["webhook"],
    detection: { headerAny: input.detectionHeaders },
    logicalKey: {
      version: "1",
      strategies: providerDeliveryIdHeaders
        ? [
            "provider-delivery-id",
            "hookdeck-delivery-id",
            "semantic-payload",
          ]
        : [
            "hookdeck-delivery-id",
            "semantic-payload",
          ],
      ...(providerDeliveryIdHeaders
        ? { providerDeliveryIdHeaders }
        : {}),
      hookdeckDeliveryIdHeaders:
        input.hookdeckDeliveryIdHeaders ?? ["x-hookdeck-eventid"],
      unknownEventFallback: "raw-body",
      semanticPayload: "canonical-json-v1",
    },
  };
}
