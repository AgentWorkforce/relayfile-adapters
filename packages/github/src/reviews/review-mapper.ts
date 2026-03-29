import { fetchReviews, type RawGitHubReview } from './fetcher.js';
import type { JsonObject, JsonValue } from '../types.js';
import type { IngestResult } from '../webhook/event-map.js';

type Awaitable<T> = Promise<T> | T;

type VfsWriteMethod = (path: string, content: string) => Awaitable<void>;

export interface ReviewVfs {
  put?: VfsWriteMethod;
  write?: VfsWriteMethod;
  writeFile?: VfsWriteMethod;
}

export interface ReviewAuthor {
  login: string;
  avatarUrl: string;
}

export interface ReviewDocument {
  id: number;
  state: string;
  body: string;
  author: ReviewAuthor;
  submitted_at: string;
  commit_id: string;
  htmlUrl: string;
}

export interface MappedReviewFile {
  vfsPath: string;
  content: string;
}

export function mapReview(
  review: RawGitHubReview,
  owner: string,
  repo: string,
  prNumber: number,
): MappedReviewFile {
  const id = readReviewId(review);
  const user = readObject(review, 'user');
  const document: ReviewDocument = {
    id,
    state: readString(review, 'state') ?? '',
    body: readString(review, 'body') ?? '',
    author: {
      login: readString(user, 'login') ?? '',
      avatarUrl: readString(user, 'avatar_url') ?? '',
    },
    submitted_at: readString(review, 'submitted_at') ?? '',
    commit_id: readString(review, 'commit_id') ?? '',
    htmlUrl:
      readString(review, 'html_url') ??
      `https://github.com/${owner}/${repo}/pull/${prNumber}#pullrequestreview-${id}`,
  };

  return {
    vfsPath: `reviews/${id}.json`,
    content: JSON.stringify(document, null, 2),
  };
}

export async function ingestReviews(
  provider: Parameters<typeof fetchReviews>[0],
  owner: string,
  repo: string,
  number: number,
  vfs: ReviewVfs,
): Promise<IngestResult> {
  const reviews = await fetchReviews(provider, owner, repo, number);
  const paths: string[] = [];
  const errors: IngestResult['errors'] = [];

  for (const review of reviews) {
    let mapped: MappedReviewFile;

    try {
      mapped = mapReview(review, owner, repo, number);
    } catch (error) {
      errors.push({
        path: buildFallbackPath(review),
        error: formatError(error),
      });
      continue;
    }

    try {
      await writeToVfs(vfs, mapped.vfsPath, mapped.content);
      paths.push(mapped.vfsPath);
    } catch (error) {
      errors.push({
        path: mapped.vfsPath,
        error: formatError(error),
      });
    }
  }

  return {
    filesWritten: paths.length,
    filesUpdated: 0,
    filesDeleted: 0,
    paths,
    errors,
  };
}

function readReviewId(review: JsonObject): number {
  const value = review.id;

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('GitHub review payload is missing a valid numeric id');
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

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function writeToVfs(vfs: ReviewVfs, path: string, content: string): Promise<void> {
  const writer = vfs.writeFile ?? vfs.write ?? vfs.put;

  if (!writer) {
    throw new Error('VFS does not expose writeFile(path, content), write(path, content), or put(path, content)');
  }

  await writer(path, content);
}

function buildFallbackPath(review: JsonObject): string {
  const id = review.id;
  return typeof id === 'number' && Number.isInteger(id) && id >= 0
    ? `reviews/${id}.json`
    : 'reviews/unknown.json';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
