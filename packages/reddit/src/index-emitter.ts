import {
  redditPostsIndexPath,
  redditRootIndexPath,
  redditSubredditPostsIndexPath,
  redditSubredditsIndexPath,
} from './path-mapper.js';
import type { RedditPost, RedditPostIndexRow, RedditSubreddit, RedditSubredditIndexRow } from './types.js';

function json(content: unknown): string {
  return `${JSON.stringify(content)}\n`;
}

function sortRows<T extends { updated?: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const left = Date.parse(a.updated ?? '');
    const right = Date.parse(b.updated ?? '');
    const leftValue = Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
    const rightValue = Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
    return rightValue - leftValue || a.id.localeCompare(b.id);
  });
}

export function buildRedditRootIndexFile() {
  return {
    path: redditRootIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: json([
      { id: 'subreddits', path: '/reddit/subreddits' },
      { id: 'posts', path: '/reddit/posts' },
    ]),
  };
}

export function buildRedditSubredditsIndexFile(rows: readonly RedditSubredditIndexRow[]) {
  return {
    path: redditSubredditsIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: json(sortRows(rows)),
  };
}

export function buildRedditPostsIndexFile(rows: readonly RedditPostIndexRow[]) {
  return {
    path: redditPostsIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: json(sortRows(rows)),
  };
}

export function buildRedditSubredditPostsIndexFile(subreddit: string, rows: readonly RedditPostIndexRow[]) {
  return {
    path: redditSubredditPostsIndexPath(subreddit),
    contentType: 'application/json; charset=utf-8',
    content: json(sortRows(rows)),
  };
}

export function redditSubredditIndexRow(record: RedditSubreddit): RedditSubredditIndexRow {
  const createdUtc = typeof record.created_utc === 'number' && Number.isFinite(record.created_utc)
    ? record.created_utc
    : undefined;
  return {
    id: record.name,
    title: record.title ?? record.display_name_prefixed ?? record.name,
    updated:
      createdUtc !== undefined
        ? new Date(createdUtc * 1000).toISOString()
        : new Date().toISOString(),
    ...(typeof record.subscribers === 'number' ? { subscribers: record.subscribers } : {}),
  };
}

export function redditPostIndexRow(record: RedditPost): RedditPostIndexRow {
  const createdUtc = typeof record.created_utc === 'number' && Number.isFinite(record.created_utc)
    ? record.created_utc
    : undefined;
  return {
    id: record.id,
    title: record.title,
    updated:
      createdUtc !== undefined
        ? new Date(createdUtc * 1000).toISOString()
        : new Date().toISOString(),
    subreddit: record.subreddit,
    ...(typeof record.score === 'number' ? { score: record.score } : {}),
    ...(record.status ? { status: record.status } : {}),
  };
}

export function redditSubredditTitle(record: RedditSubreddit): string {
  return record.title ?? record.display_name_prefixed ?? record.name;
}

export function redditPostTitle(record: RedditPost): string {
  return record.title;
}
