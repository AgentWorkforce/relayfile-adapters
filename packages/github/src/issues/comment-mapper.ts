import { fetchIssueComments } from './fetcher.js';

import type { IngestResult, VfsLike } from '../files/content-fetcher.js';
import type { GitHubRequestProvider, JsonObject, JsonValue } from '../types.js';

interface IssueCommentAuthor {
  login: string | null;
  avatarUrl: string | null;
}

interface IssueCommentReactions {
  total_count: number;
  '+1': number;
  '-1': number;
  laugh: number;
  confused: number;
  eyes: number;
  heart: number;
  hooray: number;
  rocket: number;
}

interface IssueCommentDocument {
  id: number;
  body: string | null;
  author: IssueCommentAuthor;
  created_at: string | null;
  updated_at: string | null;
  reactions: IssueCommentReactions;
}

interface IssueCommentMapping {
  vfsPath: string;
  content: string;
}

const DEFAULT_REACTIONS: IssueCommentReactions = {
  total_count: 0,
  '+1': 0,
  '-1': 0,
  laugh: 0,
  confused: 0,
  eyes: 0,
  heart: 0,
  hooray: 0,
  rocket: 0,
};

export function mapIssueComment(
  comment: JsonObject,
  owner: string,
  repo: string,
  issueNumber: number,
): IssueCommentMapping {
  const commentId = readPositiveInteger(comment, 'id');
  const author = asRecord(comment.user);
  const mapped: IssueCommentDocument = {
    id: commentId,
    body: readString(comment, 'body'),
    author: {
      login: readString(author, 'login'),
      avatarUrl: readString(author, 'avatar_url'),
    },
    created_at: readString(comment, 'created_at'),
    updated_at: readString(comment, 'updated_at'),
    reactions: readReactions(comment.reactions),
  };

  void owner;
  void repo;

  return {
    vfsPath: `issues/${issueNumber}/comments/${commentId}.json`,
    content: `${JSON.stringify(mapped, null, 2)}\n`,
  };
}

export async function ingestIssueComments(
  provider: GitHubRequestProvider,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
): Promise<IngestResult> {
  const comments = await fetchIssueComments(provider, owner, repo, number);
  const result = createEmptyIngestResult();

  for (const comment of comments) {
    let mapped: IssueCommentMapping;

    try {
      mapped = mapIssueComment(comment, owner, repo, number);
    } catch (error) {
      result.errors.push({
        path: buildFallbackPath(comment, number),
        error: formatError(error),
      });
      continue;
    }

    const absolutePath = buildAbsoluteVfsPath(owner, repo, mapped.vfsPath);

    try {
      const existed = await pathExists(vfs, absolutePath);
      await runVfsWrite(vfs, absolutePath, mapped.content);
      result.paths.push(absolutePath);

      if (existed) {
        result.filesUpdated += 1;
      } else {
        result.filesWritten += 1;
      }
    } catch (error) {
      result.errors.push({
        path: absolutePath,
        error: formatError(error),
      });
    }
  }

  return result;
}

function asRecord(value: JsonValue | undefined): JsonObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function buildAbsoluteVfsPath(owner: string, repo: string, relativePath: string): string {
  return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${relativePath}`;
}

function buildFallbackPath(comment: JsonObject, issueNumber: number): string {
  const commentId = comment.id;
  return typeof commentId === 'number' && Number.isInteger(commentId) && commentId > 0
    ? `issues/${issueNumber}/comments/${commentId}.json`
    : `issues/${issueNumber}/comments/unknown.json`;
}

function createEmptyIngestResult(): IngestResult {
  return {
    filesDeleted: 0,
    filesUpdated: 0,
    filesWritten: 0,
    paths: [],
    errors: [],
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(vfs: VfsLike, path: string): Promise<boolean | undefined> {
  if (typeof vfs.exists === 'function') {
    return Boolean(await vfs.exists(path));
  }
  if (typeof vfs.has === 'function') {
    return Boolean(await vfs.has(path));
  }
  if (typeof vfs.stat === 'function') {
    try {
      const value = await vfs.stat(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }
  if (typeof vfs.readFile === 'function') {
    try {
      const value = await vfs.readFile(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }
  if (typeof vfs.read === 'function') {
    try {
      const value = await vfs.read(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }
  if (typeof vfs.get === 'function') {
    try {
      const value = await vfs.get(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }

  return undefined;
}

function readPositiveInteger(record: JsonObject, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`GitHub issue comment ${key} must be a positive integer`);
  }

  return value;
}

function readReactions(value: JsonValue | undefined): IssueCommentReactions {
  const reactions = asRecord(value);

  return {
    total_count: readReactionCount(reactions, 'total_count'),
    '+1': readReactionCount(reactions, '+1'),
    '-1': readReactionCount(reactions, '-1'),
    laugh: readReactionCount(reactions, 'laugh'),
    confused: readReactionCount(reactions, 'confused'),
    eyes: readReactionCount(reactions, 'eyes'),
    heart: readReactionCount(reactions, 'heart'),
    hooray: readReactionCount(reactions, 'hooray'),
    rocket: readReactionCount(reactions, 'rocket'),
  };
}

function readReactionCount(record: JsonObject, key: keyof IssueCommentReactions): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_REACTIONS[key];
}

function readString(record: JsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

async function runVfsWrite(vfs: VfsLike, path: string, content: string): Promise<void> {
  const writer =
    vfs.writeFile ??
    vfs.write ??
    vfs.put ??
    vfs.set ??
    vfs.upsert;

  if (!writer) {
    throw new Error(
      'VFS object must expose one of writeFile(path, content), write(path, content), put(path, content), set(path, content), or upsert(path, content).',
    );
  }

  await writer.call(vfs, path, content);
}
