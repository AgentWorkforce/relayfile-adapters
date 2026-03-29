import { fetchCheckRuns, type GitHubCheckRunProvider } from './fetcher.js';
import type { JsonObject, JsonValue } from '../types.js';
import type { IngestResult } from '../webhook/event-map.js';

type CheckConclusion = 'pending' | 'success' | 'failure';

interface CheckRunOutput {
  title: string;
  summary: string;
}

export interface MappedCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  output: CheckRunOutput;
  html_url: string | null;
  app: {
    name: string;
    slug: string | null;
  };
}

export interface MappedCheckRunFile {
  vfsPath: string;
  content: string;
}

export interface AggregatedCheckStatus {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  conclusion: CheckConclusion;
}

type VfsWriteResult =
  | void
  | {
      created?: boolean;
      updated?: boolean;
      status?: 'created' | 'pending' | 'queued' | 'updated';
    };

export interface CheckRunVfs {
  writeFile?: (path: string, content: string) => Promise<VfsWriteResult> | VfsWriteResult;
  write?: (path: string, content: string) => Promise<VfsWriteResult> | VfsWriteResult;
  put?: (path: string, content: string) => Promise<VfsWriteResult> | VfsWriteResult;
}

export function mapCheckRun(
  checkRun: unknown,
  owner: string,
  repo: string,
  prNumber: number,
): MappedCheckRunFile {
  const source = expectObject(checkRun, 'GitHub check run');
  const id = readPositiveInteger(source, 'id', 'GitHub check run');
  const mapped: MappedCheckRun = {
    id,
    name: readString(source, 'name', 'GitHub check run'),
    status: readString(source, 'status', 'GitHub check run'),
    conclusion: readNullableString(source, 'conclusion', 'GitHub check run'),
    started_at: readNullableString(source, 'started_at', 'GitHub check run'),
    completed_at: readNullableString(source, 'completed_at', 'GitHub check run'),
    output: mapOutput(source.output),
    html_url: readNullableString(source, 'html_url', 'GitHub check run'),
    app: mapApp(source.app),
  };

  void owner;
  void repo;
  void prNumber;

  return {
    vfsPath: `checks/${id}.json`,
    content: stableJson(mapped),
  };
}

export function aggregateCheckStatus(checkRuns: readonly unknown[]): AggregatedCheckStatus {
  let passed = 0;
  let failed = 0;
  let pending = 0;

  for (const checkRun of checkRuns) {
    const category = classifyCheckRun(checkRun);
    if (category === 'success') {
      passed += 1;
      continue;
    }

    if (category === 'failure') {
      failed += 1;
      continue;
    }

    pending += 1;
  }

  return {
    total: checkRuns.length,
    passed,
    failed,
    pending,
    conclusion: deriveOverallConclusion(failed, pending),
  };
}

export async function ingestCheckRuns(
  provider: GitHubCheckRunProvider,
  owner: string,
  repo: string,
  number: number,
  headSha: string,
  vfs: CheckRunVfs,
): Promise<IngestResult> {
  const result: IngestResult = {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };

  const writer = resolveVfsWriter(vfs);
  const { check_runs: checkRuns } = await fetchCheckRuns(provider, owner, repo, headSha);
  const mappedFiles = checkRuns.map((checkRun) => mapCheckRun(checkRun, owner, repo, number));

  for (const mappedFile of mappedFiles) {
    await writeMappedFile(writer, mappedFile, result);
  }

  const summaryFile: MappedCheckRunFile = {
    vfsPath: 'checks/_summary.json',
    content: stableJson(aggregateCheckStatus(checkRuns)),
  };
  await writeMappedFile(writer, summaryFile, result);

  return result;
}

function mapOutput(value: JsonValue | undefined): CheckRunOutput {
  const output = value === undefined ? undefined : expectObject(value, 'GitHub check run.output');

  return {
    title: readOptionalString(output, 'title') ?? '',
    summary: readOptionalString(output, 'summary') ?? '',
  };
}

function mapApp(value: JsonValue | undefined): MappedCheckRun['app'] {
  const app = value === undefined ? undefined : expectObject(value, 'GitHub check run.app');

  return {
    name: readOptionalString(app, 'name') ?? '',
    slug: readOptionalNullableString(app, 'slug') ?? null,
  };
}

function classifyCheckRun(checkRun: unknown): CheckConclusion {
  const source = expectObject(checkRun, 'Check run');
  const status = readOptionalString(source, 'status')?.toLowerCase();
  const conclusion = readOptionalNullableString(source, 'conclusion')?.toLowerCase();

  if (status !== 'completed' || conclusion === null || conclusion === undefined) {
    return 'pending';
  }

  return conclusion === 'success' ? 'success' : 'failure';
}

function deriveOverallConclusion(failed: number, pending: number): CheckConclusion {
  if (failed > 0) {
    return 'failure';
  }

  if (pending > 0) {
    return 'pending';
  }

  return 'success';
}

function resolveVfsWriter(
  vfs: CheckRunVfs,
): (path: string, content: string) => Promise<VfsWriteResult> {
  const writer = vfs.writeFile ?? vfs.write ?? vfs.put;
  if (!writer) {
    throw new Error('VFS must implement writeFile(path, content), write(path, content), or put(path, content).');
  }

  return async (path: string, content: string) => writer.call(vfs, path, content);
}

async function writeMappedFile(
  writer: (path: string, content: string) => Promise<VfsWriteResult>,
  mappedFile: MappedCheckRunFile,
  result: IngestResult,
): Promise<void> {
  try {
    const writeResult = await writer(mappedFile.vfsPath, mappedFile.content);
    result.paths.push(mappedFile.vfsPath);
    applyWriteCounts(result, writeResult);
  } catch (error) {
    result.errors.push({
      path: mappedFile.vfsPath,
      error: toErrorMessage(error),
    });
  }
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

function expectObject(value: unknown, context: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }

  return value as JsonObject;
}

function readPositiveInteger(source: JsonObject, key: string, context: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${context}.${key} must be a positive integer`);
  }

  return value;
}

function readString(source: JsonObject, key: string, context: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }

  return value;
}

function readNullableString(source: JsonObject, key: string, context: string): string | null {
  const value = source[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${context}.${key} must be a string or null`);
  }

  return value;
}

function readOptionalString(source: JsonObject | undefined, key: string): string | undefined {
  if (!source) {
    return undefined;
  }

  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalNullableString(
  source: JsonObject | undefined,
  key: string,
): string | null | undefined {
  if (!source) {
    return undefined;
  }

  const value = source[key];
  if (value === null || typeof value === 'string') {
    return value as string | null;
  }

  return undefined;
}

function isVfsWriteState(
  value: VfsWriteResult,
): value is Exclude<VfsWriteResult, void> {
  return typeof value === 'object' && value !== null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
