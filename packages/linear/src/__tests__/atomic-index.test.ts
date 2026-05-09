import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LinearAdapter,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

interface CasFile {
  content: string;
  revision: string;
}

/**
 * CAS-aware client that simulates the relayfile server's revision contract:
 * each successful write bumps the revision, and a write whose
 * `baseRevision` does not match the current revision throws a
 * `RevisionConflictError`-shaped error.
 */
function createCasClient() {
  const files = new Map<string, CasFile>();
  let revisionCounter = 0;
  const conflictCounts = { writes: 0 };

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

  const client: RelayFileClientLike & {
    readFile(input: string | { path: string }): { content: string; revision: string } | undefined;
  } = {
    async writeFile(input: WriteFileInput) {
      const baseRevision = input.baseRevision ?? '0';
      const existing = files.get(input.path);
      const currentRevision = existing?.revision ?? '0';

      if (currentRevision !== baseRevision) {
        conflictCounts.writes += 1;
        throw conflictError(currentRevision, baseRevision);
      }

      revisionCounter += 1;
      const nextRevision = `r${revisionCounter}`;
      files.set(input.path, { content: input.content, revision: nextRevision });
      return { created: !existing, updated: !!existing };
    },
    readFile(input: string | { path: string }) {
      const path = typeof input === 'string' ? input : input.path;
      const existing = files.get(path);
      return existing ? { content: existing.content, revision: existing.revision } : undefined;
    },
  };

  return { client, files, conflictCounts };
}

const provider: ConnectionProvider = {
  name: 'linear-test-provider',
  async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
    return {
      status: 200,
      headers: {},
      data: null as never,
    };
  },
  async healthCheck() {
    return true;
  },
};

describe('atomic _index.json upserts (linear)', () => {
  it('preserves a competing row when two ingestions race on the same scope index', async () => {
    const { client, files, conflictCounts } = createCasClient();
    const adapter = new LinearAdapter(client, provider, {});
    const indexPath = '/linear/issues/_index.json';

    // Pre-seed the issues `_index.json` with a competing row that the
    // adapter never writes itself. Under read-modify-write the second
    // racing ingestion would clobber this row when it serializes its
    // merged set; under CAS the second writer's write conflicts, the
    // helper re-reads the up-to-date content (which includes the row),
    // merges with its required rows, and writes successfully.
    files.set(indexPath, {
      content: `${JSON.stringify({
        rows: [
          { title: 'by-id', file: 'by-id/' },
          { title: 'by-title', file: 'by-title/' },
          { title: 'extra', file: 'extra/' },
        ],
      })}\n`,
      revision: 'r-seed',
    });

    // Two concurrent issue ingestions targeting the same scope. Both
    // call writeLinearIndex on `/linear/issues/_index.json`.
    await Promise.all([
      adapter.ingestWebhook('ws-linear', {
        provider: 'linear',
        eventType: 'issue.create',
        objectType: 'issue',
        objectId: 'issue-1',
        payload: {
          id: 'issue-1',
          identifier: 'AGE-1',
          title: 'Issue One',
        },
      }),
      adapter.ingestWebhook('ws-linear', {
        provider: 'linear',
        eventType: 'issue.create',
        objectType: 'issue',
        objectId: 'issue-2',
        payload: {
          id: 'issue-2',
          identifier: 'AGE-2',
          title: 'Issue Two',
        },
      }),
    ]);

    const stored = files.get(indexPath);
    assert.ok(stored, 'index file must exist after concurrent writes');
    const parsed = JSON.parse(stored!.content) as {
      rows: Array<{ file: string; title: string }>;
    };
    const fileEntries = parsed.rows.map((row) => row.file).sort();

    assert.deepEqual(
      fileEntries,
      ['by-id/', 'by-title/', 'extra/'],
      'CAS retry loop must preserve the pre-existing competing row alongside the writers required rows',
    );
    // Sanity: at least one CAS conflict happened — proves the test
    // actually exercised the retry loop and is not passing trivially.
    assert.ok(
      conflictCounts.writes >= 1,
      `expected at least one CAS conflict to be observed, saw ${conflictCounts.writes}`,
    );
  });
});
