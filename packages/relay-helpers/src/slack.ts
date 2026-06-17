import type { IntegrationClientOptions } from '@relayfile/adapter-core/vfs-client';
import { providerClient, type ProviderClient } from './provider-client.js';

/** Slack message timestamps contain `.`; the mount path encodes it as `_`. */
function tsParam(ts: string): string {
  return ts.replace(/\./g, '_');
}

/**
 * The delivered Slack message ts off a writeback receipt. The writeback worker
 * records the real `chat.postMessage` ts as the receipt's `externalId` (the
 * idempotency-replay path also mirrors it onto `ts`); only older/non-message
 * receipts fall back to `created`/`id`. Returning the actual message ts is what
 * lets callers thread a reply onto a post — reading `created`/`id` alone gave an
 * empty (or non-ts) value, so threaded replies silently failed.
 */
export function slackReceiptTs(
  receipt: { externalId?: string; ts?: unknown; created?: string; id?: string } | undefined
): string {
  if (!receipt) return '';
  const replayTs = typeof receipt.ts === 'string' ? receipt.ts : undefined;
  return receipt.externalId ?? replayTs ?? receipt.created ?? receipt.id ?? '';
}

/**
 * Build the stamper of per-message idempotency tokens for scheduled (clock)
 * deliveries, so a re-run of the same tick — e.g. a duplicate sandbox spawned
 * when a delivery is re-claimed — can't post the same message twice even if the
 * regenerated content differs slightly (drifting counts, reordered links).
 * Token format: `tick:<deliveryId>:<ordinal>`.
 *
 * The ordinal is a counter incremented in call order across post/dm/reply. Each
 * scheduled `runner.mjs` invocation is exactly one delivery and gets its own
 * stamper, so the counter starts at 1 every run and a re-delivery (a fresh
 * process) reproduces the same ordinals — aligning the keys across the original
 * and duplicate runs. A token is emitted only when a delivery id is present
 * (`WORKFORCE_TICK_DELIVERY_ID`, which the cloud sets for scheduled ticks);
 * otherwise it returns undefined and the cloud worker falls back to its
 * content-hash idempotency, and the ordinal does not advance.
 *
 * Alignment assumes the handler issues its posts in a deterministic order across
 * runs (sequential post → reply, as the digest agents do). Concurrent/unordered
 * posting would not line the ordinals up.
 *
 * Exported (with an injectable delivery-id source) for unit testing.
 */
export function createWritebackIdempotency(
  getDeliveryId: () => string | undefined = () => process.env.WORKFORCE_TICK_DELIVERY_ID
): () => string | undefined {
  let ordinal = 0;
  return () => {
    const deliveryId = getDeliveryId();
    if (!deliveryId) return undefined;
    ordinal += 1;
    return `tick:${deliveryId}:${ordinal}`;
  };
}

/** Process-wide stamper shared across every slackClient instance in this run. */
const nextWritebackIdempotencyKey = createWritebackIdempotency();

/** Attach the per-message idempotency token to a writeback body when one applies. */
function withIdempotency(body: Record<string, unknown>): Record<string, unknown> {
  const idempotencyKey = nextWritebackIdempotencyKey();
  return idempotencyKey ? { ...body, idempotencyKey } : body;
}

export interface SlackClient extends ProviderClient<'slack'> {
  /** Post a message to a channel. */
  post(channel: string, text: string): Promise<{ channel: string; ts: string }>;
  /** Direct-message a user. */
  dm(user: string, text: string): Promise<{ user: string; ts: string }>;
  /** Reply in a thread. */
  reply(channel: string, threadTs: string, text: string): Promise<{ channel: string; ts: string }>;
  /** React to a message. */
  react(channel: string, messageTs: string, emoji: string): Promise<void>;
}

/**
 * Ergonomic Slack client over the writeback-path catalog, plus the uniform
 * resource-keyed access (`.messages`, `.["direct-messages"]`, `.replies`, `.reactions`).
 */
export function slackClient(opts: IntegrationClientOptions = {}): SlackClient {
  const base = providerClient('slack', opts);
  return Object.assign(base, {
    async post(channel: string, text: string) {
      const result = await base.messages.write({ channelId: channel }, withIdempotency({ text }));
      return { channel, ts: slackReceiptTs(result.receipt) };
    },
    async dm(user: string, text: string) {
      const result = await base['direct-messages'].write({ userId: user }, withIdempotency({ text }));
      return { user, ts: slackReceiptTs(result.receipt) };
    },
    async reply(channel: string, threadTs: string, text: string) {
      const result = await base.replies.write({ channelId: channel, messageTs: tsParam(threadTs) }, withIdempotency({ text }));
      return { channel, ts: slackReceiptTs(result.receipt) };
    },
    async react(channel: string, messageTs: string, emoji: string) {
      await base.reactions.write({ channelId: channel, messageTs: tsParam(messageTs) }, { emoji });
    }
  }) as SlackClient;
}
