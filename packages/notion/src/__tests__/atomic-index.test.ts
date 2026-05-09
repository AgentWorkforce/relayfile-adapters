import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { writeWorkspaceFiles } from '../bulk-ingest.js';
import type { NotionVfsFile } from '../types.js';

interface CasFile {
  content: string;
  revision: string;
}

/**
 * Simulated CAS-aware relayfile client for the notion adapter.
 *
 * Mirrors the behaviour of the production server: every successful write
 * bumps the revision counter, and a write whose `baseRevision` does not
 * match the current revision throws a `RevisionConflictError`-shaped error.
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

  const client = {
    async readFile(_workspaceId: string, path: string) {
      const existing = files.get(path);
      if (!existing) {
        // The notion bulk-ingest client uses a thrown error to signal
        // "missing file"; the production SDK does the same.
        throw new Error(`Missing file: ${path}`);
      }
      return {
        path,
        content: existing.content,
        revision: existing.revision,
        contentType: 'application/json; charset=utf-8',
      };
    },
    async writeFile(input: {
      workspaceId: string;
      path: string;
      content: string;
      baseRevision?: string;
      contentType?: string;
    }) {
      const baseRevision = input.baseRevision ?? '0';
      const existing = files.get(input.path);
      const currentRevision = existing?.revision ?? '0';

      if (currentRevision !== baseRevision) {
        conflictCounts.writes += 1;
        throw conflictError(currentRevision, baseRevision);
      }

      revisionCounter += 1;
      files.set(input.path, {
        content: input.content,
        revision: String(revisionCounter),
      });
      return { id: String(revisionCounter), status: 'queued' as const };
    },
  };

  return { client, files, conflictCounts };
}

function aliasFile(scopePath: string, id: string, title: string): NotionVfsFile {
  return {
    path: `${scopePath}/${id}.json`,
    contentType: 'application/json; charset=utf-8',
    content: JSON.stringify({ id, title }),
    aliasMetadata: { scopePath, id, title },
  } as NotionVfsFile;
}

describe('atomic _index.json upserts (notion)', () => {
  it('preserves a competing row when two ingestions race on the same scope index', async () => {
    const { client, files, conflictCounts } = createCasClient();
    const scopePath = '/notion/databases/db_123/pages';
    const indexPath = `${scopePath}/_index.json`;

    // Pre-seed the index with a row from a hypothetical "third" writer that
    // is not in either of the racing writers' required-rows list. Under the
    // pre-CAS implementation this row would be silently clobbered by
    // whichever writer wrote last; under CAS the conflict-and-merge loop
    // preserves it.
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

    // Two concurrent ingestions of pages whose alias writes both touch
    // the same `_index.json`.
    await Promise.all([
      writeWorkspaceFiles(client as never, 'ws_test', [aliasFile(scopePath, 'a', 'Alpha')]),
      writeWorkspaceFiles(client as never, 'ws_test', [aliasFile(scopePath, 'b', 'Beta')]),
    ]);

    const index = files.get(indexPath);
    assert.ok(index, 'index file must exist after concurrent writes');
    const parsed = JSON.parse(index!.content) as {
      rows: Array<{ file: string; title: string }>;
    };
    const fileEntries = parsed.rows.map((row) => row.file).sort();

    // The seeded `extra/` row must survive both writers' upserts, and the
    // required `by-id/` and `by-title/` rows must still be present.
    assert.deepEqual(
      fileEntries,
      ['by-id/', 'by-title/', 'extra/'],
      'CAS retry loop must preserve concurrent writers and the pre-existing competing row',
    );
    // Sanity check: at least one CAS conflict occurred — proves the test
    // actually exercised the retry loop and isn't passing trivially.
    assert.ok(
      conflictCounts.writes >= 1,
      `expected at least one CAS conflict to be observed, saw ${conflictCounts.writes}`,
    );
  });
});
