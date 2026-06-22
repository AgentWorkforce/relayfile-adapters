import type { IntegrationClientOptions } from '@relayfile/adapter-core/vfs-client';
import { providerClient, type ProviderClient } from './provider-client.js';
import { createWritebackIdempotency, withWritebackIdempotency } from './writeback-idempotency.js';

export { createWritebackIdempotency } from './writeback-idempotency.js';

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

/** Process-wide stamper shared across every slackClient instance in this run. */
const nextWritebackIdempotencyKey = createWritebackIdempotency();

/** Attach the per-message idempotency token to a writeback body when one applies. */
function withIdempotency(body: Record<string, unknown>): Record<string, unknown> {
  return withWritebackIdempotency(body, nextWritebackIdempotencyKey);
}

export interface SlackClient extends ProviderClient<'slack'> {
  /**
   * Post a message to a channel.
   *
   * Returns `ref` — the draft handle for this post — alongside the delivered
   * `ts`. Pass that `ref` as `opts.replyTo` on a later `post` to thread the new
   * message under this one **without waiting for a receipt**: the new post is
   * written with `parentRef`, and the cloud orders it after this post delivers
   * and sets `thread_ts` to its delivered ts server-side.
   *
   * `replyTo` relies on the cloud's server-side threading (it resolves
   * `parentRef` via the writeback DO's ordered dispatch). The in-repo Slack
   * writeback resolver does NOT turn `parentRef` into a thread — so on any path
   * that posts through the adapter without the cloud (e.g. a local executor),
   * a `replyTo` post lands top-level. For ts-based threading independent of the
   * cloud, use `reply(channel, ts, text)`, which is unchanged.
   */
  post(
    channel: string,
    text: string,
    opts?: { replyTo?: string },
  ): Promise<{ channel: string; ts: string; ref: string }>;
  /** Direct-message a user. */
  dm(user: string, text: string): Promise<{ user: string; ts: string }>;
  /** Reply in a thread by the parent's delivered ts. */
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
    async post(channel: string, text: string, opts: { replyTo?: string } = {}) {
      const body = opts.replyTo ? { text, parentRef: opts.replyTo } : { text };
      const result = await base.messages.write({ channelId: channel }, withIdempotency(body));
      return {
        channel,
        ts: slackReceiptTs(result.receipt),
        // The draft path doubles as the threading handle — available immediately,
        // even with a 0ms writeback timeout (no receipt wait needed to thread).
        ref: result.path,
      };
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
