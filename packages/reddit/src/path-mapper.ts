export const REDDIT_PATH_ROOT = '/reddit';

export type RedditPathObjectType = 'subreddit' | 'post';

export interface ComputeRedditPathInput {
  subreddit?: string;
  title?: string;
}

function encodeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Reddit path segment must be non-empty');
  }
  return encodeURIComponent(trimmed);
}

export function normalizeSubreddit(value: string): string {
  const trimmed = value.trim().replace(/^r\//i, '').toLowerCase();
  if (!trimmed) {
    throw new Error('Reddit subreddit must be non-empty');
  }
  return trimmed;
}

// Keeps `<slug>__<postId>.json` comfortably under the 255-byte NAME_MAX most
// filesystems enforce -- long Reddit titles (and the mount sync's own
// `.tmp-<random>` suffix on top) can otherwise blow past that limit and fail
// every sync cycle for the post.
const SLUG_MAX_LENGTH = 80;

function slugify(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]+/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'post';
}

function parseScopedPostId(id: string): { subreddit: string; postId: string } {
  const trimmed = id.trim();
  const divider = trimmed.indexOf('/');
  if (divider > 0) {
    return {
      subreddit: normalizeSubreddit(trimmed.slice(0, divider)),
      postId: trimmed.slice(divider + 1).trim(),
    };
  }
  throw new Error('Expected reddit post id in "subreddit/post_id" format');
}

function parsePostIdWithOptionalScope(
  id: string,
  fallbackSubreddit?: string,
): { subreddit: string; postId: string } {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error('Reddit post id must be non-empty');
  }
  const divider = trimmed.indexOf('/');
  if (divider > 0) {
    return {
      subreddit: normalizeSubreddit(trimmed.slice(0, divider)),
      postId: trimmed.slice(divider + 1).trim(),
    };
  }

  if (fallbackSubreddit) {
    return {
      subreddit: normalizeSubreddit(fallbackSubreddit),
      postId: trimmed,
    };
  }

  throw new Error('Expected reddit post id in "subreddit/post_id" format when subreddit is not provided');
}

export function redditLayoutPath(): string {
  return `${REDDIT_PATH_ROOT}/LAYOUT.md`;
}

export function redditRootIndexPath(): string {
  return `${REDDIT_PATH_ROOT}/_index.json`;
}

export function redditSubredditsIndexPath(): string {
  return `${REDDIT_PATH_ROOT}/subreddits/_index.json`;
}

export function redditPostsIndexPath(): string {
  return `${REDDIT_PATH_ROOT}/posts/_index.json`;
}

export function redditSubredditPostsIndexPath(subreddit: string): string {
  return `${REDDIT_PATH_ROOT}/subreddits/${encodeSegment(normalizeSubreddit(subreddit))}/posts/_index.json`;
}

export function redditSubredditPath(subreddit: string): string {
  return `${REDDIT_PATH_ROOT}/subreddits/${encodeSegment(normalizeSubreddit(subreddit))}.json`;
}

export function redditSubredditByIdAliasPath(subreddit: string): string {
  return `${REDDIT_PATH_ROOT}/subreddits/by-id/${encodeSegment(normalizeSubreddit(subreddit))}.json`;
}

export function redditPostPath(subreddit: string, postId: string, title?: string): string {
  const slug = title ? `${slugify(title)}__` : '';
  return `${REDDIT_PATH_ROOT}/subreddits/${encodeSegment(normalizeSubreddit(subreddit))}/posts/${slug}${encodeSegment(postId)}.json`;
}

export function redditPostByIdAliasPath(subreddit: string, postId: string): string {
  return `${REDDIT_PATH_ROOT}/posts/by-id/${encodeSegment(normalizeSubreddit(subreddit))}__${encodeSegment(postId)}.json`;
}

export function redditPostByStatusAliasPath(status: string, subreddit: string, postId: string): string {
  return `${REDDIT_PATH_ROOT}/posts/by-status/${encodeSegment(status.toLowerCase())}/${encodeSegment(normalizeSubreddit(subreddit))}__${encodeSegment(postId)}.json`;
}

export function normalizeNangoRedditModel(model: string): RedditPathObjectType {
  const normalized = model.trim().toLowerCase();
  if (normalized === 'reddittrackedsubreddit' || normalized === 'subreddit') {
    return 'subreddit';
  }
  if (normalized === 'redditpost' || normalized === 'post') {
    return 'post';
  }
  throw new Error(`Unsupported reddit model: ${model}`);
}

export function computeRedditPath(
  objectType: RedditPathObjectType,
  id: string,
  input: ComputeRedditPathInput = {},
): string {
  if (objectType === 'subreddit') {
    return redditSubredditPath(id);
  }

  const scoped = parsePostIdWithOptionalScope(id, input.subreddit);
  return redditPostPath(scoped.subreddit, scoped.postId, input.title);
}

export function computeRedditPathFromModel(
  model: string,
  id: string,
  input: ComputeRedditPathInput = {},
): string {
  return computeRedditPath(normalizeNangoRedditModel(model), id, input);
}

export function parseRedditPostScopedId(id: string): { subreddit: string; postId: string } {
  return parseScopedPostId(id);
}
