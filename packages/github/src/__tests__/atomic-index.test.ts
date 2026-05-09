import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AtomicIndexExhaustedError,
  atomicUpsertRecordIndex,
  isConflictError,
  upsertIndexAtomic,
} from '../atomic-index.js';
import {
  buildRepoPullsIndexFile,
  upsertRecordIndexRow,
  type GitHubRecordIndexRow,
} from '../index-emitter.js';
import { githubRepoPullsIndexPath } from '../path-mapper.js';
import type { VfsLike } from '../files/content-fetcher.js';

interface CasFile {
  content: string;
  revision: string;
}

interface CasVfsOptions {
  /**
   * If set, the next `n` write attempts to the matching path will throw a
   * synthetic `RevisionConflictError`-shaped error before any state changes.
   * This simulates a hostile concurrent writer beating us to the punch.
   */
  forceConflicts?: { path: string; remaining: number };
}

class CasVfs {
  private readonly files = new Map<string, CasFile>();
  private revisionCounter = 0;
  private readonly options: CasVfsOptions;

  readonly conflictWrites: string[] = [];
  readonly successfulWrites: string[] = [];

  constructor(options: CasVfsOptions = {}) {
    this.options = options;
  }

  armConflicts(path: string, count: number): void {
    this.options.forceConflicts = { path, remaining: count };
  }

  readFile(path: string): { content: string; revision: string } | undefined {
    const existing = this.files.get(path);
    return existing ? { content: existing.content, revision: existing.revision } : undefined;
  }

  writeFile(
    path: string,
    content: string,
    options?: { baseRevision?: string },
  ): { revision: string } {
    if (
      this.options.forceConflicts &&
      this.options.forceConflicts.path === path &&
      this.options.forceConflicts.remaining > 0
    ) {
      this.options.forceConflicts.remaining -= 1;
      this.conflictWrites.push(path);
      throw conflictError(this.files.get(path)?.revision ?? '0', options?.baseRevision ?? '0');
    }

    const baseRevision = options?.baseRevision ?? '0';
    const existing = this.files.get(path);
    const currentRevision = existing?.revision ?? '0';

    if (currentRevision !== baseRevision) {
      this.conflictWrites.push(path);
      throw conflictError(currentRevision, baseRevision);
    }

    this.revisionCounter += 1;
    const nextRevision = `r${this.revisionCounter}`;
    this.files.set(path, { content, revision: nextRevision });
    this.successfulWrites.push(path);
    return { revision: nextRevision };
  }
}

function conflictError(currentRevision: string, expectedRevision: string): Error {
  const error = new Error(
    `RevisionConflictError: expected ${expectedRevision}, current ${currentRevision}`,
  );
  Object.assign(error, {
    name: 'RevisionConflictError',
    status: 409,
    code: 'revision_conflict',
    expectedRevision,
    currentRevision,
  });
  return error;
}

const PARSE_RECORD_ROWS = (content: string | undefined): GitHubRecordIndexRow[] => {
  if (!content) {
    return [];
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? (parsed as GitHubRecordIndexRow[]) : [];
  } catch {
    return [];
  }
};

const SERIALIZE_RECORD_ROWS = (
  owner: string,
  repo: string,
): ((rows: GitHubRecordIndexRow[]) => string) => {
  return (rows) => buildRepoPullsIndexFile(owner, repo, rows).content;
};

const PR_INDEX_PATH = githubRepoPullsIndexPath('octocat', 'hello-world');

describe('isConflictError', () => {
  it('detects RevisionConflictError by name', () => {
    const err = Object.assign(new Error('boom'), { name: 'RevisionConflictError' });
    assert.equal(isConflictError(err), true);
  });

  it('detects 409 by status', () => {
    assert.equal(isConflictError({ status: 409 }), true);
    assert.equal(isConflictError({ statusCode: 409 }), true);
  });

  it('detects revision_conflict by code', () => {
    assert.equal(isConflictError({ code: 'revision_conflict' }), true);
  });

  it('returns false for unrelated errors', () => {
    assert.equal(isConflictError(new Error('disk full')), false);
    assert.equal(isConflictError({ status: 500 }), false);
    assert.equal(isConflictError(undefined), false);
    assert.equal(isConflictError(null), false);
    assert.equal(isConflictError('conflict'), false);
  });
});

