import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emitConfluenceAuxiliaryFiles } from '../emit-auxiliary-files.js';
import type { RelayFileClientLike, WriteFileInput, DeleteFileInput, ReadFileInput, ReadFileResult } from '../types.js';
import {
  confluencePageByIdAliasPath,
  confluencePageByEditedPath,
  confluencePageByParentAliasPath,
  confluencePageBySpaceAliasPath,
  confluencePageByStatePath,
  confluencePageByTitleAliasPath,
  confluencePagePath,
  confluencePagesIndexPath,
  confluenceRootIndexPath,
  confluenceSpaceByIdAliasPath,
  confluenceSpaceByKeyAliasPath,
  confluenceSpaceByTitleAliasPath,
  confluenceSpacePath,
  confluenceSpacesIndexPath,
} from '../path-mapper.js';

interface CapturingClient extends RelayFileClientLike {
  writes: WriteFileInput[];
  deletes: DeleteFileInput[];
  reads: ReadFileInput[];
  files: Map<string, string>;
}

function createClient(options: {
  initialFiles?: Record<string, string>;
  failWriteOn?: ReadonlySet<string>;
  noRead?: boolean;
  failReadOn?: ReadonlySet<string>;
} = {}): CapturingClient {
  const files = new Map<string, string>(Object.entries(options.initialFiles ?? {}));
  const writes: WriteFileInput[] = [];
  const deletes: DeleteFileInput[] = [];
  const reads: ReadFileInput[] = [];
  const failWriteOn = options.failWriteOn ?? new Set<string>();
  const failReadOn = options.failReadOn ?? new Set<string>();

  const client: CapturingClient = {
    writes,
    deletes,
    reads,
    files,
    async writeFile(input) {
      writes.push(input);
      if (failWriteOn.has(input.path)) {
        throw new Error(`forced write failure at ${input.path}`);
      }
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      deletes.push(input);
      files.delete(input.path);
    },
  };
  if (!options.noRead) {
    client.readFile = async (input): Promise<ReadFileResult | null> => {
      reads.push(input);
      if (failReadOn.has(input.path)) {
        throw new Error(`forced read failure at ${input.path}`);
      }
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    };
  }
  return client;
}

