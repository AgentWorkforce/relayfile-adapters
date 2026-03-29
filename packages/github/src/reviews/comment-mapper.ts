import { fetchReviewComments, type RawGitHubReviewComment } from './fetcher.js';
import type { JsonObject, JsonValue } from '../types.js';
import type { IngestResult } from '../webhook/event-map.js';

type Awaitable<T> = Promise<T> | T;

type VfsWriteResult =
  | void
  | {
      created?: boolean;
      updated?: boolean;
      status?: 'created' | 'pending' | 'queued' | 'updated';
    };

type VfsWriteMethod = (path: string, content: string) => Awaitable<VfsWriteResult>;

export interface ReviewCommentVfs {
  put?: VfsWriteMethod;
  write?: VfsWriteMethod;
  writeFile?: VfsWriteMethod;
}

export interface ReviewCommentDocument {
  id: number;
  body: string;
  path: string;
  line: number | null;
  side: string | null;
  original_line: number | null;
  author: {
    login: string;
  };
  created_at: string;
  updated_at: string;
  in_reply_to_id: number | null;
  review_id: number | null;
  diff_hunk: string;
}

export interface MappedReviewCommentFile {
  vfsPath: string;
  content: string;
}

export function mapReviewComment(
  comment: RawGitHubReviewComment,
  owner: string,
  repo: string,
  prNumber: number,
): MappedReviewCommentFile {
  const id = readCommentId(comment);
  const user = readObject(comment, 'user');
  const document: ReviewCommentDocument = {
    id,
    body: readString(comment, 'body') ?? '',
    path: readString(comment, 'path') ?? '',
    line: readNullableInteger(comment, 'line'),
    side: readNullableString(comment, 'side'),
    original_line: readNullableInteger(comment, 'original_line'),
    author: {
      login: readString(user, 'login') ?? '',
    },
    created_at: readString(comment, 'created_at') ?? '',
    updated_at: readString(comment, 'updated_at') ?? '',
    in_reply_to_id: readNullableInteger(comment, 'in_reply_to_id'),
    review_id:
      readNullableInteger(comment, 'review_id') ??
      readNullableInteger(comment, 'pull_request_review_id'),
    diff_hunk: readString(comment, 'diff_hunk') ?? '',
  };

  void owner;
  void repo;
  void prNumber;

  return {
    vfsPath: `comments/${id}.json`,
    content: JSON.stringify(document, null, 2),
  };
}

export async function ingestReviewComments(
  provider: Parameters<typeof fetchReviewComments>[0],
  owner: string,
  repo: string,
  number: number,
  vfs: ReviewCommentVfs,
): Promise<IngestResult> {
  const result: IngestResult = {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };

  const comments = await fetchReviewComments(provider, owner, repo, number);
  const writer = resolveVfsWriter(vfs);

  for (const comment of comments) {
    let mapped: MappedReviewCommentFile;

    try {
      mapped = mapReviewComment(comment, owner, repo, number);
    } catch (error) {
      result.errors.push({
        path: buildFallbackPath(comment),
        error: formatError(error),
      });
      continue;
    }

    try {
      const writeResult = await writer(mapped.vfsPath, mapped.content);
      result.paths.push(mapped.vfsPath);
      applyWriteCounts(result, writeResult);
    } catch (error) {
      result.errors.push({
        path: mapped.vfsPath,
        error: formatError(error),
      });
    }
  }

  return result;
}

function readCommentId(comment: JsonObject): number {
  const value = comment.id;

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('GitHub review comment payload is missing a valid numeric id');
  }

  return value;
}

function readObject(source: JsonObject, key: string): JsonObject | undefined {
  const value = source[key];
  return isJsonObject(value) ? value : undefined;
}

function readString(source: JsonObject | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(source: JsonObject | undefined, key: string): string | null {
  const value = source?.[key];
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'string' ? value : null;
}

function readNullableInteger(source: JsonObject | undefined, key: string): number | null {
  const value = source?.[key];
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveVfsWriter(
  vfs: ReviewCommentVfs,
): (path: string, content: string) => Promise<VfsWriteResult> {
  const writer = vfs.writeFile ?? vfs.write ?? vfs.put;

  if (!writer) {
    throw new Error(
      'VFS does not expose writeFile(path, content), write(path, content), or put(path, content)',
    );
  }

  return async (path: string, content: string) => writer.call(vfs, path, content);
}

function applyWriteCounts(result: IngestResult, writeResult: VfsWriteResult): void {
  if (isVfsWriteState(writeResult) && (writeResult.created || writeResult.status === 'created')) {
    result.filesWritten += 1;
    return;
  }

  if (isVfsWriteState(writeResult) && (writeResult.updated || writeResult.status === 'updated')) {
    result.filesUpdated += 1;
    return;
  }

  result.filesWritten += 1;
}

function isVfsWriteState(
  value: VfsWriteResult,
): value is Exclude<VfsWriteResult, void> {
  return typeof value === 'object' && value !== null;
}

function buildFallbackPath(comment: JsonObject): string {
  const id = comment.id;
  return typeof id === 'number' && Number.isInteger(id) && id >= 0
    ? `comments/${id}.json`
    : 'comments/unknown.json';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
