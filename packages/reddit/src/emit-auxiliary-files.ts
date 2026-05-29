import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  runEmitBatch,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import {
  buildRedditPostsIndexFile,
  buildRedditRootIndexFile,
  buildRedditSubredditPostsIndexFile,
  buildRedditSubredditsIndexFile,
  redditPostIndexRow,
  redditPostTitle,
  redditSubredditIndexRow,
  redditSubredditTitle,
} from './index-emitter.js';
import { redditLayoutPromptFile } from './layout-prompt.js';
import {
  parseRedditPostScopedId,
  redditPostByIdAliasPath,
  redditPostByStatusAliasPath,
  redditPostPath,
  redditPostsIndexPath,
  redditSubredditByIdAliasPath,
  redditSubredditPath,
  redditSubredditPostsIndexPath,
  redditSubredditsIndexPath,
} from './path-mapper.js';
import type { RedditPost, RedditPostIndexRow, RedditSubreddit, RedditSubredditIndexRow } from './types.js';

const REDDIT_PROVIDER_NAME = 'reddit';
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export type RedditDeletedRecord = {
  id: string;
  _deleted: true;
  objectType: 'subreddit' | 'post';
};

export type RedditSubredditEmitRecord = RedditSubreddit | RedditDeletedRecord;
export type RedditPostEmitRecord = RedditPost | RedditDeletedRecord;

export interface RedditEmitAuxiliaryFilesInput {
  workspaceId: string;
  records?: readonly (RedditSubreddit | RedditPost | RedditDeletedRecord)[];
  subreddits?: readonly RedditSubredditEmitRecord[];
  posts?: readonly RedditPostEmitRecord[];
  connectionId?: string;
}

export async function emitRedditAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: RedditEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const workspaceId = input.workspaceId;
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  await writeStaticFiles(client, workspaceId, aggregate);

  const classified = classifyRecords(input.records ?? []);
  const subreddits = [...(input.subreddits ?? []), ...classified.subreddits];
  const posts = [...(input.posts ?? []), ...classified.posts];

  const subredditIndex = new IndexFileReconciler<RedditSubredditIndexRow>({
    client,
    workspaceId,
    path: redditSubredditsIndexPath(),
    builder: buildRedditSubredditsIndexFile,
  });
  const postIndex = new IndexFileReconciler<RedditPostIndexRow>({
    client,
    workspaceId,
    path: redditPostsIndexPath(),
    builder: buildRedditPostsIndexFile,
  });
  const subredditPostIndexes = new Map<string, IndexFileReconciler<RedditPostIndexRow>>();

  accumulate(aggregate, await runEmitBatch(client, workspaceId, subreddits, (record) =>
    planSubredditRecord(record, subredditIndex, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, posts, (record) =>
    planPostRecord(record, postIndex, getSubredditPostIndex, input.connectionId),
  ));

  for (const reconciler of [subredditIndex, postIndex, ...subredditPostIndexes.values()]) {
    const flush = await reconciler.flush();
    aggregate.written += flush.written;
    aggregate.errors.push(...flush.errors);
  }

  return aggregate;

  function getSubredditPostIndex(subreddit: string): IndexFileReconciler<RedditPostIndexRow> {
    let reconciler = subredditPostIndexes.get(subreddit);
    if (!reconciler) {
      reconciler = new IndexFileReconciler<RedditPostIndexRow>({
        client,
        workspaceId,
        path: redditSubredditPostsIndexPath(subreddit),
        builder: (rows) => buildRedditSubredditPostsIndexFile(subreddit, rows),
      });
      subredditPostIndexes.set(subreddit, reconciler);
    }
    return reconciler;
  }
}

async function writeStaticFiles(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  for (const file of [buildRedditRootIndexFile(), redditLayoutPromptFile()]) {
    try {
      await client.writeFile({
        workspaceId,
        path: file.path,
        content: file.content,
        contentType: file.contentType,
      });
      aggregate.written += 1;
    } catch (error) {
      aggregate.errors.push({ path: file.path, error: stringifyError(error) });
    }
  }
}

function planSubredditRecord(
  record: RedditSubredditEmitRecord,
  index: IndexFileReconciler<RedditSubredditIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const id = record.id;
  const subreddit = id.trim().toLowerCase();
  if (isDeleted(record)) {
    index.remove(subreddit);
    return {
      deletes: staleDeletes([
        redditSubredditPath(subreddit),
        redditSubredditByIdAliasPath(subreddit),
      ]),
    };
  }

  const row = redditSubredditIndexRow(record);
  index.upsert(row);
  const canonicalPath = redditSubredditPath(record.name);
  const content = json(recordEnvelope('subreddit', record.id, canonicalPath, redditSubredditTitle(record), record, connectionId));
  const semantics = {
    properties: {
      provider: REDDIT_PROVIDER_NAME,
      'reddit.object_type': 'subreddit',
      'reddit.subreddit': record.name,
    },
  };
  return {
    writes: [
      mirrorWrite(canonicalPath, content, semantics),
      mirrorWrite(redditSubredditByIdAliasPath(record.name), content, semantics),
    ],
  };
}

