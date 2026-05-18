import type { IngestResult, VfsLike } from '../files/content-fetcher.js';
import { fetchIssue, isActualIssue } from './fetcher.js';
import { ingestIssueComments } from './comment-mapper.js';
import {
  githubByIdAliasPath,
  githubByTitleAliasPath,
  githubNumberSlug,
  githubRepoIssuesIndexPath,
  githubRepoPullsIndexPath,
} from '../path-mapper.js';
import {
  buildRepoIssuesIndexFile,
  buildRepoPullsIndexFile,
  upsertRecordIndexRow,
  upsertRepoIndexRow,
} from '../index-emitter.js';
import {
  atomicUpsertRecordIndex,
  atomicUpsertRepoIndex,
} from '../atomic-index.js';
import { githubLayoutPromptFile } from '../layout-prompt.js';

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
  title: string | null;
  vfsPath: string;
}

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
    vfsPath: `issues/${githubNumberSlug(issueNumber, mapped.title ?? undefined)}/meta.json`,
    title: mapped.title,
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
  await writeIssueAliases(vfs, owner, repo, number, mapped.title, mapped.content);
  const commentResult = await ingestIssueComments(
    provider,
    owner,
    repo,
    number,
    vfs,
    mapped.title ?? undefined,
  );

  if (metaResult.errors.length > 0) {
    return mergeIngestResults(metaResult, commentResult);
  }

  // Write indexes after the canonical record write resolves so failed writes
  // do not leak into the lightweight directory indexes.
  const updated = mappedMetaField(mapped.content, 'updated_at') || mappedMetaField(mapped.content, 'created_at');

  // Atomic CAS upserts — concurrent issue/PR webhooks otherwise race on the
  // shared `_index.json` files and silently drop rows on the second write
  // (issue #106 / CodeRabbit follow-up).
  const issueIndexResult = await atomicUpsertRecordIndex(
    vfs,
    githubRepoIssuesIndexPath(owner, repo),
    (rows) =>
      upsertRecordIndexRow(rows, {
        id: String(number),
        title: mapped.title ?? '',
        updated,
        number,
        state: mappedMetaField(mapped.content, 'state'),
      }),
    (rows) => buildRepoIssuesIndexFile(owner, repo, rows).content,
  );
  // Re-emit the pulls index under CAS so we never clobber a pull row that
  // was concurrently appended by another ingestion.
  const pullIndexResult = await atomicUpsertRecordIndex(
    vfs,
    githubRepoPullsIndexPath(owner, repo),
    (rows) => rows,
    (rows) => buildRepoPullsIndexFile(owner, repo, rows).content,
  );
  const repoIndexResult = await atomicUpsertRepoIndex(vfs, (rows) =>
    upsertRepoIndexRow(rows, {
      id: `${owner}/${repo}`,
      title: `${owner}/${repo}`,
      updated,
    }),
  );
  const layoutFile = githubLayoutPromptFile();
  const layoutResult = await writeMappedFile(vfs, layoutFile.path, layoutFile.content);

  return mergeIngestResults(metaResult, commentResult, issueIndexResult, pullIndexResult, repoIndexResult, layoutResult);
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

function mappedMetaField(content: string, key: keyof IssueMeta): string {
  const parsed = JSON.parse(content) as IssueMeta;
  const value = parsed[key];
  return typeof value === 'string' ? value : '';
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

interface GitHubIndexRow {
  file: string;
  title: string;
}

async function writeIssueAliases(
  vfs: VfsLike,
  owner: string,
  repo: string,
  number: number,
  title: string | null,
  content: string,
): Promise<void> {
  // duplicate write — the VFS interface only supports file writes, so aliases store the canonical bytes verbatim.
  if (!owner || !repo) {
    return;
  }

  const scope = `/github/repos/${encodeURIComponent(owner)}__${encodeURIComponent(repo)}/issues`;
  await writeGitHubIndex(vfs, scope);
  await runVfsWrite(vfs, githubByIdAliasPath(owner, repo, 'issues', number), content);

  if (!title?.trim()) {
    return;
  }

  const baseAliasPath = githubByTitleAliasPath(owner, repo, 'issues', title, number);
  const aliasPath = await resolveAliasPath(
    vfs,
    baseAliasPath,
    githubByTitleAliasPath(owner, repo, 'issues', title, number, true),
    content,
  );
  // TODO(issue #106): remove stale by-title aliases when an issue title changes on re-ingest; this wave only writes the current alias.
  await runVfsWrite(vfs, aliasPath, content);
}

async function writeGitHubIndex(vfs: VfsLike, scope: string): Promise<void> {
  const indexPath = `${scope}/_index.json`;
  const rows = mergeGitHubIndexRows(await readVfsContent(vfs, indexPath), [
    { title: 'by-id', file: 'by-id/' },
    { title: 'by-title', file: 'by-title/' },
  ]);
  await runVfsWrite(vfs, indexPath, `${JSON.stringify({ rows }, null, 2)}\n`);
}

function mergeGitHubIndexRows(existingContent: string | undefined, requiredRows: GitHubIndexRow[]): GitHubIndexRow[] {
  const rows = new Map<string, GitHubIndexRow>();

  for (const row of parseGitHubIndexRows(existingContent)) {
    rows.set(row.file, row);
  }

  for (const row of requiredRows) {
    rows.set(row.file, row);
  }

  return [...rows.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function parseGitHubIndexRows(existingContent: string | undefined): GitHubIndexRow[] {
  if (!existingContent) {
    return [];
  }

  try {
    const parsed = JSON.parse(existingContent) as { rows?: Array<Partial<GitHubIndexRow>> };
    return Array.isArray(parsed.rows)
      ? parsed.rows.filter((row): row is GitHubIndexRow => typeof row?.file === 'string' && typeof row?.title === 'string')
      : [];
  } catch {
    return [];
  }
}

async function resolveAliasPath(
  vfs: VfsLike,
  baseAliasPath: string,
  collisionAliasPath: string,
  content: string,
): Promise<string> {
  const exists = await pathExists(vfs, baseAliasPath);
  if (!exists) {
    return baseAliasPath;
  }

  const existing = await readVfsContent(vfs, baseAliasPath);
  return existing === undefined || existing !== content ? collisionAliasPath : baseAliasPath;
}

async function readVfsContent(vfs: VfsLike, path: string): Promise<string | undefined> {
  if (typeof vfs.readFile === 'function') {
    try {
      const value = await vfs.readFile(path);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  if (typeof vfs.read === 'function') {
    try {
      const value = await vfs.read(path);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  if (typeof vfs.get === 'function') {
    try {
      const value = await vfs.get(path);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
