import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { validateConfig } from '../config.js';
import { convergeRepoPullIndex } from '../pull-index-convergence.js';
import type { ProxyRequest, ProxyResponse } from '../types.js';

const OWNER = 'octocat';
const REPO = 'hello-world';
const PULL_INDEX_PATH = `/github/repos/${OWNER}/${REPO}/pulls/_index.json`;
const ISSUE_INDEX_PATH = `/github/repos/${OWNER}/${REPO}/issues/_index.json`;

interface StoredFile {
  content: string;
  revision: string;
}

class PullIndexProvider {
  readonly name = 'pull-index-provider';
  readonly connectionId = 'conn-pull-index';
  readonly requests: ProxyRequest[] = [];
  readonly writeAttempts: string[] = [];
  readonly writes: string[] = [];
  readonly files = new Map<string, StoredFile>();
  private revision = 0;
  private concurrentRow: Record<string, unknown> | undefined;
  private staleReads: { path: string; remaining: number; value: StoredFile } | undefined;

  constructor(private readonly pulls: ReturnType<typeof createPull>[]) {}

  async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
    this.requests.push(request);
    if (request.endpoint !== `/repos/${OWNER}/${REPO}/pulls`) {
      throw new Error(`Per-record ingest must never run: ${request.method} ${request.endpoint}`);
    }
    const page = Number(request.query?.page ?? 1);
    const perPage = Number(request.query?.per_page ?? 100);
    const start = (page - 1) * perPage;
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: this.pulls.slice(start, start + perPage) as T,
    };
  }

  readFile(path: string): { content: string; revision: string } | undefined {
    if (this.staleReads?.path === path && this.staleReads.remaining > 0) {
      this.staleReads.remaining -= 1;
      return { ...this.staleReads.value };
    }
    const stored = this.files.get(path);
    return stored ? { ...stored } : undefined;
  }

  writeFile(
    path: string,
    content: string,
    options?: { baseRevision?: string },
  ): void {
    this.writeAttempts.push(path);
    if (path === PULL_INDEX_PATH && this.concurrentRow) {
      const currentBeforePeer = this.files.get(path);
      const rows = currentBeforePeer
        ? JSON.parse(currentBeforePeer.content) as Array<Record<string, unknown>>
        : [];
      this.revision += 1;
      this.files.set(path, {
        content: `${JSON.stringify([...rows, this.concurrentRow])}\n`,
        revision: `r${this.revision}`,
      });
      this.concurrentRow = undefined;
    }
    const current = this.files.get(path);
    const currentRevision = current?.revision ?? '0';
    if ((options?.baseRevision ?? '0') !== currentRevision) {
      const error = new Error('synthetic revision conflict');
      Object.assign(error, { name: 'RevisionConflictError', status: 409 });
      throw error;
    }
    this.revision += 1;
    this.files.set(path, { content, revision: `r${this.revision}` });
    this.writes.push(path);
  }

  seed(path: string, value: unknown): void {
    this.revision += 1;
    this.files.set(path, {
      content: `${JSON.stringify(value)}\n`,
      revision: `r${this.revision}`,
    });
  }

  injectConcurrentRowOnNextWrite(row: Record<string, unknown>): void {
    this.concurrentRow = row;
  }

  advanceIndexWithStaleReads(row: Record<string, unknown>, staleReadCount: number): void {
    const current = this.files.get(PULL_INDEX_PATH);
    assert.ok(current, 'pull index must be seeded before simulating a stale read');
    const rows = JSON.parse(current.content) as Array<Record<string, unknown>>;
    this.staleReads = {
      path: PULL_INDEX_PATH,
      remaining: staleReadCount,
      value: { ...current },
    };
    this.revision += 1;
    this.files.set(PULL_INDEX_PATH, {
      content: `${JSON.stringify([...rows, row])}\n`,
      revision: `r${this.revision}`,
    });
  }

  text(path: string): string {
    const stored = this.files.get(path);
    assert.ok(stored, `expected ${path} to exist`);
    return stored.content;
  }
}

