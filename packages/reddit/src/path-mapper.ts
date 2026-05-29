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

function normalizeSubreddit(value: string): string {
  const trimmed = value.trim().replace(/^r\//i, '').toLowerCase();
  if (!trimmed) {
    throw new Error('Reddit subreddit must be non-empty');
  }
  return trimmed;
}

function slugify(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]+/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

export function redditLayoutPath(): string {
  return `${REDDIT_PATH_ROOT}/LAYOUT.md`;
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

  const scoped = parseScopedPostId(id);
  const subreddit = input.subreddit ? normalizeSubreddit(input.subreddit) : scoped.subreddit;
  return redditPostPath(subreddit, scoped.postId, input.title);
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
