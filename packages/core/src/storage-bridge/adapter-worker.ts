import {
  type JsonValue,
  type StorageBridgeEvent,
  storageBridgeWebhookEventType,
  validateStorageBridgeEvent,
} from "./event.js";
import {
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  type StorageBridgeEventPublisher,
  type StorageBridgeSubscription,
} from "./publisher.js";

export type StorageBridgeContentBody =
  | string
  | Uint8Array
  | ArrayBuffer
  | Buffer
  | null;

export interface StorageBridgeFetchedContent {
  readonly body: StorageBridgeContentBody;
  readonly contentType?: string;
  readonly headers?: Record<string, string>;
  readonly metadata?: Record<string, JsonValue>;
}

export interface StorageBridgeFetchContentContext<Config = unknown> {
  readonly config: Config;
  readonly signal?: AbortSignal;
}

export interface StorageBridgeContentFetcher<Config = unknown> {
  (
    event: StorageBridgeEvent,
    context: StorageBridgeFetchContentContext<Config>,
  ): Promise<StorageBridgeFetchedContent> | StorageBridgeFetchedContent;
}

export interface StorageBridgeRelayFileClient {
  ingestWebhook(input: StorageBridgeWebhookEnvelope): Promise<unknown>;
}

export interface StorageBridgeWebhookEnvelope {
  readonly workspaceId: string;
  readonly provider: string;
  readonly event_type: "file.created" | "file.updated" | "file.deleted";
  readonly path: string;
  readonly delivery_id: string;
  readonly timestamp: string;
  readonly data: {
    readonly contentBase64: string | null;
    readonly contentType: string | null;
    readonly sizeBytes: number | null;
    readonly fingerprint: string | null;
    readonly resourceId: string;
    readonly metadata: Record<string, JsonValue>;
  };
  readonly headers: Record<string, string>;
  readonly semantics: {
    readonly properties: Record<string, JsonValue>;
  };
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs?: number;
  readonly jitterRatio?: number;
}

export interface DeadLetterRecord {
  readonly event: StorageBridgeEvent;
  readonly envelope?: StorageBridgeWebhookEnvelope;
  readonly attempts: number;
  readonly error: string;
  readonly failedAt: string;
}

export interface DeadLetterSink {
  push(record: DeadLetterRecord): Promise<void> | void;
}

export class InMemoryDeadLetterSink implements DeadLetterSink {
  readonly records: DeadLetterRecord[] = [];

  push(record: DeadLetterRecord): void {
    this.records.push(record);
  }
}

export interface StorageBridgeAdapterWorkerOptions<Config = unknown> {
  readonly provider: string;
  readonly workspaceId?: string;
  readonly config: Config;
  readonly publisher: StorageBridgeEventPublisher;
  readonly client: StorageBridgeRelayFileClient;
  readonly fetchContent: StorageBridgeContentFetcher<Config>;
  readonly idempotencyStore?: IdempotencyStore;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly deadLetterSink?: DeadLetterSink;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface StorageBridgeWorkerResult {
  readonly eventId: string;
  readonly delivered: boolean;
  readonly duplicate: boolean;
  readonly attempts: number;
  readonly envelope?: StorageBridgeWebhookEnvelope;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5_000,
  jitterRatio: 0,
};

export class StorageBridgeAdapterWorker<Config = unknown> {
  private readonly options: StorageBridgeAdapterWorkerOptions<Config>;
  private readonly idempotencyStore: IdempotencyStore;
  private readonly retryPolicy: RetryPolicy;
  private readonly deadLetterSink: DeadLetterSink;
  private readonly sleep: (ms: number) => Promise<void>;
  private subscription?: StorageBridgeSubscription;

  constructor(options: StorageBridgeAdapterWorkerOptions<Config>) {
    this.options = options;
    this.idempotencyStore =
      options.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };
    this.deadLetterSink = options.deadLetterSink ?? new InMemoryDeadLetterSink();
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  start(): StorageBridgeSubscription {
    if (this.subscription) return this.subscription;
    this.subscription = this.options.publisher.subscribe(async (event) => {
      await this.handleEvent(event);
    });
    return this.subscription;
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }

