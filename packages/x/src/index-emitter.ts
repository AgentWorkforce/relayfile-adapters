import { EMIT_AUXILIARY_JSON_CONTENT_TYPE } from '@relayfile/adapter-core';

import {
  xPostsIndexPath,
  xRootIndexPath,
  xSearchesIndexPath,
  xSearchResultsIndexPath,
  xUsersIndexPath,
} from './path-mapper.js';
import type {
  XIndexRow,
  XPost,
  XPostIndexRow,
  XSearchIndexRow,
  XSearchResult,
  XSearchRun,
  XUser,
  XUserIndexRow,
} from './types.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export function buildXRootIndexFile() {
  return jsonFile(xRootIndexPath(), [
    { id: 'searches', title: 'Searches' },
    { id: 'posts', title: 'Posts' },
    { id: 'users', title: 'Users' },
  ]);
}

export function buildXSearchesIndexFile(rows: readonly XSearchIndexRow[]) {
  return jsonFile(xSearchesIndexPath(), sortRows(rows));
}

export function buildXPostsIndexFile(rows: readonly XPostIndexRow[]) {
  return jsonFile(xPostsIndexPath(), sortRows(rows));
}

export function buildXUsersIndexFile(rows: readonly XUserIndexRow[]) {
  return jsonFile(xUsersIndexPath(), sortRows(rows));
}

export function buildXSearchResultsIndexFile(
  searchId: string,
  titleOrQuery: string | null | undefined,
  rows: readonly XSearchResult[],
) {
  return jsonFile(
    xSearchResultsIndexPath(searchId, titleOrQuery),
    rows.slice().sort((left, right) => left.rank - right.rank || left.postId.localeCompare(right.postId)),
  );
}

export function xSearchIndexRow(run: XSearchRun): XSearchIndexRow {
  return {
    id: run.id,
    title: run.title,
    updated: run.requestedAt,
    query: run.query,
    mode: run.mode,
    resultCount: run.resultCount,
    estimatedUsd: run.costEstimate.estimatedUsd,
  };
}

export function xPostIndexRow(post: XPost, username?: string): XPostIndexRow {
  const title = postTitle(post);
  return {
    id: post.id,
    title,
    updated: post.created_at ?? '',
    ...(post.author_id ? { authorId: post.author_id } : {}),
    ...(username ? { username } : {}),
    ...(post.conversation_id ? { conversationId: post.conversation_id } : {}),
    ...(post.lang ? { lang: post.lang } : {}),
    ...(typeof post.public_metrics?.like_count === 'number' ? { likeCount: post.public_metrics.like_count } : {}),
    ...(typeof post.public_metrics?.reply_count === 'number' ? { replyCount: post.public_metrics.reply_count } : {}),
    ...(typeof post.public_metrics?.retweet_count === 'number' ? { repostCount: post.public_metrics.retweet_count } : {}),
  };
}

export function xUserIndexRow(user: XUser): XUserIndexRow {
  return {
    id: user.id,
    title: user.name ?? user.username ?? user.id,
    updated: '',
    ...(user.username ? { username: user.username } : {}),
    ...(typeof user.verified === 'boolean' ? { verified: user.verified } : {}),
  };
}

export function postTitle(post: XPost): string {
  const text = post.text.replace(/\s+/gu, ' ').trim();
  if (!text) return post.id;
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

function sortRows<TRow extends XIndexRow>(rows: readonly TRow[]): TRow[] {
  return rows.slice().sort((left, right) => {
    const rightMs = Date.parse(right.updated);
    const leftMs = Date.parse(left.updated);
    const time = (Number.isNaN(rightMs) ? Number.NEGATIVE_INFINITY : rightMs)
      - (Number.isNaN(leftMs) ? Number.NEGATIVE_INFINITY : leftMs);
    return time || left.id.localeCompare(right.id);
  });
}

function jsonFile(path: string, value: unknown) {
  return {
    path,
    contentType: JSON_CONTENT_TYPE,
    content: `${JSON.stringify(value, null, 2)}\n`,
  };
}
