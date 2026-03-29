import type { Context, Hono } from "hono";
import type { NormalizedWebhook, RelayFileClient } from "@relayfile/sdk";
import type {
  AdapterRegistryLike,
  PersistedWebhook,
  RegisteredWebhookAdapter,
  WebhookEvent,
  WebhookSecretMap,
} from "./types.js";
import { headersToRecord, verifyWebhookSignature } from "./verify.js";

interface InstallRoutesOptions {
  app: Hono;
  client: RelayFileClient;
  workspaceId: string;
  registry: AdapterRegistryLike;
  secrets: WebhookSecretMap;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNestedValue(payload: Record<string, unknown>, ...path: string[]): unknown {
  let current: unknown = payload;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record) {
      return undefined;
    }
    current = record[segment];
  }
  return current;
}

function readNestedString(payload: Record<string, unknown>, ...path: string[]): string | undefined {
  return readString(readNestedValue(payload, ...path));
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._+=@/-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function defaultConnectionId(headers: Headers, payload: Record<string, unknown>): string {
  return (
    headers.get("x-connection-id") ??
    headers.get("x-provider-connection-id") ??
    headers.get("x-relay-connection-id") ??
    headers.get("x-relayfile-connection-id") ??
    readString(payload.connectionId) ??
    readString(payload.connection_id) ??
    "default"
  );
}

function defaultPath(provider: string, objectType: string, objectId: string): string {
  return `/${sanitizePathSegment(provider)}/${sanitizePathSegment(objectType)}/${sanitizePathSegment(objectId)}.json`;
}

function inferGitHubObjectType(eventName: string, payload: Record<string, unknown>): string {
  if (eventName === "push" || Array.isArray(payload.commits)) {
    return "commit";
  }
  if (asRecord(payload.pull_request)) {
    return "pull_request";
  }
  if (asRecord(payload.review)) {
    return "review";
  }
  if (eventName === "pull_request_review_comment" || asRecord(payload.comment)) {
    return "review_comment";
  }
  if (asRecord(payload.issue)) {
    return "issue";
  }
  if (asRecord(payload.check_run)) {
    return "check_run";
  }
  return eventName || "event";
}

function inferGitHubObjectId(objectType: string, payload: Record<string, unknown>): string {
  const candidates = [
    readString(payload.id),
    readString(payload.number),
    readNestedString(payload, "pull_request", "number"),
    readNestedString(payload, "issue", "number"),
    readNestedString(payload, "review", "id"),
    readNestedString(payload, "comment", "id"),
    readNestedString(payload, "check_run", "id"),
    readNestedString(payload, "pull_request", "head", "sha"),
    readString(payload.after),
  ];

  const matched = candidates.find((value) => value !== undefined);
  return matched ?? `${objectType}-unknown`;
}

function normalizeGitHubWebhook(payload: Record<string, unknown>, headers: Headers): WebhookEvent {
  const eventName = headers.get("x-github-event") ?? readString(payload.type) ?? "unknown";
  const action = readString(payload.action);
  const objectType = inferGitHubObjectType(eventName, payload);
  const deliveryId = headers.get("x-github-delivery");

  return {
    provider: "github",
    connectionId: defaultConnectionId(headers, payload),
    eventType: action ? `${eventName}.${action}` : eventName,
    objectType,
    objectId: inferGitHubObjectId(objectType, payload),
    payload,
    ...(deliveryId ? { metadata: { delivery_id: deliveryId } } : {}),
  };
}

function inferSlackEventType(event: Record<string, unknown>): string {
  const type = readString(event.type) ?? "unknown";
  const subtype = readString(event.subtype);

  if (type !== "message") {
    return type.replace(/_/g, ".");
  }

  if (subtype === "message_changed") {
    return "message.updated";
  }
  if (subtype === "message_deleted") {
    return "message.deleted";
  }
  return "message.created";
}

function inferSlackObjectType(event: Record<string, unknown>): string {
  const type = readString(event.type) ?? "event";
  if (type !== "message") {
    if (type === "reaction_added" || type === "reaction_removed") {
      return "reaction";
    }
    if (type.startsWith("channel_") || type === "member_joined_channel" || type === "member_left_channel") {
      return "channel";
    }
    return type;
  }

  const threadTs = readString(event.thread_ts);
  const messageTs = readString(event.ts);
  if (!threadTs || !messageTs) {
    return "message";
  }

  return threadTs === messageTs ? "thread" : "thread_reply";
}

function inferSlackObjectId(objectType: string, event: Record<string, unknown>, fallback: string): string {
  switch (objectType) {
    case "message":
    case "thread": {
      const channel = readString(event.channel);
      const messageTs = readString(event.thread_ts) ?? readString(event.ts);
      return channel && messageTs ? `${channel}:${messageTs}` : fallback;
    }
    case "thread_reply": {
      const channel = readString(event.channel);
      const threadTs = readString(event.thread_ts);
      const replyTs = readString(event.ts);
      return channel && threadTs && replyTs ? `${channel}:${threadTs}:${replyTs}` : fallback;
    }
    case "reaction": {
      const item = asRecord(event.item);
      const reaction = readString(event.reaction);
      const user = readString(event.user);
      if (!item || !reaction || !user) {
        return fallback;
      }

      const itemType = readString(item.type) ?? "item";
      if (itemType === "message") {
        const channel = readString(item.channel) ?? "unknown";
        const ts = readString(item.ts) ?? "unknown";
        return `message:${channel}:${ts}:${reaction}:${user}`;
      }

      return `${itemType}:${reaction}:${user}`;
    }
    case "channel":
      return readString(event.channel) ?? readNestedString(event, "channel", "id") ?? fallback;
    default:
      return readString(event.event_ts) ?? fallback;
  }
}

function normalizeSlackWebhook(payload: Record<string, unknown>, headers: Headers): WebhookEvent {
  const envelopeType = readString(payload.type) ?? "unknown";

  if (envelopeType === "url_verification") {
    const challenge = readString(payload.challenge) ?? "challenge";
    return {
      provider: "slack",
      connectionId: defaultConnectionId(headers, payload),
      eventType: "url_verification",
      objectType: "challenge",
      objectId: challenge,
      payload,
    };
  }

  if (envelopeType !== "event_callback") {
    return {
      provider: "slack",
      connectionId: defaultConnectionId(headers, payload),
      eventType: envelopeType,
      objectType: "event",
      objectId: readString(payload.event_id) ?? envelopeType,
      payload,
    };
  }

  const event = asRecord(payload.event) ?? {};
  const objectType = inferSlackObjectType(event);
  const eventId = readString(payload.event_id) ?? readString(event.event_ts) ?? "slack-event";

  return {
    provider: "slack",
    connectionId: defaultConnectionId(headers, payload),
    eventType: inferSlackEventType(event),
    objectType,
    objectId: inferSlackObjectId(objectType, event, eventId),
    payload: event,
  };
}

function normalizeGenericWebhook(provider: string, payload: Record<string, unknown>, headers: Headers): WebhookEvent {
  const objectType = readString(payload.objectType) ?? readString(payload.object_type) ?? provider;
  const objectId =
    readString(payload.objectId) ??
    readString(payload.object_id) ??
    readString(payload.id) ??
    `${provider}-event`;
  const eventType =
    readString(payload.eventType) ??
    readString(payload.event_type) ??
    readString(payload.type) ??
    "unknown";

  return {
    provider,
    connectionId: defaultConnectionId(headers, payload),
    eventType,
    objectType,
    objectId,
    payload,
  };
}

function convertProviderWebhook(
  provider: string,
  payload: Record<string, unknown>,
  normalized: NormalizedWebhook,
): WebhookEvent {
  const eventType = normalized.eventType;
  const objectType =
    readString(normalized.objectType) ??
    readString(payload.objectType) ??
    readString(payload.object_type) ??
    readString(payload.type) ??
    provider;
  const objectId =
    readString(normalized.objectId) ??
    readString(payload.objectId) ??
    readString(payload.object_id) ??
    readString(payload.id) ??
    `${provider}-event`;

  return {
    provider: normalized.provider || provider,
    eventType,
    objectType,
    objectId,
    payload: normalized.payload,
    ...(normalized.connectionId ? { connectionId: normalized.connectionId } : {}),
  };
}

async function normalizeEvents(
  provider: string,
  payload: Record<string, unknown>,
  headers: Headers,
  rawBody: string,
  adapter: RegisteredWebhookAdapter,
  signal?: AbortSignal,
): Promise<WebhookEvent[]> {
  if (adapter.normalizeWebhook) {
    const normalized = await adapter.normalizeWebhook(payload, {
      provider,
      headers,
      rawBody,
      ...(signal ? { signal } : {}),
    });
    return Array.isArray(normalized) ? normalized : [normalized];
  }

  if (provider === "github") {
    return [normalizeGitHubWebhook(payload, headers)];
  }
  if (provider === "slack") {
    return [normalizeSlackWebhook(payload, headers)];
  }
  if (adapter.provider?.handleWebhook) {
    return [convertProviderWebhook(provider, payload, await adapter.provider.handleWebhook(payload))];
  }

  return [normalizeGenericWebhook(provider, payload, headers)];
}

function computePath(provider: string, adapter: RegisteredWebhookAdapter, event: WebhookEvent): string {
  if (adapter.computePath) {
    return adapter.computePath(event.objectType, event.objectId, event.payload);
  }
  return defaultPath(provider, event.objectType, event.objectId);
}

async function persistWebhook(
  client: RelayFileClient,
  workspaceId: string,
  provider: string,
  adapter: RegisteredWebhookAdapter,
  event: WebhookEvent,
  headers: Headers,
  signal?: AbortSignal,
): Promise<PersistedWebhook> {
  const path = computePath(provider, adapter, event);
  const deliveryId =
    event.metadata?.delivery_id ??
    headers.get("x-github-delivery") ??
    headers.get("x-slack-request-timestamp") ??
    undefined;
  const queued = await client.ingestWebhook({
    workspaceId,
    provider,
    event_type: event.eventType,
    path,
    data: event.payload,
    ...(deliveryId ? { delivery_id: deliveryId } : {}),
    timestamp: event.metadata?.timestamp ?? new Date().toISOString(),
    headers: headersToRecord(headers),
    ...(signal ? { signal } : {}),
  });

  return { event, path, queued };
}

function parseJsonBody(rawBody: string): Record<string, unknown> {
  const parsed = JSON.parse(rawBody) as unknown;
  const record = asRecord(parsed);
  if (!record) {
    throw new TypeError("Webhook payload must be a JSON object.");
  }
  return record;
}

export function installWebhookRoutes(options: InstallRoutesOptions): void {
  const { app, client, workspaceId, registry, secrets } = options;

  app.post("/:provider/webhook", async (context: Context) => {
    const providerParam = context.req.param("provider");
    const provider = providerParam ? providerParam.trim().toLowerCase() : "";
    const adapter = registry.get(provider);

    if (!adapter) {
      return context.json(
        {
          error: `Unknown provider "${provider}".`,
          registeredProviders: registry.list(),
        },
        404,
      );
    }

    const rawBody = await context.req.text();
    const verification = await verifyWebhookSignature(
      {
        provider,
        headers: context.req.raw.headers,
        rawBody,
        ...(secrets[provider] ? { secret: secrets[provider] } : {}),
      },
      adapter,
    );

    if (!verification.ok) {
      return context.json(
        { error: verification.error, reason: verification.reason },
        { status: verification.status },
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = parseJsonBody(rawBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON body.";
      return context.json({ error: message }, 400);
    }

    if (provider === "slack" && payload.type === "url_verification") {
      const challenge = readString(payload.challenge);
      if (!challenge) {
        return context.json({ error: "Slack url_verification payload is missing challenge." }, 400);
      }
      return context.json({ challenge });
    }

    let normalizedEvents: WebhookEvent[];
    try {
      normalizedEvents = await normalizeEvents(
        provider,
        payload,
        context.req.raw.headers,
        rawBody,
        adapter,
        context.req.raw.signal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to normalize webhook.";
      return context.json({ error: message }, 400);
    }

    try {
      const persisted = await Promise.all(
        normalizedEvents.map((event) =>
          persistWebhook(
            client,
            workspaceId,
            provider,
            adapter,
            event,
            context.req.raw.headers,
            context.req.raw.signal,
          ),
        ),
      );

      return context.json({
        ok: true,
        provider,
        workspaceId,
        received: persisted.length,
        paths: persisted.map((entry) => entry.path),
        operations: persisted.map((entry) => ({
          id: entry.queued.id,
          status: entry.queued.status,
          path: entry.path,
          eventType: entry.event.eventType,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to persist webhook.";
      return context.json({ error: message }, 502);
    }
  });
}
