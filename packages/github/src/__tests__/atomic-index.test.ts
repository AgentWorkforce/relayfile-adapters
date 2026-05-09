import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  atomicUpsertRecordIndex,
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

  it('reports filesUpdated when a racing writer creates the file first', async () => {
    // Regression: runAtomicIndexWrite previously read existedBefore from a
    // dedicated pre-CAS read. If a racing writer created the file between
    // that read and the eventual successful CAS write, the result reported
    // filesWritten: 1 / filesUpdated: 0 even though the winning attempt
    // actually updated an existing file. The fix moves the existed check
    // inside upsertIndexAtomic where the read that produced the winning
    // baseRevision is the source of truth.
    const vfs = new CasVfs();
    const path = githubRepoPullsIndexPath('octocat', 'hello-world');

    // Seed the file by another writer (simulates the race winner) BEFORE
    // we attempt the upsert. Under the old code the empty pre-read would
    // have decided "the file is new" — but we're updating, not creating.
    vfs.writeFile(
      path,
      buildRepoPullsIndexFile('octocat', 'hello-world', [
        {
          id: '1',
          title: 'PR one',
          updated: '2026-04-01T00:00:00Z',
          number: 1,
          state: 'open',
        },
      ]).content,
    );

    const result = await atomicUpsertRecordIndex(
      vfs as unknown as VfsLike,
      path,
      (rows) =>
        upsertRecordIndexRow(rows, {
          id: '2',
          title: 'PR two',
          updated: '2026-04-02T00:00:00Z',
          number: 2,
          state: 'open',
        }),
      (rows) => buildRepoPullsIndexFile('octocat', 'hello-world', rows).content,
      { sleep: async () => undefined, baseDelayMs: 0 },
    );

    assert.deepEqual(result.errors, []);
    assert.equal(result.filesUpdated, 1, 'must report filesUpdated for an existing file');
    assert.equal(result.filesWritten, 0, 'must not report filesWritten when updating');
  });
});
