import type { IngestResult, VfsLike } from '../files/content-fetcher.js';
import { fetchIssue, isActualIssue } from './fetcher.js';

import type { GitHubRequestProvider, JsonObject, JsonValue } from '../types.js';

interface IssueMeta {
  assignees: string[];
  author: {
    avatarUrl: string | null;
    login: string | null;
  };
  body: string | null;
  closed_at: string | null;
  created_at: string | null;
  html_url: string;
  labels: string[];
  milestone: string | null;
  number: number;
  state: string | null;
  title: string | null;
  updated_at: string | null;
}

interface IssueMapping {
  content: string;
  vfsPath: string;
}

type IssueCommentIngestor = (
  provider: unknown,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
) => Promise<IngestResult>;

export function mapIssue(issue: JsonObject, owner: string, repo: string): IssueMapping {
  const issueNumber = readPositiveInteger(issue, 'number');
  const author = asRecord(issue.user);
  const mapped: IssueMeta = {
    assignees: readLogins(issue.assignees),
    author: {
      avatarUrl: readString(author, 'avatar_url'),
      login: readString(author, 'login'),
    },
    body: readString(issue, 'body'),
    closed_at: readString(issue, 'closed_at'),
    created_at: readString(issue, 'created_at'),
    html_url: readString(issue, 'html_url') ?? buildIssueHtmlUrl(owner, repo, issueNumber),
    labels: readLabelNames(issue.labels),
    milestone: readString(asRecord(issue.milestone), 'title'),
    number: issueNumber,
    state: readString(issue, 'state'),
    title: readString(issue, 'title'),
    updated_at: readString(issue, 'updated_at'),
  };

  return {
    vfsPath: `issues/${issueNumber}/meta.json`,
    content: `${JSON.stringify(mapped, null, 2)}\n`,
  };
}

export async function ingestIssue(
  provider: GitHubRequestProvider,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
): Promise<IngestResult> {
  const issue = await fetchIssue(provider, owner, repo, number);
  if (!isActualIssue(issue)) {
    throw new Error(
      `Expected ${owner}/${repo}#${number} to be an issue, but GitHub returned a pull request`,
    );
  }

  const mapped = mapIssue(issue, owner, repo);
  const metaResult = await writeMappedFile(
    vfs,
    buildAbsoluteVfsPath(owner, repo, mapped.vfsPath),
    mapped.content,
  );
  const commentResult = await resolveIssueCommentIngestor()(provider, owner, repo, number, vfs);

  return mergeIngestResults(metaResult, commentResult);
}

function asRecord(value: JsonValue | undefined): JsonObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function buildAbsoluteVfsPath(owner: string, repo: string, relativePath: string): string {
  return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${relativePath}`;
}

function buildIssueHtmlUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`;
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

function mergeIngestResults(...results: IngestResult[]): IngestResult {
  return results.reduce<IngestResult>((combined, result) => {
    combined.filesWritten += result.filesWritten;
    combined.filesUpdated += result.filesUpdated;
    combined.filesDeleted += result.filesDeleted;
    combined.paths.push(...result.paths);
    combined.errors.push(...result.errors);
    return combined;
  }, createEmptyIngestResult());
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

function readLabelNames(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }

    const label = asRecord(entry);
    const name = readString(label, 'name');
    return name ? [name] : [];
  });
}

function readLogins(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const assignee = asRecord(entry);
    const login = readString(assignee, 'login');
    return login ? [login] : [];
  });
}

function readPositiveInteger(record: JsonObject, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`GitHub issue ${key} must be a positive integer`);
  }

  return value;
}

function readString(record: JsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function resolveIssueCommentIngestor(): IssueCommentIngestor {
  const loader = new Function(
    'return import("./comment-mapper.js").then((module) => module.ingestIssueComments);',
  ) as () => Promise<unknown>;

  return async (provider, owner, repo, number, vfs) => {
    const loaded = await loader();
    if (typeof loaded !== 'function') {
      throw new Error(
        'Issue comment mapper must export ingestIssueComments(provider, owner, repo, number, vfs)',
      );
    }

    return loaded(provider, owner, repo, number, vfs) as Promise<IngestResult>;
  };
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

async function writeMappedFile(vfs: VfsLike, path: string, content: string): Promise<IngestResult> {
  const result = createEmptyIngestResult();

  try {
    const existed = await pathExists(vfs, path);
    await runVfsWrite(vfs, path, content);
    result.paths.push(path);

    if (existed) {
      result.filesUpdated += 1;
    } else {
      result.filesWritten += 1;
    }
  } catch (error) {
    result.errors.push({
      path,
      error: error instanceof Error ? error.message : 'Unknown VFS write failure',
    });
  }

  return result;
}
