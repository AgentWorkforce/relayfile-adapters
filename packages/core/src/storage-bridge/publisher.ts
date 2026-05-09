import {
  type StorageBridgeEvent,
  type StorageBridgeEventForSource,
  type StorageBridgeSource,
  validateStorageBridgeEvent,
} from "./event.js";

export interface StorageBridgePublishResult {
  readonly eventId: string;
  readonly published: boolean;
  readonly duplicate: boolean;
}

export interface StorageBridgeEventSubscriber {
  (event: StorageBridgeEvent): void | Promise<void>;
}

export interface StorageBridgeSubscription {
  unsubscribe(): void;
}

export interface StorageBridgeEventPublisher {
  publish(event: StorageBridgeEvent): Promise<StorageBridgePublishResult>;
  subscribe(subscriber: StorageBridgeEventSubscriber): StorageBridgeSubscription;
}

export interface StorageBridgeEventPublisherForSource<
  Source extends StorageBridgeSource,
> {
  publish(
    event: StorageBridgeEventForSource<Source>,
  ): Promise<StorageBridgePublishResult> | StorageBridgePublishResult;
}

export interface IdempotencyStore {
  claim(key: string, ttlMs?: number): Promise<boolean> | boolean;
  release?(key: string): Promise<void> | void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Map<string, number>();

  claim(key: string, ttlMs?: number): boolean {
    this.pruneExpired();
    if (this.seen.has(key)) return false;
    this.seen.set(key, ttlMs ? Date.now() + ttlMs : Number.POSITIVE_INFINITY);
    return true;
  }

  release(key: string): void {
    this.seen.delete(key);
  }

  clear(): void {
    this.seen.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}

export interface InMemoryPublisherOptions {
  readonly idempotencyStore?: IdempotencyStore;
  readonly idempotencyTtlMs?: number;
  readonly onSubscriberError?: (
    error: unknown,
    event: StorageBridgeEvent,
  ) => void | Promise<void>;
}

export class InMemoryStorageBridgeEventPublisher
  implements StorageBridgeEventPublisher
{
  private readonly subscribers = new Set<StorageBridgeEventSubscriber>();
  private readonly idempotencyStore: IdempotencyStore;
  private readonly idempotencyTtlMs?: number;
  private readonly onSubscriberError?: InMemoryPublisherOptions["onSubscriberError"];

  readonly events: StorageBridgeEvent[] = [];

  constructor(options: InMemoryPublisherOptions = {}) {
    this.idempotencyStore =
      options.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.idempotencyTtlMs = options.idempotencyTtlMs;
    this.onSubscriberError = options.onSubscriberError;
  }

  async publish(
    event: StorageBridgeEvent,
  ): Promise<StorageBridgePublishResult> {
    return publishStorageBridgeEvent(this, event, {
      idempotencyStore: this.idempotencyStore,
      idempotencyTtlMs: this.idempotencyTtlMs,
      skipPublisherIdempotency: true,
    });
  }

  subscribe(subscriber: StorageBridgeEventSubscriber): StorageBridgeSubscription {
    this.subscribers.add(subscriber);
    return {
      unsubscribe: () => {
        this.subscribers.delete(subscriber);
      },
    };
  }

  async publishUnchecked(event: StorageBridgeEvent): Promise<void> {
    this.events.push(event);
    await Promise.all(
      [...this.subscribers].map(async (subscriber) => {
        try {
          await subscriber(event);
        } catch (error) {
          await this.onSubscriberError?.(error, event);
        }
      }),
    );
  }
}

export interface PublishStorageBridgeEventOptions {
  readonly idempotencyStore?: IdempotencyStore;
  readonly idempotencyTtlMs?: number;
  readonly idempotencyKey?: string;
  readonly skipPublisherIdempotency?: boolean;
}

export async function publishStorageBridgeEvent(
  publisher: StorageBridgeEventPublisher,
  event: StorageBridgeEvent,
  options: PublishStorageBridgeEventOptions = {},
): Promise<StorageBridgePublishResult> {
  const validEvent = validateStorageBridgeEvent(event);
  const key = options.idempotencyKey ?? `storage-bridge:publish:${validEvent.eventId}`;

  if (options.idempotencyStore) {
    const claimed = await options.idempotencyStore.claim(
      key,
      options.idempotencyTtlMs,
    );
    if (!claimed) {
      return {
        eventId: validEvent.eventId,
        published: false,
        duplicate: true,
      };
    }
  }

  if (
    options.skipPublisherIdempotency &&
    publisher instanceof InMemoryStorageBridgeEventPublisher
  ) {
    await publisher.publishUnchecked(validEvent);
  } else {
    await publisher.publish(validEvent);
  }

  return {
    eventId: validEvent.eventId,
    published: true,
    duplicate: false,
  };
}
