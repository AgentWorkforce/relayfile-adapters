import { INBOUND_CAPABILITY_CATALOG } from "./catalog.generated.js";
import {
  LOGICAL_EVENT_KEY_VERSION,
  type InboundCapabilityDeclaration,
  type InboundLogicalEventInput,
  type InboundLogicalKeyStrategy,
  type LogicalEventKeyEvidence,
  type LogicalEventKeyResult,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

export class IncompleteNangoSyncPageIdentityError extends Error {
  readonly code = "incomplete_nango_sync_page_identity";

  constructor(readonly missingFields: readonly string[]) {
    super(
      `Incomplete Nango sync page identity: missing ${missingFields.join(", ")}`,
    );
    this.name = "IncompleteNangoSyncPageIdentityError";
  }
}

export function resolveInboundCapability(
  input: InboundLogicalEventInput,
): InboundCapabilityDeclaration | undefined {
  const headers = normalizeHeaders(input.headers);
  const providerConfigKey = readProviderConfigKey(input.payload);
  const candidates = INBOUND_CAPABILITY_CATALOG.filter(
    (capability) => capability.source === input.source,
  );

  if (input.source === "nango") {
    if (!providerConfigKey) return undefined;
    const normalized = normalizeToken(providerConfigKey);
    return candidates.find((capability) =>
      capability.providerConfigAliases.some(
        (alias) => normalizeToken(alias) === normalized,
      ),
    );
  }

  return candidates.find((capability) =>
    (capability.detection?.headerAny ?? []).some(
      (header) => headers[normalizeHeaderName(header)] !== undefined,
    ),
  );
}

export async function logicalEventKey(
  input: InboundLogicalEventInput,
  capability = resolveInboundCapability(input),
): Promise<LogicalEventKeyResult> {
  const rawBodySha256 = await sha256Hex(rawBytes(input.rawBody));
  const headers = normalizeHeaders(input.headers);
  const eventKind = readEventKind(input.payload, input.source);
  const capabilityId = capability?.id ?? `unknown.${input.source}`;
  const providerId = capability?.providerId ?? "unknown";
  const evidenceBase = { rawBodySha256 };

  if (!capability || !eventKind || !capability.eventKinds.includes(eventKind)) {
    return buildResult(
      "raw-body",
      capabilityId,
      providerId,
      [input.source, capabilityId, eventKind ?? "", rawBodySha256],
      evidenceBase,
    );
  }

  for (const strategy of capability.logicalKey.strategies) {
    if (strategy === "provider-delivery-id") {
      const deliveryId = readFirstHeader(
        headers,
        capability.logicalKey.providerDeliveryIdHeaders,
      );
      if (deliveryId) {
        return buildResult(
          strategy,
          capabilityId,
          providerId,
          [
            input.source,
            capabilityId,
            providerId,
            readProviderConfigKey(input.payload) ?? "",
            readConnectionId(input.payload) ?? "",
            readProviderScope(input.payload) ?? "",
            deliveryId,
          ],
          { ...evidenceBase, providerDeliveryId: deliveryId },
        );
      }
      continue;
    }

    if (strategy === "nango-sync-page") {
      if (input.source !== "nango" || eventKind !== "sync") continue;
      const identity = requireNangoSyncPageIdentity(input.payload);
      const sourceCursor = [identity.window, identity.cursor]
        .filter((value) => value.length > 0)
        .join("/");
      return buildResult(
        strategy,
        capabilityId,
        providerId,
        [
          identity.providerConfigKey,
          identity.connectionId,
          identity.syncName,
          identity.model,
          identity.window,
          identity.cursor,
        ],
        {
          ...evidenceBase,
          ...(sourceCursor ? { sourceCursor } : {}),
        },
      );
    }

    if (strategy === "hookdeck-delivery-id") {
      if (input.source !== "hookdeck") continue;
      const deliveryId = readFirstHeader(
        headers,
        capability.logicalKey.hookdeckDeliveryIdHeaders,
      );
      if (!deliveryId) continue;
      return buildResult(
        strategy,
        capabilityId,
        providerId,
        [
          capabilityId,
          readProviderScope(input.payload) ?? "",
          deliveryId,
        ],
        { ...evidenceBase, providerDeliveryId: deliveryId },
      );
    }

    if (strategy === "semantic-payload") {
      const semanticPayload = canonicalJson(input.payload);
      const semanticHash = await sha256Hex(
        new TextEncoder().encode(semanticPayload),
      );
      return buildResult(
        strategy,
        capabilityId,
        providerId,
        [
          input.source,
          capabilityId,
          readProviderConfigKey(input.payload) ?? "",
          readConnectionId(input.payload) ?? "",
          eventKind,
          semanticHash,
        ],
        evidenceBase,
      );
    }
  }

  // Adapter-declared known events should always reach semantic-payload. Keep a
  // fail-closed exact-byte fallback so a malformed future declaration cannot
  // silently conflate two events.
  return buildResult(
    "raw-body",
    capabilityId,
    providerId,
    [input.source, capabilityId, eventKind, rawBodySha256],
    evidenceBase,
  );
}

async function buildResult(
  strategy: InboundLogicalKeyStrategy,
  capabilityId: string,
  providerId: string,
  parts: readonly string[],
  evidence: LogicalEventKeyEvidence,
): Promise<LogicalEventKeyResult> {
  const material = [
    LOGICAL_EVENT_KEY_VERSION,
    strategy,
    ...parts.map(lengthPrefix),
  ].join("\n");
  const digest = await sha256Hex(new TextEncoder().encode(material));
  return {
    version: LOGICAL_EVENT_KEY_VERSION,
    key: `v1:${strategy}:sha256:${digest}`,
    strategy,
    capabilityId,
    providerId,
    evidence,
  };
}

function requireNangoSyncPageIdentity(payload: unknown): {
  providerConfigKey: string;
  connectionId: string;
  syncName: string;
  model: string;
  window: string;
  cursor: string;
} {
  const root = asRecord(payload);
  const nested = asRecord(root?.payload);
  const providerConfigKey = firstString(
    nested?.providerConfigKey,
    nested?.provider_config_key,
    root?.providerConfigKey,
    root?.provider_config_key,
    root?.from,
  );
  const connectionId = firstString(
    nested?.connectionId,
    nested?.connection_id,
    root?.connectionId,
    root?.connection_id,
  );
  const syncName = firstString(
    nested?.syncName,
    nested?.sync_name,
    root?.syncName,
    root?.sync_name,
  );
  const model = firstString(nested?.model, root?.model);
  const window =
    firstString(
      nested?.queryTimeStamp,
      nested?.queryTimestamp,
      nested?.windowKey,
      nested?.window,
      root?.queryTimeStamp,
      root?.queryTimestamp,
      root?.windowKey,
      root?.window,
    ) ?? "";
  const cursor =
    firstString(
      nested?.cursor,
      nested?.cursorKey,
      root?.cursor,
      root?.cursorKey,
    ) ?? "";
  const missingFields = [
    ...(!providerConfigKey ? ["providerConfigKey"] : []),
    ...(!connectionId ? ["connectionId"] : []),
    ...(!syncName ? ["syncName"] : []),
    ...(!model ? ["model"] : []),
    ...(!window && !cursor ? ["windowOrCursor"] : []),
  ];
  if (
    !providerConfigKey ||
    !connectionId ||
    !syncName ||
    !model ||
    (!window && !cursor)
  ) {
    throw new IncompleteNangoSyncPageIdentityError(missingFields);
  }

  return {
    providerConfigKey,
    connectionId,
    syncName,
    model,
    window,
    cursor,
  };
}

function readProviderConfigKey(payload: unknown): string | undefined {
  const root = asRecord(payload);
  const nested = asRecord(root?.payload);
  return firstString(
    nested?.providerConfigKey,
    nested?.provider_config_key,
    root?.providerConfigKey,
    root?.provider_config_key,
    root?.from,
    nested?.from,
  );
}

function readConnectionId(payload: unknown): string | undefined {
  const root = asRecord(payload);
  const nested = asRecord(root?.payload);
  return firstString(
    nested?.connectionId,
    nested?.connection_id,
    root?.connectionId,
    root?.connection_id,
  );
}

function readProviderScope(payload: unknown): string | undefined {
  const root = asRecord(payload);
  const nested = asRecord(root?.payload);
  const project = asRecord(root?.project) ?? asRecord(nested?.project);
  return firstString(
    project?.id,
    project?.path_with_namespace,
    nested?.accountId,
    nested?.account,
    root?.accountId,
    root?.account,
  );
}

function readEventKind(
  payload: unknown,
  source: InboundLogicalEventInput["source"],
): string | undefined {
  if (source === "hookdeck") return "webhook";
  const root = asRecord(payload);
  return firstString(root?.type, root?.eventType, root?.event_type);
}

function normalizeHeaders(
  input: InboundLogicalEventInput["headers"],
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!input) return headers;
  if (typeof Headers !== "undefined" && input instanceof Headers) {
    input.forEach((value, name) => {
      headers[normalizeHeaderName(name)] = value.trim();
    });
    return headers;
  }
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) {
      headers[normalizeHeaderName(name)] = value.trim();
    }
  }
  return headers;
}

function readFirstHeader(
  headers: Readonly<Record<string, string>>,
  names: readonly string[] | undefined,
): string | undefined {
  for (const name of names ?? []) {
    const value = headers[normalizeHeaderName(name)];
    if (value) return value;
  }
  return undefined;
}

function normalizeHeaderName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function lengthPrefix(value: string): string {
  return `${value.length}:${value}`;
}

function rawBytes(value: InboundLogicalEventInput["rawBody"]): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    value as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function normalizeJson(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol"
        ? null
        : normalizeJson(item),
    );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => {
          const item = value[key];
          return (
            item !== undefined &&
            typeof item !== "function" &&
            typeof item !== "symbol"
          );
        })
        .map((key) => [key, normalizeJson(value[key])]),
    );
  }
  throw new TypeError(`Value is not JSON-serializable: ${typeof value}`);
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (
      (typeof value === "string" || typeof value === "number") &&
      String(value).trim()
    ) {
      return String(value).trim();
    }
  }
  return undefined;
}