function planPostRecord(
  record: RedditPostEmitRecord,
  index: IndexFileReconciler<RedditPostIndexRow>,
  subredditIndex: (subreddit: string) => IndexFileReconciler<RedditPostIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const scoped = parseRedditPostScopedId(record.id);
  if (isDeleted(record)) {
    index.remove(record.id);
    subredditIndex(scoped.subreddit).remove(record.id);
    return {
      deletes: staleDeletes([
        redditPostPath(scoped.subreddit, scoped.postId),
        redditPostByIdAliasPath(scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('active', scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('locked', scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('archived', scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('removed', scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('deleted', scoped.subreddit, scoped.postId),
      ]),
    };
  }

  const row = redditPostIndexRow(record);
  index.upsert(row);
  subredditIndex(record.subreddit).upsert(row);

  const canonicalPath = redditPostPath(record.subreddit, record.post_id, redditPostTitle(record));
  const content = json(recordEnvelope('post', record.id, canonicalPath, redditPostTitle(record), record, connectionId));
  const status = (record.status ?? 'active').toLowerCase();
  const semantics = {
    properties: {
      provider: REDDIT_PROVIDER_NAME,
      'reddit.object_type': 'post',
      'reddit.subreddit': record.subreddit,
      'reddit.post_id': record.post_id,
      'reddit.status': status,
    },
  };

  return {
    writes: [
      mirrorWrite(canonicalPath, content, semantics),
      mirrorWrite(redditPostByIdAliasPath(record.subreddit, record.post_id), content, semantics),
      mirrorWrite(redditPostByStatusAliasPath(status, record.subreddit, record.post_id), content, semantics),
    ],
    deletes: staleDeletes([
      ...(status === 'active' ? [] : [redditPostByStatusAliasPath('active', record.subreddit, record.post_id)]),
      ...(status === 'locked' ? [] : [redditPostByStatusAliasPath('locked', record.subreddit, record.post_id)]),
      ...(status === 'archived' ? [] : [redditPostByStatusAliasPath('archived', record.subreddit, record.post_id)]),
      ...(status === 'removed' ? [] : [redditPostByStatusAliasPath('removed', record.subreddit, record.post_id)]),
      ...(status === 'deleted' ? [] : [redditPostByStatusAliasPath('deleted', record.subreddit, record.post_id)]),
    ]),
  };
}

function classifyRecords(records: readonly (RedditSubreddit | RedditPost | RedditDeletedRecord)[]): {
  subreddits: RedditSubredditEmitRecord[];
  posts: RedditPostEmitRecord[];
} {
  const subreddits: RedditSubredditEmitRecord[] = [];
  const posts: RedditPostEmitRecord[] = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    if ('_deleted' in record && record._deleted === true) {
      const tombstone = record as RedditDeletedRecord;
      if (tombstone.objectType === 'subreddit') subreddits.push(tombstone);
      if (tombstone.objectType === 'post') posts.push(tombstone);
      continue;
    }

    const candidate = record as Partial<RedditPost> & Partial<RedditSubreddit>;
    if (typeof candidate.post_id === 'string' && typeof candidate.subreddit === 'string') {
      posts.push(record as RedditPostEmitRecord);
      continue;
    }
    if (typeof candidate.name === 'string') {
      subreddits.push(record as RedditSubredditEmitRecord);
    }
  }

  return { subreddits, posts };
}

function recordEnvelope(
  objectType: string,
  objectId: string,
  canonicalPath: string,
  title: string,
  payload: Record<string, unknown>,
  connectionId: string | undefined,
): Record<string, unknown> {
  return {
    provider: REDDIT_PROVIDER_NAME,
    objectType,
    objectId,
    title,
    canonicalPath,
    ...(connectionId ? { connectionId } : {}),
    payload,
  };
}

function mirrorWrite(path: string, content: string, semantics?: { properties: Record<string, string> }): EmitWrite {
  return {
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
    ...(semantics ? { semantics } : {}),
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function staleDeletes(paths: Array<string | null | undefined>) {
  return paths
    .filter((path): path is string => Boolean(path))
    .map((path) => ({ path }));
}

function isDeleted(record: RedditSubredditEmitRecord | RedditPostEmitRecord): record is RedditDeletedRecord {
  return (record as { _deleted?: boolean })._deleted === true;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function accumulate(target: EmitAuxiliaryFilesResult, source: EmitAuxiliaryFilesResult): void {
  target.written += source.written;
  target.deleted += source.deleted;
  target.errors.push(...source.errors);
}
