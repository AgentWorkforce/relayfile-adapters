import { withProxyRetry } from '@relayfile/adapter-core/http';
import { GITHUB_API_BASE_URL } from '../config.js';
import { Buffer } from 'node:buffer';

import type { IngestResult, VfsLike } from '../files/content-fetcher.js';
import { githubByIdAliasPath, githubNumberedByTitleAliasPath } from '../path-mapper.js';
import type { GitHubRequestProvider, JsonValue, ProxyResponse } from '../types.js';
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
import { githubRepoIssuesIndexPath, githubRepoPullsIndexPath } from '../path-mapper.js';
import { buildVFSPath, mapPRFiles, type PullRequestFileMapping } from './file-mapper.js';
import { parsePullRequest, type PullRequestMetadata } from './parser.js';

const GITHUB_API_VERSION = '2022-11-28';

type ConnectionAwareProvider = GitHubRequestProvider & {
  connectionId?: string;
  defaultConnectionId?: string;
  resolveConnectionId?: () => Promise<string> | string;
  getConnectionId?: () => Promise<string> | string;
};

export interface DiffWriteResult {
  path: string;
  size: number;
}

export async function fetchAndWriteDiff(
  provider: GitHubRequestProvider,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
  title?: string,
): Promise<DiffWriteResult> {
  const trimmedOwner = requireNonEmpty(owner, 'owner');
  const trimmedRepo = requireNonEmpty(repo, 'repo');
  const prNumber = requirePositiveInteger(number, 'number');
  const connectionId = await resolveConnectionId(provider);

  const response = await withProxyRetry(provider).proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/pulls/${prNumber}`,
    connectionId,
    headers: {
      Accept: 'application/vnd.github.diff',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
  });

  assertSuccessfulResponse(
    response,
    `Failed to fetch pull request diff for ${trimmedOwner}/${trimmedRepo}#${prNumber}`,
  );

  const diff = parseDiffPayload(response.data);
  const path = buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'diff.patch', title);

  await runVfsWrite(vfs, path, diff);

  return {
    path,
    size: Buffer.byteLength(diff, 'utf8'),
  };
}

export async function ingestPullRequest(
  provider: GitHubRequestProvider,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
): Promise<IngestResult> {
  const trimmedOwner = requireNonEmpty(owner, 'owner');
  const trimmedRepo = requireNonEmpty(repo, 'repo');
  const prNumber = requirePositiveInteger(number, 'number');
  const result = createEmptyIngestResult();
  let metaPath = buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'meta.json');

  let parsedPullRequest: PullRequestMetadata | null = null;
  try {
    parsedPullRequest = await parsePullRequest(provider, trimmedOwner, trimmedRepo, prNumber);
  } catch (error) {
    result.errors.push({
      path: buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'meta.json'),
      error: formatError(error),
    });
  }

  if (parsedPullRequest) {
    metaPath = buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'meta.json', parsedPullRequest.title);
    const metaContent = serializeJson(parsedPullRequest);
    const metaWritten = await writeTrackedFile(
      vfs,
      metaPath,
      metaContent,
      result,
    );
    // Skip alias duplicates when meta.json failed to write — pointing aliases
    // at a missing canonical file would create dangling references.
    if (metaWritten) {
      await writePullRequestAliases(vfs, trimmedOwner, trimmedRepo, prNumber, parsedPullRequest.title, metaContent);
    }
  }

  let mappedFiles: PullRequestFileMapping[] = [];
  try {
    mappedFiles = await mapPRFiles(provider, trimmedOwner, trimmedRepo, prNumber, parsedPullRequest?.title);
  } catch (error) {
    result.errors.push({
      path: buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'files', parsedPullRequest?.title),
      error: formatError(error),
    });
  }

  for (const mappedFile of mappedFiles) {
    await writeTrackedFile(vfs, mappedFile.vfsPath, serializeMappedFile(mappedFile), result);
  }

  const diffPath = buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'diff.patch', parsedPullRequest?.title);
  const diffExisted = await pathExists(vfs, diffPath);

  try {
    const diffResult = await fetchAndWriteDiff(
      provider,
      trimmedOwner,
      trimmedRepo,
      prNumber,
      vfs,
      parsedPullRequest?.title,
    );
    result.paths.push(diffResult.path);

    if (diffExisted) {
      result.filesUpdated += 1;
    } else {
      result.filesWritten += 1;
    }
  } catch (error) {
    result.errors.push({
      path: diffPath,
      error: formatError(error),
    });
  }

  if (parsedPullRequest && !hasPathError(result, metaPath) && result.paths.includes(metaPath)) {
    // Write indexes after the canonical record write resolves so failed writes
    // do not leak into the lightweight directory indexes.
    const updated = parsedPullRequest.updatedAt || parsedPullRequest.createdAt || '';
    const layoutFile = githubLayoutPromptFile();

    // Atomic CAS upserts — concurrent ingestions for the same repo can read
    // the same baseline rows otherwise and silently drop one another's
    // additions on the second write (issue #106 / CodeRabbit follow-up).
    const pullIndexResult = await atomicUpsertRecordIndex(
      vfs,
      githubRepoPullsIndexPath(trimmedOwner, trimmedRepo),
      (rows) =>
        upsertRecordIndexRow(rows, {
          id: String(parsedPullRequest.number),
          title: parsedPullRequest.title ?? '',
          updated,
          number: parsedPullRequest.number,
          state: parsedPullRequest.state || '',
        }),
      (rows) => buildRepoPullsIndexFile(trimmedOwner, trimmedRepo, rows).content,
    );
    const issueIndexResult = await atomicUpsertRecordIndex(
      vfs,
      githubRepoIssuesIndexPath(trimmedOwner, trimmedRepo),
      (rows) => rows,
      (rows) => buildRepoIssuesIndexFile(trimmedOwner, trimmedRepo, rows).content,
    );
    const repoIndexResult = await atomicUpsertRepoIndex(vfs, (rows) =>
      upsertRepoIndexRow(rows, {
        id: `${trimmedOwner}/${trimmedRepo}`,
        title: `${trimmedOwner}/${trimmedRepo}`,
        updated,
      }),
    );

    mergeIntoResult(result, pullIndexResult);
    mergeIntoResult(result, issueIndexResult);
    mergeIntoResult(result, repoIndexResult);
    await writeTrackedFile(vfs, layoutFile.path, layoutFile.content, result);
  }

  return result;
}