  async handleEvent(event: StorageBridgeEvent): Promise<StorageBridgeWorkerResult> {
    const validEvent = validateStorageBridgeEvent(event);
    const deliveryKey = `storage-bridge:ingest:${validEvent.eventId}`;
    const claimed = await this.idempotencyStore.claim(deliveryKey);
    if (!claimed) {
      return {
        eventId: validEvent.eventId,
        delivered: false,
        duplicate: true,
        attempts: 0,
      };
    }

    let envelope: StorageBridgeWebhookEnvelope | undefined;
    let attempts = 0;
    try {
      const content =
        validEvent.changeType === "deleted"
          ? { body: null }
          : await this.options.fetchContent(validEvent, {
              config: this.options.config,
              signal: this.options.signal,
            });
      envelope = buildStorageBridgeWebhookEnvelope({
        event: validEvent,
        provider: this.options.provider,
        workspaceId: this.options.workspaceId,
        content,
      });

      await retry(
        async () => {
          attempts += 1;
          if (!envelope) throw new Error("Storage bridge webhook envelope missing");
          await this.options.client.ingestWebhook(envelope);
        },
        this.retryPolicy,
        this.sleep,
      );

      return {
        eventId: validEvent.eventId,
        delivered: true,
        duplicate: false,
        attempts,
        envelope,
      };
    } catch (error) {
      await this.deadLetterSink.push({
        event: validEvent,
        envelope,
        attempts,
        error: toErrorMessage(error),
        failedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}

export function buildStorageBridgeWebhookEnvelope(input: {
  readonly event: StorageBridgeEvent;
  readonly provider?: string;
  readonly workspaceId?: string;
  readonly content?: StorageBridgeFetchedContent;
}): StorageBridgeWebhookEnvelope {
  const event = validateStorageBridgeEvent(input.event);
  const body = input.content?.body ?? null;
  const bodyBase64 = body === null ? null : bodyToBuffer(body).toString("base64");
  const metadata = {
    ...event.metadata,
    ...(input.content?.metadata ?? {}),
    ...(event.digest ? { digest: event.digest } : {}),
    ...(event.summary ? { summary: event.summary as Record<string, JsonValue> } : {}),
  };

  return {
    workspaceId: event.workspaceId ?? input.workspaceId ?? "",
    provider: input.provider ?? event.source,
    event_type: storageBridgeWebhookEventType(event.changeType),
    path: event.relayfilePath,
    delivery_id: event.eventId,
    timestamp: event.occurredAt,
    data: {
      contentBase64: bodyBase64,
      contentType: input.content?.contentType ?? null,
      sizeBytes: event.sizeBytes,
      fingerprint: event.fingerprint,
      resourceId: event.resourceId,
      metadata,
    },
    headers: {
      "x-relayfile-storage-bridge-source": event.source,
      "x-relayfile-storage-bridge-event-id": event.eventId,
      ...(input.content?.headers ?? {}),
    },
    semantics: {
      properties: {
        "storage_bridge.source": event.source,
        "storage_bridge.change_type": event.changeType,
        "storage_bridge.resource_id": event.resourceId,
        "storage_bridge.fingerprint": event.fingerprint,
        "storage_bridge.digest": event.digest ?? event.fingerprint,
        "storage_bridge.delivery_id": event.eventId,
      },
    },
  };
}

async function retry(
  fn: () => Promise<void>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= policy.maxAttempts) break;
      await sleep(computeRetryDelay(policy, attempt));
    }
  }
  throw lastError;
}

function computeRetryDelay(policy: RetryPolicy, attempt: number): number {
  const capped = Math.min(
    policy.maxDelayMs ?? Number.POSITIVE_INFINITY,
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  if (!policy.jitterRatio) return capped;
  const spread = capped * policy.jitterRatio;
  return Math.max(0, capped - spread + Math.random() * spread * 2);
}

function bodyToBuffer(body: Exclude<StorageBridgeContentBody, null>): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return Buffer.from(body);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