describe('convergeRepoPullIndex', () => {
  it('writes documented pull rows with headRef and performs no per-record ingest', async () => {
    const provider = new PullIndexProvider([
      createPull(7, { headRef: 'feature/AR-7' }),
      createPull(8, {
        headRef: 'feature/AR-8',
        labels: ['factory'],
        mergedAt: '2026-08-25T11:00:00Z',
        state: 'closed',
      }),
    ]);
    const issueRows = [{
      id: '7',
      title: 'Issue seven',
      updated: '2026-08-20T00:00:00Z',
      number: 7,
      state: 'open',
    }];
    provider.seed(ISSUE_INDEX_PATH, issueRows);

    const result = await convergeRepoPullIndex(
      'workspace-1',
      provider,
      config(),
      OWNER,
      REPO,
    );

    assert.deepEqual(JSON.parse(provider.text(PULL_INDEX_PATH)), [
      {
        id: '7',
        title: 'Pull 7',
        updated: '2026-08-25T12:00:00Z',
        number: 7,
        state: 'open',
        headRef: 'feature/AR-7',
      },
      {
        id: '8',
        title: 'Pull 8',
        updated: '2026-08-25T12:00:00Z',
        number: 8,
        state: 'closed',
        labels: ['factory'],
        merged: true,
        mergedAt: '2026-08-25T11:00:00Z',
        headRef: 'feature/AR-8',
      },
    ]);
    assert.deepEqual(JSON.parse(provider.text(ISSUE_INDEX_PATH)), issueRows);
    assert.equal('headRef' in issueRows[0]!, false, 'issue rows omit headRef');
    assert.deepEqual(provider.writes, [PULL_INDEX_PATH]);
    assert.equal(provider.requests.length, 1, 'one invocation has one GitHub request');
    assert.deepEqual(provider.requests[0]?.query, {
      state: 'all',
      sort: 'created',
      direction: 'asc',
      per_page: '100',
      page: '1',
    });
    assert.deepEqual(result, {
      filesWritten: 1,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [PULL_INDEX_PATH],
      errors: [],
      done: true,
      page: 1,
      pullRequestsScanned: 2,
      pullRequestsPersisted: 2,
      githubRequests: 1,
    });

    const source = readFileSync(
      new URL('../pull-index-convergence.ts', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /\bingest(?:Issue|PullRequest)\b/,
      'the primitive must not import or call either per-record ingest function',
    );
  });

  it('uses one request per resumable page and converges a 238-pull repository', async () => {
    const provider = new PullIndexProvider(
      Array.from({ length: 238 }, (_, index) =>
        createPull(index + 1, { headRef: `feature/${index + 1}` }),
      ),
    );

    const first = await convergeRepoPullIndex(
      'workspace-1', provider, config(), OWNER, REPO,
    );
    assert.equal(first.done, false);
    assert.equal(first.page, 1);
    assert.equal(first.pullRequestsScanned, 100);
    assert.equal(first.pullRequestsPersisted, 100);
    assert.ok(first.cursor);
    assert.equal(provider.requests.length, 1);

    const second = await convergeRepoPullIndex(
      'workspace-1', provider, config(), OWNER, REPO, { cursor: first.cursor },
    );
    assert.equal(second.done, false);
    assert.equal(second.page, 2);
    assert.equal(second.pullRequestsScanned, 100);
    assert.equal(second.pullRequestsPersisted, 100);
    assert.ok(second.cursor);
    assert.equal(provider.requests.length, 2);

    const third = await convergeRepoPullIndex(
      'workspace-1', provider, config(), OWNER, REPO, { cursor: second.cursor },
    );
    assert.equal(third.done, true);
    assert.equal(third.page, 3);
    assert.equal(third.pullRequestsScanned, 38);
    assert.equal(third.pullRequestsPersisted, 38);
    assert.equal(third.cursor, undefined);
    assert.equal(provider.requests.length, 3);

    const rows = JSON.parse(provider.text(PULL_INDEX_PATH)) as Array<Record<string, unknown>>;
    const scanned = first.pullRequestsScanned
      + second.pullRequestsScanned
      + third.pullRequestsScanned;
    const persisted = first.pullRequestsPersisted
      + second.pullRequestsPersisted
      + third.pullRequestsPersisted;
    assert.equal(persisted, scanned, 'every scanned row must be reported persisted');
    assert.equal(rows.length, persisted, 'persisted accounting must match the stored index');
    assert.equal(rows.length, 238);
    assert.ok(rows.every((row) => typeof row.headRef === 'string' && row.headRef.length > 0));
    assert.deepEqual(
      provider.requests.map((request) => request.query?.page),
      ['1', '2', '3'],
    );
  });

  it('is idempotent and merges against the current index instead of an empty baseline', async () => {
    const provider = new PullIndexProvider([createPull(7, { headRef: 'feature/AR-7' })]);
    provider.seed(PULL_INDEX_PATH, [
      {
        id: '7',
        title: 'stale title',
        updated: '2026-08-01T00:00:00Z',
        number: 7,
        state: 'open',
        merged: true,
        mergedAt: '2026-08-24T00:00:00Z',
      },
      {
        id: '99',
        title: 'concurrent row',
        updated: '2026-08-24T00:00:00Z',
        number: 99,
        state: 'open',
        headRef: 'feature/concurrent',
      },
    ]);

    await convergeRepoPullIndex('workspace-1', provider, config(), OWNER, REPO);
    const afterFirst = provider.text(PULL_INDEX_PATH);
    await convergeRepoPullIndex('workspace-1', provider, config(), OWNER, REPO);
    const afterSecond = provider.text(PULL_INDEX_PATH);

    assert.equal(afterSecond, afterFirst, 'a retry writes identical canonical bytes');
    const rows = JSON.parse(afterSecond) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2, 'retries do not duplicate rows or stomp peers');
    assert.equal(rows.find((row) => row.id === '7')?.headRef, 'feature/AR-7');
    assert.equal(rows.find((row) => row.id === '7')?.mergedAt, '2026-08-24T00:00:00Z');
    assert.equal(rows.find((row) => row.id === '99')?.headRef, 'feature/concurrent');
    assert.equal(provider.requests.length, 2);
    assert.deepEqual(provider.writes, [PULL_INDEX_PATH, PULL_INDEX_PATH]);
  });

  it('retries a revision conflict and preserves the concurrent index writer', async () => {
    const provider = new PullIndexProvider([createPull(7, { headRef: 'feature/AR-7' })]);
    provider.seed(PULL_INDEX_PATH, []);
    provider.injectConcurrentRowOnNextWrite({
      id: '99',
      title: 'Webhook-created pull',
      updated: '2026-08-25T12:30:00Z',
      number: 99,
      state: 'open',
      headRef: 'feature/webhook',
    });

    const result = await convergeRepoPullIndex(
      'workspace-1', provider, config(), OWNER, REPO,
    );

    assert.deepEqual(result.errors, []);
    assert.equal(provider.requests.length, 1, 'CAS retries do not repeat the GitHub list call');
    const rows = JSON.parse(provider.text(PULL_INDEX_PATH)) as Array<Record<string, unknown>>;
    assert.deepEqual(rows.map((row) => row.id), ['99', '7']);
    assert.equal(rows.find((row) => row.id === '99')?.headRef, 'feature/webhook');
    assert.equal(rows.find((row) => row.id === '7')?.headRef, 'feature/AR-7');
  });

  it('rejects the page when stale reads exhaust every CAS write attempt', async () => {
    const provider = new PullIndexProvider([createPull(7, { headRef: 'feature/AR-7' })]);
    provider.seed(PULL_INDEX_PATH, []);
    provider.advanceIndexWithStaleReads({
      id: '99',
      title: 'Webhook-created pull',
      updated: '2026-08-25T12:30:00Z',
      number: 99,
      state: 'open',
      headRef: 'feature/webhook',
    }, 3);

    await assert.rejects(
      convergeRepoPullIndex('workspace-1', provider, config(), OWNER, REPO),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'PullIndexConvergenceError');
        assert.match(error.message, /failed to persist pull-index page 1/);
        return true;
      },
    );

    assert.equal(provider.requests.length, 1, 'CAS retries do not repeat the GitHub list call');
    assert.equal(provider.writeAttempts.length, 3, 'every bounded CAS attempt must conflict');
    assert.equal(provider.writes.length, 0, 'the fetched page never reached the index');
    const rows = JSON.parse(provider.text(PULL_INDEX_PATH)) as Array<Record<string, unknown>>;
    assert.deepEqual(rows.map((row) => row.id), ['99']);
  });

  it('rejects a cursor from another repository before spending a request', async () => {
    const provider = new PullIndexProvider([]);
    const firstPage = new PullIndexProvider(
      Array.from({ length: 100 }, (_, index) => createPull(index + 1)),
    );
    const first = await convergeRepoPullIndex(
      'workspace-1', firstPage, config(), OWNER, REPO,
    );
    assert.ok(first.cursor);

    await assert.rejects(
      convergeRepoPullIndex(
        'workspace-1', provider, config(), OWNER, 'another-repo', { cursor: first.cursor },
      ),
      /Invalid GitHub pull-index cursor/,
    );
    assert.equal(provider.requests.length, 0);
    assert.equal(provider.writes.length, 0);
  });

  it('rejects a write-only VFS before a request can overwrite an empty baseline', async () => {
    const requests: ProxyRequest[] = [];
    const writes: string[] = [];
    const writeOnlyProvider = {
      name: 'write-only-provider',
      connectionId: 'conn-pull-index',
      async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
        requests.push(request);
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: [createPull(7)] as T,
        };
      },
      writeFile(path: string): void {
        writes.push(path);
      },
    };

    await assert.rejects(
      convergeRepoPullIndex('workspace-1', writeOnlyProvider, config(), OWNER, REPO),
      /requires a provider that implements VFS reads/,
    );
    assert.equal(requests.length, 0);
    assert.equal(writes.length, 0);
  });

  it('rejects a malformed list row without head.ref before touching the index', async () => {
    const malformed = createPull(7) as ReturnType<typeof createPull> & { head?: unknown };
    delete malformed.head;
    const provider = new PullIndexProvider([malformed as ReturnType<typeof createPull>]);

    await assert.rejects(
      convergeRepoPullIndex('workspace-1', provider, config(), OWNER, REPO),
      /\.head\.ref must be a non-empty string/,
    );
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.writes.length, 0);
  });
});

function config() {
  return validateConfig({ connectionId: 'conn-pull-index' });
}

function createPull(
  number: number,
  options: {
    headRef?: string;
    labels?: string[];
    mergedAt?: string;
    state?: string;
  } = {},
) {
  return {
    number,
    title: `Pull ${number}`,
    state: options.state ?? 'open',
    updated_at: '2026-08-25T12:00:00Z',
    merged_at: options.mergedAt ?? null,
    labels: (options.labels ?? []).map((name) => ({ name })),
    head: { ref: options.headRef ?? `feature/${number}` },
  };
}
