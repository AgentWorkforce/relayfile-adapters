import { Buffer } from 'node:buffer';

import type { IngestResult, VfsLike } from '../files/content-fetcher.js';
import type { GitHubProxyProvider, JsonValue, ProxyResponse } from '../types.js';
import { buildVFSPath, mapPRFiles, type PullRequestFileMapping } from './file-mapper.js';
import { parsePullRequest, type PullRequestMetadata } from './parser.js';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

type ConnectionAwareProvider = GitHubProxyProvider & {
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
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
): Promise<DiffWriteResult> {
  const trimmedOwner = requireNonEmpty(owner, 'owner');
  const trimmedRepo = requireNonEmpty(repo, 'repo');
  const prNumber = requirePositiveInteger(number, 'number');
  const connectionId = await resolveConnectionId(provider);

  const response = await provider.proxy({
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
  const path = buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'diff.patch');

  await runVfsWrite(vfs, path, diff);

  return {
    path,
    size: Buffer.byteLength(diff, 'utf8'),
  };
}

export async function ingestPullRequest(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
): Promise<IngestResult> {
  const trimmedOwner = requireNonEmpty(owner, 'owner');
  const trimmedRepo = requireNonEmpty(repo, 'repo');
  const prNumber = requirePositiveInteger(number, 'number');
  const result = createEmptyIngestResult();

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
    await writeTrackedFile(
      vfs,
      buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'meta.json'),
      serializeJson(parsedPullRequest),
      result,
    );
  }

  let mappedFiles: PullRequestFileMapping[] = [];
  try {
    mappedFiles = await mapPRFiles(provider, trimmedOwner, trimmedRepo, prNumber);
  } catch (error) {
    result.errors.push({
      path: buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'files'),
      error: formatError(error),
    });
  }

  for (const mappedFile of mappedFiles) {
    await writeTrackedFile(vfs, mappedFile.vfsPath, serializeMappedFile(mappedFile), result);
  }

  const diffPath = buildVFSPath(trimmedOwner, trimmedRepo, prNumber, 'diff.patch');
  const diffExisted = await pathExists(vfs, diffPath);

  try {
    const diffResult = await fetchAndWriteDiff(provider, trimmedOwner, trimmedRepo, prNumber, vfs);
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

  return result;
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

async function resolveConnectionId(provider: GitHubProxyProvider): Promise<string> {
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

function serializeJson(value: PullRequestMetadata): string {
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

async function writeTrackedFile(
  vfs: VfsLike,
  path: string,
  content: string,
  result: IngestResult,
): Promise<void> {
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
      error: formatError(error),
    });
  }
}
