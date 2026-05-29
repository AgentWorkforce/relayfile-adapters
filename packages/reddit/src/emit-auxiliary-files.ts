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
  normalizeSubreddit,
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
  subreddit?: string;
  post_id?: string;
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
  accumulate(aggregate, await runEmitBatch(client, workspaceId, posts, async (record) =>
    planPostRecord(client, workspaceId, record, postIndex, getSubredditPostIndex, input.connectionId),
  ));

  for (const reconciler of [subredditIndex, postIndex, ...subredditPostIndexes.values()]) {
    const flush = await reconciler.flush();
    aggregate.written += flush.written;
    aggregate.errors.push(...flush.errors);
  }

  return aggregate;

  function getSubredditPostIndex(subreddit: string): IndexFileReconciler<RedditPostIndexRow> {
    const normalizedSubreddit = normalizeSubreddit(subreddit);
    let reconciler = subredditPostIndexes.get(normalizedSubreddit);
    if (!reconciler) {
      reconciler = new IndexFileReconciler<RedditPostIndexRow>({
        client,
        workspaceId,
        path: redditSubredditPostsIndexPath(normalizedSubreddit),
        builder: (rows) => buildRedditSubredditPostsIndexFile(normalizedSubreddit, rows),
      });
      subredditPostIndexes.set(normalizedSubreddit, reconciler);
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
  const subreddit = normalizeSubreddit(isDeleted(record) ? record.id : record.name);
  if (isDeleted(record)) {
    index.remove(subreddit);
    return {
      deletes: staleDeletes([
        redditSubredditPath(subreddit),
        redditSubredditByIdAliasPath(subreddit),
      ]),
    };
  }

  const row = { ...redditSubredditIndexRow(record), id: subreddit };
  index.upsert(row);
  const canonicalPath = redditSubredditPath(subreddit);
  const content = json(recordEnvelope('subreddit', subreddit, canonicalPath, redditSubredditTitle(record), record, connectionId));
  const semantics = {
    properties: {
      provider: REDDIT_PROVIDER_NAME,
      'reddit.object_type': 'subreddit',
      'reddit.subreddit': subreddit,
    },
  };
  return {
    writes: [
      mirrorWrite(canonicalPath, content, semantics),
      mirrorWrite(redditSubredditByIdAliasPath(subreddit), content, semantics),
    ],
  };
}

async function planPostRecord(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  record: RedditPostEmitRecord,
  index: IndexFileReconciler<RedditPostIndexRow>,
  subredditIndex: (subreddit: string) => IndexFileReconciler<RedditPostIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  if (isDeleted(record)) {
    const scoped = await resolveDeletedPostScope(client, workspaceId, record);
    if (!scoped) {
      index.remove(record.id);
      return { deletes: [] };
    }

    const scopedId = `${scoped.subreddit}/${scoped.postId}`;
    const byIdAliasPath = redditPostByIdAliasPath(scoped.subreddit, scoped.postId);
    const canonicalPath = await canonicalPathFromAlias(client, workspaceId, byIdAliasPath);
    index.remove(record.id);
    index.remove(scopedId);
    subredditIndex(scoped.subreddit).remove(record.id);
    subredditIndex(scoped.subreddit).remove(scopedId);
    return {
      deletes: staleDeletes([
        canonicalPath ?? redditPostPath(scoped.subreddit, scoped.postId),
        byIdAliasPath,
        redditPostByStatusAliasPath('active', scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('locked', scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('archived', scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('removed', scoped.subreddit, scoped.postId),
        redditPostByStatusAliasPath('deleted', scoped.subreddit, scoped.postId),
      ]),
    };
  }

  const normalizedSubreddit = normalizeSubreddit(record.subreddit);
  const row = redditPostIndexRow(record);
  index.upsert(row);
  subredditIndex(normalizedSubreddit).upsert(row);

  const canonicalPath = redditPostPath(normalizedSubreddit, record.post_id, redditPostTitle(record));
  const content = json(recordEnvelope('post', record.id, canonicalPath, redditPostTitle(record), record, connectionId));
  const status = (record.status ?? 'active').toLowerCase();
  const semantics = {
    properties: {
      provider: REDDIT_PROVIDER_NAME,
      'reddit.object_type': 'post',
      'reddit.subreddit': normalizedSubreddit,
      'reddit.post_id': record.post_id,
      'reddit.status': status,
    },
  };

  return {
    writes: [
      mirrorWrite(canonicalPath, content, semantics),
      mirrorWrite(redditPostByIdAliasPath(normalizedSubreddit, record.post_id), content, semantics),
      mirrorWrite(redditPostByStatusAliasPath(status, normalizedSubreddit, record.post_id), content, semantics),
    ],
    deletes: staleDeletes([
      ...(status === 'active' ? [] : [redditPostByStatusAliasPath('active', normalizedSubreddit, record.post_id)]),
      ...(status === 'locked' ? [] : [redditPostByStatusAliasPath('locked', normalizedSubreddit, record.post_id)]),
      ...(status === 'archived' ? [] : [redditPostByStatusAliasPath('archived', normalizedSubreddit, record.post_id)]),
      ...(status === 'removed' ? [] : [redditPostByStatusAliasPath('removed', normalizedSubreddit, record.post_id)]),
      ...(status === 'deleted' ? [] : [redditPostByStatusAliasPath('deleted', normalizedSubreddit, record.post_id)]),
    ]),
  };
}

async function resolveDeletedPostScope(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  record: RedditDeletedRecord,
): Promise<{ subreddit: string; postId: string } | undefined> {
  const rawId = record.id.trim();
  if (!rawId) {
    return undefined;
  }

  try {
    return parseRedditPostScopedId(rawId);
  } catch {
    // fall through: some tombstones only carry an unscoped post id.
  }

  if (record.subreddit) {
    return {
      subreddit: normalizeSubreddit(record.subreddit),
      postId: typeof record.post_id === 'string' && record.post_id.trim() ? record.post_id.trim() : rawId,
    };
  }

  if (!client.readFile) {
    return undefined;
  }

  try {
    const read = await client.readFile({ workspaceId, path: redditPostsIndexPath() });
    if (!read?.content) {
      return undefined;
    }
    const parsed = JSON.parse(read.content) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const entry = row as { id?: unknown; subreddit?: unknown };
      if (typeof entry.id !== 'string') continue;

      const id = entry.id.trim();
      if (!id) continue;

      if (id === rawId && typeof entry.subreddit === 'string' && entry.subreddit.trim()) {
        return {
          subreddit: normalizeSubreddit(entry.subreddit),
          postId: rawId,
        };
      }

      if (id === rawId || id.endsWith(`/${rawId}`)) {
        try {
          return parseRedditPostScopedId(id);
        } catch {
          // keep looking through the index for another compatible row.
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
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

async function canonicalPathFromAlias(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aliasPath: string,
): Promise<string | undefined> {
  if (!client.readFile) {
    return undefined;
  }
  try {
    const read = await client.readFile({ workspaceId, path: aliasPath });
    if (!read?.content) {
      return undefined;
    }
    const parsed = JSON.parse(read.content) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    const canonicalPath = (parsed as { canonicalPath?: unknown }).canonicalPath;
    return typeof canonicalPath === 'string' && canonicalPath.length > 0
      ? canonicalPath
      : undefined;
  } catch {
    return undefined;
  }
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