describe('emitConfluenceAuxiliaryFiles', () => {
  it('always writes /confluence/_index.json root index on empty input', async () => {
    const client = createClient();
    const result = await emitConfluenceAuxiliaryFiles(client, { workspaceId: 'ws-1' });
    assert.deepEqual(result.errors, []);
    assert.equal(result.deleted, 0);
    assert.equal(result.written, 1);
    assert.equal(client.writes.length, 1);
    assert.equal(client.writes[0]!.path, confluenceRootIndexPath());
    const rows = JSON.parse(client.files.get(confluenceRootIndexPath())!);
    assert.deepEqual(rows, [
      { id: 'pages', title: 'Pages' },
      { id: 'spaces', title: 'Spaces' },
    ]);
    assert.equal(client.deletes.length, 0);
  });

  it('emits /confluence/_index.json alongside non-empty buckets', async () => {
    const client = createClient();
    await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      spaces: [{ id: 'sp-1', name: 'Engineering' }],
    });
    assert.ok(
      client.writes.some((w) => w.path === confluenceRootIndexPath()),
      'expected /confluence/_index.json root index write',
    );
  });

  it('writes the canonical path plus every applicable page alias plus the index row', async () => {
    const client = createClient();
    const page = {
      id: '98765',
      title: 'Release Plan',
      status: 'current',
      spaceId: '12345',
      parentId: '54321',
      version: { createdAt: '2026-05-12T08:15:00.000Z' },
    };
    const result = await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [page],
    });

    // Page emits 7 files (canonical + by-id + by-title + by-state + by-space + by-parent + by-edited),
    // plus 1 pages index write, plus 1 root index write.
    assert.equal(result.written, 9);
    assert.deepEqual(result.errors, []);

    const expectedPaths = [
      confluencePagePath('98765', 'Release Plan', '12345'),
      confluencePageByIdAliasPath('98765'),
      confluencePageByTitleAliasPath('Release Plan', '98765'),
      confluencePageByStatePath('current', '98765'),
      confluencePageByEditedPath('2026-05-12', '98765'),
      confluencePageBySpaceAliasPath('12345', '98765'),
      confluencePageByParentAliasPath('54321', '98765'),
      confluencePagesIndexPath(),
    ];
    const writtenPaths = client.writes.map((w) => w.path);
    for (const expected of expectedPaths) {
      assert.ok(writtenPaths.includes(expected), `missing expected path ${expected}`);
    }

    // Index row contains the page.
    const indexBytes = client.files.get(confluencePagesIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{ id: string; title: string; spaceId: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, '98765');
    assert.equal(rows[0]!.title, 'Release Plan');
    assert.equal(rows[0]!.spaceId, '12345');

    // Canonical bytes are identical at every emitted alias path.
    const canonicalBytes = client.files.get(confluencePagePath('98765', 'Release Plan', '12345'));
    for (const path of expectedPaths) {
      if (path === confluencePagesIndexPath()) continue;
      assert.equal(client.files.get(path), canonicalBytes, `bytes mismatch at ${path}`);
    }
  });

  it('reconciles prior by-title alias on page rename via the by-id anchor', async () => {
    // Seed the by-id alias as if a prior write had landed under the old title.
    const priorPayload = {
      provider: 'confluence',
      objectType: 'page',
      objectId: '98765',
      deleted: false,
      payload: {
        id: '98765',
        title: 'Old Title',
        status: 'current',
        spaceId: '12345',
        version: { createdAt: '2026-05-11T00:00:00.000Z' },
      },
    };
    const client = createClient({
      initialFiles: {
        [confluencePageByIdAliasPath('98765')]: JSON.stringify(priorPayload),
      },
    });

    const result = await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        {
          id: '98765',
          title: 'New Title',
          status: 'current',
          spaceId: '12345',
          version: { createdAt: '2026-05-12T00:00:00.000Z' },
        },
      ],
    });

    // The prior by-title alias and prior canonical (title-derived) path should
    // be in the deletes (they no longer apply). by-id stays because it's the
    // anchor and didn't change.
    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(confluencePageByTitleAliasPath('Old Title', '98765')),
      `expected prior by-title alias in deletes, got: ${deletedPaths.join(', ')}`,
    );
    assert.ok(
      deletedPaths.includes(confluencePagePath('98765', 'Old Title', '12345')),
      `expected prior canonical path in deletes`,
    );
    assert.ok(
      deletedPaths.includes(confluencePageByEditedPath('2026-05-11', '98765')),
      `expected prior by-edited alias in deletes`,
    );
    // by-id stays (no rename impact).
    assert.ok(!deletedPaths.includes(confluencePageByIdAliasPath('98765')));

    // The new by-title alias and new canonical path landed.
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(confluencePageByTitleAliasPath('New Title', '98765')));
    assert.ok(writtenPaths.includes(confluencePagePath('98765', 'New Title', '12345')));
    assert.ok(writtenPaths.includes(confluencePageByEditedPath('2026-05-12', '98765')));

    assert.deepEqual(result.errors, []);
  });

  it('writes by-key alias for spaces when a key is present', async () => {
    const client = createClient();
    await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      spaces: [
        { id: '777', name: 'Engineering', key: 'ENG' },
      ],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(confluenceSpacePath('777', 'Engineering')));
    assert.ok(writtenPaths.includes(confluenceSpaceByIdAliasPath('777')));
    assert.ok(writtenPaths.includes(confluenceSpaceByTitleAliasPath('Engineering', '777')));
    assert.ok(writtenPaths.includes(confluenceSpaceByKeyAliasPath('ENG')));
    assert.ok(writtenPaths.includes(confluenceSpacesIndexPath()));
  });

  it('delete tombstone reads prior by-id alias and removes every previously emitted path', async () => {
    const priorPayload = {
      provider: 'confluence',
      objectType: 'page',
      objectId: '98765',
      deleted: false,
      payload: {
        id: '98765',
        title: 'Release Plan',
        status: 'current',
        spaceId: '12345',
        parentId: '54321',
      },
    };
    const client = createClient({
      initialFiles: {
        [confluencePageByIdAliasPath('98765')]: JSON.stringify(priorPayload),
      },
    });

    const result = await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [{ id: '98765', _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    const expectedDeletes = [
      confluencePagePath('98765', 'Release Plan', '12345'),
      confluencePageByIdAliasPath('98765'),
      confluencePageByTitleAliasPath('Release Plan', '98765'),
      confluencePageByStatePath('current', '98765'),
      confluencePageBySpaceAliasPath('12345', '98765'),
      confluencePageByParentAliasPath('54321', '98765'),
    ];
    for (const path of expectedDeletes) {
      assert.ok(deletedPaths.has(path), `expected delete at ${path}`);
    }

    // No content writes happened for the tombstone, but the index file
    // flush still runs (with 0 mutations queued, so no write). The root
    // `/confluence/_index.json` is also written unconditionally.
    const contentWrites = client.writes.filter(
      (w) =>
        w.path !== confluencePagesIndexPath() &&
        w.path !== confluenceRootIndexPath(),
    );
    assert.equal(contentWrites.length, 0);
    assert.equal(result.deleted, expectedDeletes.length);
  });

  it('drops the index row when a page is deleted (no ghost entries)', async () => {
    // Regression for the Devin finding on PR #78: planPageDelete used to
    // remove canonical + alias files but leave the index row in place, so
    // `_index.json` accumulated entries for records whose meta.json had
    // already been deleted. The reconciler must `.remove(id)` on the
    // delete path too.
    const priorPagePayload = {
      payload: {
        title: 'Release Plan',
        status: 'current',
        spaceId: '12345',
      },
    };
    const priorIndex = [
      { id: '98765', title: 'Release Plan', updated: '2026-05-12T00:00:00Z', status: 'current' },
      { id: '11111', title: 'Other Page', updated: '2026-05-11T00:00:00Z', status: 'current' },
    ];
    const client = createClient({
      initialFiles: {
        [confluencePageByIdAliasPath('98765')]: JSON.stringify(priorPagePayload),
        [confluencePagesIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [{ id: '98765', _deleted: true }],
    });

    // The index file got rewritten — without the deleted row but with
    // the surviving entry intact.
    const indexWrite = client.writes.find((w) => w.path === confluencePagesIndexPath());
    assert.ok(indexWrite, 'expected an index write after delete to prune the row');
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(
      writtenRows.map((r) => r.id),
      ['11111'],
      'deleted page id should no longer appear in the index',
    );
  });

  it('drops the index row when a space is deleted', async () => {
    // Same regression as above, for spaces. planSpaceDelete must also
    // `.remove(id)` on the index reconciler.
    const priorSpacePayload = {
      payload: { name: 'Engineering', key: 'ENG' },
    };
    const priorIndex = [
      { id: '12345', title: 'Engineering', updated: '2026-05-12T00:00:00Z', key: 'ENG' },
      { id: '22222', title: 'Marketing', updated: '2026-05-11T00:00:00Z', key: 'MKT' },
    ];
    const client = createClient({
      initialFiles: {
        [confluenceSpaceByIdAliasPath('12345')]: JSON.stringify(priorSpacePayload),
        [confluenceSpacesIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      spaces: [{ id: '12345', _deleted: true }],
    });

    const indexWrite = client.writes.find((w) => w.path === confluenceSpacesIndexPath());
    assert.ok(indexWrite, 'expected an index write after delete to prune the row');
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(
      writtenRows.map((r) => r.id),
      ['22222'],
      'deleted space id should no longer appear in the index',
    );
  });

  it('captures per-path write failures in errors without aborting the fan-out', async () => {
    const failingPath = confluencePageByTitleAliasPath('Release Plan', '98765');
    const client = createClient({ failWriteOn: new Set([failingPath]) });

    const result = await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        {
          id: '98765',
          title: 'Release Plan',
          status: 'current',
          spaceId: '12345',
        },
      ],
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.path, failingPath);
    assert.match(result.errors[0]!.error, /forced write failure/);

    // The remaining alias paths landed, including by-id (the anchor).
    assert.ok(client.files.has(confluencePageByIdAliasPath('98765')));
    assert.ok(client.files.has(confluencePageByStatePath('current', '98765')));
    assert.ok(client.files.has(confluencePagesIndexPath()));
  });

  it('skips reconciliation when the client has no readFile but still emits new aliases', async () => {
    const client = createClient({ noRead: true });
    const result = await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        { id: '98765', title: 'Release Plan', status: 'current', spaceId: '12345' },
      ],
    });

    // No reconciliation deletes were attempted because there was no prior
    // state to read (and reads aren't supported anyway). The index file
    // also can't be merged with existing rows; it gets stomped with just
    // this batch.
    assert.equal(client.deletes.length, 0);
    assert.deepEqual(result.errors, []);

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(confluencePageByIdAliasPath('98765')));
    assert.ok(writtenPaths.includes(confluencePageByTitleAliasPath('Release Plan', '98765')));
  });

  it('non-fatally swallows reconciliation read errors and proceeds with the write batch', async () => {
    const client = createClient({
      failReadOn: new Set([confluencePageByIdAliasPath('98765')]),
    });

    const result = await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        { id: '98765', title: 'Release Plan', status: 'current', spaceId: '12345' },
      ],
    });

    // Reconciliation read failed → no stale paths computed → no deletes
    // attempted → write fan-out proceeds.
    assert.equal(client.deletes.length, 0);
    assert.deepEqual(result.errors, []);
    assert.ok(client.files.has(confluencePagePath('98765', 'Release Plan', '12345')));
  });

  it('skips by-title alias for emoji-only / punctuation-only titles', async () => {
    const client = createClient();
    await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [{ id: '111', title: '🚀!!!' }],
    });
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(confluencePageByIdAliasPath('111')));
    // No by-title alias because the slug would collapse to empty.
    const byTitleEmitted = writtenPaths.some(
      (p) => p.includes('/by-title/') && p.includes('111'),
    );
    assert.equal(byTitleEmitted, false);
  });

  it('handles mixed page batches with create + delete + rename in one call', async () => {
    const priorRenamePayload = {
      provider: 'confluence',
      objectType: 'page',
      objectId: '200',
      payload: { id: '200', title: 'Old', spaceId: 'S1', status: 'current' },
    };
    const priorDeletePayload = {
      provider: 'confluence',
      objectType: 'page',
      objectId: '300',
      payload: { id: '300', title: 'Doomed', spaceId: 'S1', status: 'current' },
    };
    const client = createClient({
      initialFiles: {
        [confluencePageByIdAliasPath('200')]: JSON.stringify(priorRenamePayload),
        [confluencePageByIdAliasPath('300')]: JSON.stringify(priorDeletePayload),
      },
    });

    const result = await emitConfluenceAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        { id: '100', title: 'New Page', spaceId: 'S1', status: 'current' },
        { id: '200', title: 'Renamed', spaceId: 'S1', status: 'current' },
        { id: '300', _deleted: true },
      ],
    });

    // All three records contributed paths to writes or deletes.
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(confluencePageByIdAliasPath('100')));
    assert.ok(writtenPaths.includes(confluencePageByIdAliasPath('200')));
    // No write for the deleted record's by-id path.
    assert.ok(!writtenPaths.includes(confluencePagePath('300', 'Doomed', 'S1')));

    const deletedPaths = client.deletes.map((d) => d.path);
    // Renamed page's old by-title alias is in deletes.
    assert.ok(deletedPaths.includes(confluencePageByTitleAliasPath('Old', '200')));
    // Deleted page's by-id alias is in deletes.
    assert.ok(deletedPaths.includes(confluencePageByIdAliasPath('300')));

    assert.deepEqual(result.errors, []);
  });
});
