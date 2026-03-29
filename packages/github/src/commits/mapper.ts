import {
  fetchCommitDetail,
  fetchPRCommits,
  type GitHubCommitDetail,
  type GitHubPullRequestCommit,
} from './fetcher.js';
import type { JsonObject, JsonValue } from '../types.js';

type Awaitable<T> = Promise<T> | T;

type CommitPersonRecord = JsonObject & {
  date?: string;
  email?: string;
};

type CommitFileRecord = JsonObject & {
  additions?: number;
  changes?: number;
  deletions?: number;
  filename?: string;
  previous_filename?: string;
  previousFilename?: string;
  status?: string;
};

type CommitStatsRecord = JsonObject & {
  additions?: number;
  deletions?: number;
  total?: number;
};

type VfsWriteMethod = (path: string, content: string) => Awaitable<void>;

export interface CommitVfs {
  put?: VfsWriteMethod;
  set?: VfsWriteMethod;
  upsert?: VfsWriteMethod;
  write?: VfsWriteMethod;
  writeFile?: VfsWriteMethod;
}

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface CommitActor {
  login: string;
  email: string;
  date: string;
}

export interface CommitStats {
  additions: number;
  deletions: number;
  total: number;
}

export interface CommitFileChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  previousPath?: string;
}

export interface CommitDocument {
  sha: string;
  message: string;
  author: CommitActor;
  committer: CommitActor;
  parents: string[];
  stats: CommitStats;
  filesChanged: CommitFileChange[];
}

export interface CommitVfsFile {
  vfsPath: string;
  content: string;
}

export function mapCommitToVFS(
  commit: GitHubPullRequestCommit | GitHubCommitDetail,
  owner: string,
  repo: string,
  prNumber: number,
): CommitVfsFile {
  void owner;
  void repo;

  const sha = readString(commit, 'sha');
  if (!sha) {
    throw new Error('GitHub commit payload is missing sha');
  }

  const nestedCommit = readObject(commit, 'commit');
  if (!nestedCommit) {
    throw new Error(`GitHub commit payload ${sha} is missing commit metadata`);
  }

  const authorProfile = readObject(commit, 'author');
  const authorCommitRecord = readObject(nestedCommit, 'author');
  const committerProfile = readObject(commit, 'committer');
  const committerCommitRecord = readObject(nestedCommit, 'committer');
  const statsRecord = readObject(commit, 'stats') as CommitStatsRecord | undefined;
  const filesChanged = readArray(commit, 'files')
    .map((file) => mapCommitFile(file))
    .filter((file): file is CommitFileChange => file !== null);

  const document: CommitDocument = {
    sha,
    message: readString(nestedCommit, 'message') ?? '',
    author: mapActor(authorProfile, authorCommitRecord),
    committer: mapActor(committerProfile, committerCommitRecord),
    parents: readArray(commit, 'parents')
      .map((parent) => readString(parent, 'sha'))
      .filter((parentSha): parentSha is string => Boolean(parentSha)),
    stats: {
      additions: readNumber(statsRecord, 'additions') ?? 0,
      deletions: readNumber(statsRecord, 'deletions') ?? 0,
      total: readNumber(statsRecord, 'total') ?? 0,
    },
    filesChanged,
  };

  return {
    vfsPath: buildCommitPath(prNumber, sha),
    content: JSON.stringify(document, null, 2),
  };
}

export async function ingestCommits(
  provider: Parameters<typeof fetchPRCommits>[0],
  owner: string,
  repo: string,
  number: number,
  vfs: CommitVfs,
): Promise<IngestResult> {
  const commits = await fetchPRCommits(provider, owner, repo, number);
  const paths: string[] = [];
  const errors: IngestResult['errors'] = [];

  for (const summary of commits) {
    const sha = readString(summary, 'sha') ?? 'unknown';
    const fallbackPath = buildCommitPath(number, sha);

    try {
      const detail = await fetchCommitDetail(provider, owner, repo, sha);
      const mapped = mapCommitToVFS(detail, owner, repo, number);
      await writeToVfs(vfs, mapped.vfsPath, mapped.content);
      paths.push(mapped.vfsPath);
    } catch (error) {
      errors.push({
        path: fallbackPath,
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

function buildCommitPath(prNumber: number, sha: string): string {
  return `/pulls/${encodeURIComponent(String(prNumber))}/commits/${encodeURIComponent(sha)}.json`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonObject(value: JsonValue | undefined | null): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapActor(
  profile: JsonObject | undefined,
  commitRecord: JsonObject | undefined,
): CommitActor {
  const typedCommitRecord = commitRecord as CommitPersonRecord | undefined;

  return {
    login: readString(profile, 'login') ?? '',
    email: readString(typedCommitRecord, 'email') ?? '',
    date: readString(typedCommitRecord, 'date') ?? '',
  };
}

function mapCommitFile(file: JsonObject): CommitFileChange | null {
  const typedFile = file as CommitFileRecord;
  const path = readString(typedFile, 'filename');

  if (!path) {
    return null;
  }

  const previousPath =
    readString(typedFile, 'previous_filename') ?? readString(typedFile, 'previousFilename');

  return {
    path,
    status: readString(typedFile, 'status') ?? '',
    additions: readNumber(typedFile, 'additions') ?? 0,
    deletions: readNumber(typedFile, 'deletions') ?? 0,
    changes: readNumber(typedFile, 'changes') ?? 0,
    ...(previousPath ? { previousPath } : {}),
  };
}

function readArray(source: JsonObject | undefined, key: string): JsonObject[] {
  const value = source?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is JsonObject => isJsonObject(entry));
}

function readNumber(source: JsonObject | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readObject(source: JsonObject | undefined, key: string): JsonObject | undefined {
  const value = source?.[key];
  return isJsonObject(value) ? value : undefined;
}

function readString(source: JsonObject | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' ? value : undefined;
}

async function writeToVfs(vfs: CommitVfs, path: string, content: string): Promise<void> {
  const writer = vfs.writeFile ?? vfs.write ?? vfs.put ?? vfs.set ?? vfs.upsert;

  if (!writer) {
    throw new Error(
      'VFS does not expose writeFile(path, content), write(path, content), put(path, content), set(path, content), or upsert(path, content)',
    );
  }

  await writer(path, content);
}