describe('upsertIndexAtomic', () => {
  it('writes once on the happy path with no conflict', async () => {
    const vfs = new CasVfs();
    await upsertIndexAtomic<GitHubRecordIndexRow>(
      vfs as unknown as VfsLike,
      PR_INDEX_PATH,
      PARSE_RECORD_ROWS,
      (rows) =>
        upsertRecordIndexRow(rows, {
          id: '7',
          title: 'Add login',
          updated: '2026-04-01T00:00:00Z',
          number: 7,
          state: 'open',
        }),
      SERIALIZE_RECORD_ROWS('octocat', 'hello-world'),
      { sleep: async () => undefined },
    );

    assert.equal(vfs.successfulWrites.length, 1);
    assert.equal(vfs.conflictWrites.length, 0);
    const stored = vfs.readFile(PR_INDEX_PATH);
    assert.ok(stored, 'index file should exist');
    const rows = JSON.parse(stored!.content) as GitHubRecordIndexRow[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, '7');
  });

  it('retries successfully after a single conflict', async () => {
    // Pre-seed an initial revision so the simulated conflict has a meaningful
    // `currentRevision` for the loop to re-read. The forceConflicts knob is
    // armed *after* the seed write so the seed itself completes cleanly.
    const vfs = new CasVfs();
    // seed with a row from a "competing" writer
    vfs.writeFile(
      PR_INDEX_PATH,
      `${JSON.stringify([{ id: '5', title: 'Existing PR', updated: '2026-03-01T00:00:00Z', number: 5, state: 'open' }])}\n`,
      { baseRevision: '0' },
    );
    vfs.armConflicts(PR_INDEX_PATH, 1);

    let invocations = 0;
    await upsertIndexAtomic<GitHubRecordIndexRow>(
      vfs as unknown as VfsLike,
      PR_INDEX_PATH,
      PARSE_RECORD_ROWS,
      (rows) => {
        invocations += 1;
        return upsertRecordIndexRow(rows, {
          id: '7',
          title: 'New PR',
          updated: '2026-04-01T00:00:00Z',
          number: 7,
          state: 'open',
        });
      },
      SERIALIZE_RECORD_ROWS('octocat', 'hello-world'),
      { sleep: async () => undefined, baseDelayMs: 0 },
    );

    assert.equal(invocations, 2, 'merge should run on each attempt');
    assert.equal(vfs.conflictWrites.length, 1);
    const stored = vfs.readFile(PR_INDEX_PATH);
    const rows = JSON.parse(stored!.content) as GitHubRecordIndexRow[];
    const ids = rows.map((row) => row.id).sort();
    // Both the pre-seeded "competing" row and the new row must survive.
    assert.deepEqual(ids, ['5', '7']);
  });

  it('throws AtomicIndexExhaustedError when conflicts persist past the budget', async () => {
    const vfs = new CasVfs({
      forceConflicts: { path: PR_INDEX_PATH, remaining: 100 },
    });

    await assert.rejects(
      upsertIndexAtomic<GitHubRecordIndexRow>(
        vfs as unknown as VfsLike,
        PR_INDEX_PATH,
        PARSE_RECORD_ROWS,
        (rows) => upsertRecordIndexRow(rows, {
          id: '7',
          title: 'Stuck PR',
          updated: '2026-04-01T00:00:00Z',
          number: 7,
          state: 'open',
        }),
        SERIALIZE_RECORD_ROWS('octocat', 'hello-world'),
        { maxAttempts: 3, sleep: async () => undefined, baseDelayMs: 0 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof AtomicIndexExhaustedError);
        assert.equal(error.attempts, 3);
        assert.equal(error.path, PR_INDEX_PATH);
        return true;
      },
    );

    assert.equal(vfs.successfulWrites.length, 0);
  });

  it('rethrows non-conflict errors without retrying', async () => {
    const vfs: VfsLike = {
      readFile() {
        return undefined;
      },
      writeFile() {
        const error = new Error('disk full');
        Object.assign(error, { status: 500 });
        throw error;
      },
    };

    let attempts = 0;
    await assert.rejects(
      upsertIndexAtomic<GitHubRecordIndexRow>(
        vfs,
        PR_INDEX_PATH,
        PARSE_RECORD_ROWS,
        (rows) => {
          attempts += 1;
          return rows;
        },
        SERIALIZE_RECORD_ROWS('octocat', 'hello-world'),
        { sleep: async () => undefined, maxAttempts: 5 },
      ),
      /disk full/,
    );
    assert.equal(attempts, 1, 'non-conflict errors must not trigger retry');
  });
});

describe('atomicUpsertRecordIndex (integration with CAS-aware VFS)', () => {
  it('preserves rows from two concurrent ingestions racing on the same index', async () => {
    const vfs = new CasVfs();
    const path = githubRepoPullsIndexPath('octocat', 'hello-world');

    // Both writers read the empty index simultaneously. Without CAS the
    // second write would clobber the first's row; under CAS the second write
    // observes the bumped revision, conflicts, re-reads, and merges.
    const [first, second] = await Promise.all([
      atomicUpsertRecordIndex(
        vfs as unknown as VfsLike,
        path,
        (rows) =>
          upsertRecordIndexRow(rows, {
            id: '7',
            title: 'PR seven',
            updated: '2026-04-01T00:00:00Z',
            number: 7,
            state: 'open',
          }),
        (rows) => buildRepoPullsIndexFile('octocat', 'hello-world', rows).content,
        { sleep: async () => undefined, baseDelayMs: 0 },
      ),
      atomicUpsertRecordIndex(
        vfs as unknown as VfsLike,
        path,
        (rows) =>
          upsertRecordIndexRow(rows, {
            id: '8',
            title: 'PR eight',
            updated: '2026-04-02T00:00:00Z',
            number: 8,
            state: 'open',
          }),
        (rows) => buildRepoPullsIndexFile('octocat', 'hello-world', rows).content,
        { sleep: async () => undefined, baseDelayMs: 0 },
      ),
    ]);

    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);

    const stored = vfs.readFile(path);
    assert.ok(stored, 'index file must exist after concurrent writes');
    const rows = JSON.parse(stored!.content) as GitHubRecordIndexRow[];
    const ids = rows.map((row) => row.id).sort();
    assert.deepEqual(
      ids,
      ['7', '8'],
      'both concurrent writers must contribute a row to the final index',
    );
  });
});
