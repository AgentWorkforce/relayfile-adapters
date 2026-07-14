import type { IntegrationClientOptions } from '@relayfile/adapter-core/vfs-client';
import { providerClient, type ProviderClient, type ResourceClient } from './provider-client.js';
import type { RelayParams } from './generic.js';

/**
 * Normalize a subreddit param the same way `@relayfile/adapter-reddit`'s
 * `normalizeSubreddit` does at write time. The reddit adapter lowercases the
 * subreddit segment when materializing records (`/reddit/subreddits/<lower>/…`),
 * so a reader passing `LocalLLaMA` without normalization would read from a
 * capitalized directory that never gets any records and see an empty list.
 * Keep this in lockstep with `packages/reddit/src/path-mapper.ts#normalizeSubreddit`.
 */
function normalizeSubredditName(value: string): string {
  return value.trim().replace(/^r\//i, '').toLowerCase();
}

function normalizeRedditParams(params?: RelayParams): RelayParams {
  if (!params) return {};
  const out: RelayParams = { ...params };
  const raw = out.subreddit;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    out.subreddit = normalizeSubredditName(raw);
  }
  return out;
}

function withSubredditNormalization(resource: ResourceClient): ResourceClient {
  return {
    path: (params) => resource.path(normalizeRedditParams(params)),
    write: (params, body) => resource.write(normalizeRedditParams(params), body),
    read: <T>(params?: RelayParams) => resource.read<T>(normalizeRedditParams(params)),
    list: <T>(params?: RelayParams) => resource.list<T>(normalizeRedditParams(params)),
  };
}

/**
 * Ergonomic Reddit client over the writeback-path catalog. Wraps the generic
 * `providerClient('reddit')` so that any `{ subreddit }` param is normalized
 * (lowercased, `r/` prefix stripped) before path substitution — matching the
 * reddit adapter's canonical write path. Without this, `posts.list({ subreddit:
 * 'LocalLLaMA' })` resolves to `/reddit/subreddits/LocalLLaMA/posts` and misses
 * every synced record, which lives under the lowercased subdirectory.
 */
export function redditClient(opts: IntegrationClientOptions = {}): ProviderClient<'reddit'> {
  const base = providerClient('reddit', opts);
  return {
    ...base,
    posts: withSubredditNormalization(base.posts),
  };
}