function mergeIntoResult(result: IngestResult, partial: IngestResult): void {
  result.filesWritten += partial.filesWritten;
  result.filesUpdated += partial.filesUpdated;
  result.filesDeleted += partial.filesDeleted;
  result.paths.push(...partial.paths);
  result.errors.push(...partial.errors);
}

function assertSuccessfulResponse(response: ProxyResponse, context: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  throw new Error(formatProviderError(context, response));
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

function formatProviderError(context: string, response: ProxyResponse): string {
  const statusText = `${response.status}`;
  const message = readProviderMessage(response.data);
  return message ? `${context}: ${statusText} ${message}` : `${context}: ${statusText}`;
}

function parseDiffPayload(data: JsonValue | null): string {
  if (typeof data !== 'string') {
    throw new Error('GitHub pull request diff response must be a raw diff string');
  }

  return data;
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

function readProviderMessage(data: JsonValue | null): string | null {
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    return null;
  }

  const value = data.message;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return trimmed;
}

function requirePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return value;
}

async function resolveConnectionId(provider: GitHubRequestProvider): Promise<string> {
  const connectionAwareProvider = provider as ConnectionAwareProvider;
  const candidateConnectionId =
    connectionAwareProvider.connectionId?.trim() ??
    connectionAwareProvider.defaultConnectionId?.trim();

  if (candidateConnectionId) {
    return candidateConnectionId;
  }

  const resolver =
    connectionAwareProvider.resolveConnectionId ??
    connectionAwareProvider.getConnectionId;

  if (resolver) {
    const resolvedConnectionId = (await resolver.call(connectionAwareProvider)).trim();
    if (resolvedConnectionId) {
      return resolvedConnectionId;
    }
  }

  throw new Error(
    'Missing GitHub connection id. Provide provider.connectionId, provider.defaultConnectionId, provider.resolveConnectionId(), or provider.getConnectionId().',
  );
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

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function serializeMappedFile(mappedFile: PullRequestFileMapping): string {
  return `${JSON.stringify(
    {
      filename: mappedFile.githubPath,
      path: mappedFile.githubPath,
      status: mappedFile.status,
      additions: mappedFile.additions,
      deletions: mappedFile.deletions,
    },
    null,
    2,
  )}\n`;
}

function hasPathError(result: IngestResult, path: string): boolean {
  return result.errors.some((error) => error.path === path);
}

async function writeTrackedFile(
  vfs: VfsLike,
  path: string,
  content: string,
  result: IngestResult,
): Promise<boolean> {
  try {
    const existed = await pathExists(vfs, path);
    await runVfsWrite(vfs, path, content);
    result.paths.push(path);

    if (existed) {
      result.filesUpdated += 1;
    } else {
      result.filesWritten += 1;
    }
    return true;
  } catch (error) {
    result.errors.push({
      path,
      error: formatError(error),
    });
    return false;
  }
}

interface GitHubIndexRow {
  file: string;
  title: string;
}

async function writePullRequestAliases(
  vfs: VfsLike,
  owner: string,
  repo: string,
  number: number,
  title: string,
  content: string,
): Promise<void> {
  // duplicate write — the VFS interface only supports file writes, so aliases store the canonical bytes verbatim.
  if (!owner || !repo) {
    return;
  }

  const scope = `/github/repos/${encodeURIComponent(owner)}__${encodeURIComponent(repo)}/pulls`;
  await writeGitHubIndex(vfs, scope);
  await runVfsWrite(vfs, githubByIdAliasPath(owner, repo, 'pulls', number), content);

  if (!title.trim()) {
    return;
  }

  const baseAliasPath = githubNumberedByTitleAliasPath(owner, repo, 'pulls', title, number);
  // TODO(issue #106): remove stale by-title aliases when a pull request title changes on re-ingest; this wave only writes the current alias.
  await runVfsWrite(vfs, baseAliasPath, content);
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
