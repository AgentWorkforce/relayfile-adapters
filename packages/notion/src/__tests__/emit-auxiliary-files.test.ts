import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  AuxiliaryEmitterClient,
  EmitWriteInput,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
} from '@relayfile/adapter-core';

import { emitNotionAuxiliaryFiles } from '../emit-auxiliary-files.js';
import {
  notionByIdAliasPath,
  notionByNameAliasPath,
  notionByTitleAliasPath,
  notionDatabaseMetadataPath,
  notionDatabasePagePath,
  notionDatabasesCollectionPath,
  notionDatabasesIndexPath,
  notionPageByDatabaseAliasPath,
  notionPageByParentAliasPath,
  notionPagesIndexPath,
  notionStandalonePagePath,
  notionStandalonePagesCollectionPath,
  notionUserPath,
  notionUsersCollectionPath,
  notionUsersIndexPath,
} from '../path-mapper.js';

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
}

function createClient(options: {
  initialFiles?: Record<string, string>;
  failWriteOn?: ReadonlySet<string>;
  noRead?: boolean;
  failReadOn?: ReadonlySet<string>;
} = {}): CapturingClient {
  const files = new Map<string, string>(Object.entries(options.initialFiles ?? {}));
  const writes: EmitWriteInput[] = [];
  const deletes: EmitDeleteInput[] = [];
  const reads: EmitReadInput[] = [];
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
    client.readFile = async (input): Promise<EmitReadResult | null> => {
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

// Canonical Notion UUIDs (8-4-4-4-12). Required so `aliasShortId` derives
// the deterministic short-id suffix instead of falling back to sha256.
const PAGE_A = '11111111-2222-3333-4444-555555555555';
const PAGE_B = '11111111-aaaa-bbbb-cccc-dddddddddddd';
const PAGE_C = 'cccccccc-dddd-eeee-ffff-000000000000';
const DATABASE_A = 'a1111111-2222-3333-4444-555555555555';
const DATABASE_B = 'b1111111-2222-3333-4444-555555555555';
const PARENT_PAGE_A = 'aaaa1111-2222-3333-4444-555555555555';
const PARENT_PAGE_B = 'bbbb1111-2222-3333-4444-555555555555';
const USER_A = 'd1111111-2222-3333-4444-555555555555';
const USER_B = 'e1111111-2222-3333-4444-555555555555';

const PAGES_SCOPE = notionStandalonePagesCollectionPath();
const DATABASES_SCOPE = notionDatabasesCollectionPath();
const USERS_SCOPE = notionUsersCollectionPath();

describe('emitNotionAuxiliaryFiles', () => {
  it('returns a zero result on empty input', async () => {
    const client = createClient();
    const result = await emitNotionAuxiliaryFiles(client, { workspaceId: 'ws-1' });
    assert.deepEqual(result, { written: 0, deleted: 0, errors: [] });
    assert.equal(client.writes.length, 0);
    assert.equal(client.deletes.length, 0);
  });

  it('writes canonical + by-id + by-title + by-database for a database-rooted page', async () => {
    const client = createClient();
    const page = {
      id: PAGE_A,
      title: 'Release Plan',
      parent: { type: 'database_id', database_id: DATABASE_A } as const,
      databaseTitle: 'Tasks',
    };
    const result = await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [page],
    });

    assert.deepEqual(result.errors, []);
    const writtenPaths = new Set(client.writes.map((w) => w.path));

    // Canonical: id-only, nested under the database. Titles must NOT
    // appear in the canonical filename.
    assert.ok(writtenPaths.has(notionDatabasePagePath(DATABASE_A, PAGE_A)));
    assert.ok(writtenPaths.has(notionByIdAliasPath(PAGES_SCOPE, PAGE_A)));
    assert.ok(writtenPaths.has(notionByTitleAliasPath(PAGES_SCOPE, 'Release Plan', PAGE_A)));
    assert.ok(
      writtenPaths.has(
        notionPageByDatabaseAliasPath(DATABASE_A, PAGE_A, 'Tasks', 'Release Plan'),
      ),
    );
    assert.ok(writtenPaths.has(notionPagesIndexPath()));

    // Index row reflects the page.
    const indexBytes = client.files.get(notionPagesIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{ id: string; title: string; parent_type: string; parent_id: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, PAGE_A);
    assert.equal(rows[0]!.title, 'Release Plan');
    assert.equal(rows[0]!.parent_type, 'database');
    assert.equal(rows[0]!.parent_id, DATABASE_A);
  });

  it('writes by-parent alias for a page whose parent is another page', async () => {
    const client = createClient();
    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        {
          id: PAGE_A,
          title: 'Sub Page',
          parent: { type: 'page_id', page_id: PARENT_PAGE_A } as const,
        },
      ],
    });

    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(
      writtenPaths.has(
        notionPageByParentAliasPath('page', PARENT_PAGE_A, PAGE_A, undefined, 'Sub Page'),
      ),
    );
    // Canonical falls back to the standalone path because parent_type !== 'database'.
    assert.ok(writtenPaths.has(notionStandalonePagePath(PAGE_A)));
    // No by-database alias.
    const byDatabaseEmitted = [...writtenPaths].some((p) => p.includes('/pages/by-database/'));
    assert.equal(byDatabaseEmitted, false);
  });

  it('reconciles prior by-title alias on page rename (id-only canonical stays put)', async () => {
    const priorPayload = {
      provider: 'notion',
      objectType: 'page',
      objectId: PAGE_A,
      payload: {
        id: PAGE_A,
        title: 'Old Title',
        parent_type: 'workspace',
      },
    };
    const client = createClient({
      initialFiles: {
        [notionByIdAliasPath(PAGES_SCOPE, PAGE_A)]: JSON.stringify(priorPayload),
      },
    });

    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        {
          id: PAGE_A,
          title: 'New Title',
          parent: { type: 'workspace', workspace: true } as const,
        },
      ],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    // Old by-title alias gone.
    assert.ok(deletedPaths.has(notionByTitleAliasPath(PAGES_SCOPE, 'Old Title', PAGE_A)));
    // by-id anchor stays in writes (we always re-emit it).
    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(writtenPaths.has(notionByIdAliasPath(PAGES_SCOPE, PAGE_A)));
    assert.ok(writtenPaths.has(notionByTitleAliasPath(PAGES_SCOPE, 'New Title', PAGE_A)));
    // Canonical (id-only) stays at the same path — no delete should have
    // been queued for it.
    assert.ok(!deletedPaths.has(notionStandalonePagePath(PAGE_A)));
    assert.ok(writtenPaths.has(notionStandalonePagePath(PAGE_A)));
  });

  it('reconciles prior by-title alias on page rename when the prior payload used the raw Notion API shape (title only in properties)', async () => {
    // The by-id alias was previously written from a raw Notion API
    // record: no top-level `title` field, the title lives inside
    // `properties` as a Notion rich-text array. `extractPriorPageState`
    // must mirror `readPageTitle`'s shape detection and fall back to
    // `properties`, otherwise the prior title is lost, the old by-title
    // alias is excluded from the stale-path diff, and the stale alias
    // file leaks across the rename. (Devin src:654)
    const priorPayload = {
      provider: 'notion',
      objectType: 'page',
      objectId: PAGE_A,
      payload: {
        id: PAGE_A,
        // No top-level `title` field — raw Notion API shape only.
        properties: {
          Name: {
            id: 'title',
            type: 'title',
            title: [
              { type: 'text', plain_text: 'Old Raw Title' },
            ],
          },
        },
        parent: { type: 'workspace', workspace: true },
      },
    };
    const client = createClient({
      initialFiles: {
        [notionByIdAliasPath(PAGES_SCOPE, PAGE_A)]: JSON.stringify(priorPayload),
      },
    });

    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        {
          id: PAGE_A,
          title: 'New Title',
          parent: { type: 'workspace', workspace: true } as const,
        },
      ],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    // The old by-title alias derived from the raw-shape title must be
    // queued for deletion. This is the regression guard for src:654.
    assert.ok(
      deletedPaths.has(notionByTitleAliasPath(PAGES_SCOPE, 'Old Raw Title', PAGE_A)),
      'stale by-title alias derived from raw-shape properties must be deleted',
    );
    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(writtenPaths.has(notionByTitleAliasPath(PAGES_SCOPE, 'New Title', PAGE_A)));
    // Id-only canonical stays put.
    assert.ok(!deletedPaths.has(notionStandalonePagePath(PAGE_A)));
    assert.ok(writtenPaths.has(notionStandalonePagePath(PAGE_A)));
  });

  it('reconciles prior by-database alias when a page moves between databases', async () => {
    const priorPayload = {
      payload: {
        id: PAGE_A,
        title: 'Release Plan',
        parent_id: DATABASE_A,
        parent_type: 'database',
        databaseId: DATABASE_A,
        databaseTitle: 'Old DB',
      },
    };
    const client = createClient({
      initialFiles: {
        [notionByIdAliasPath(PAGES_SCOPE, PAGE_A)]: JSON.stringify(priorPayload),
      },
    });

    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        {
          id: PAGE_A,
          title: 'Release Plan',
          parent: { type: 'database_id', database_id: DATABASE_B } as const,
          databaseTitle: 'New DB',
        },
      ],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    // Old by-database alias dropped.
    assert.ok(
      deletedPaths.has(
        notionPageByDatabaseAliasPath(DATABASE_A, PAGE_A, 'Old DB', 'Release Plan'),
      ),
    );
    // Old canonical (under old database) dropped.
    assert.ok(deletedPaths.has(notionDatabasePagePath(DATABASE_A, PAGE_A)));

    // New canonical + new by-database alias emitted.
    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(writtenPaths.has(notionDatabasePagePath(DATABASE_B, PAGE_A)));
    assert.ok(
      writtenPaths.has(
        notionPageByDatabaseAliasPath(DATABASE_B, PAGE_A, 'New DB', 'Release Plan'),
      ),
    );
  });

  it('reconciles prior by-parent alias when a child page moves between parent pages', async () => {
    const priorPayload = {
      payload: {
        id: PAGE_A,
        title: 'Sub Page',
        parent_id: PARENT_PAGE_A,
        parent_type: 'page',
      },
    };
    const client = createClient({
      initialFiles: {
        [notionByIdAliasPath(PAGES_SCOPE, PAGE_A)]: JSON.stringify(priorPayload),
      },
    });

    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        {
          id: PAGE_A,
          title: 'Sub Page',
          parent: { type: 'page_id', page_id: PARENT_PAGE_B } as const,
        },
      ],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    assert.ok(
      deletedPaths.has(
        notionPageByParentAliasPath('page', PARENT_PAGE_A, PAGE_A, undefined, 'Sub Page'),
      ),
    );
    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(
      writtenPaths.has(
        notionPageByParentAliasPath('page', PARENT_PAGE_B, PAGE_A, undefined, 'Sub Page'),
      ),
    );
  });

  it('emits database canonical + by-id + by-title (id-only canonical)', async () => {
    const client = createClient();
    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      databases: [{ id: DATABASE_A, title: 'Engineering' }],
    });

    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(writtenPaths.has(notionDatabaseMetadataPath(DATABASE_A)));
    assert.ok(writtenPaths.has(notionByIdAliasPath(DATABASES_SCOPE, DATABASE_A)));
    assert.ok(
      writtenPaths.has(notionByTitleAliasPath(DATABASES_SCOPE, 'Engineering', DATABASE_A)),
    );
    assert.ok(writtenPaths.has(notionDatabasesIndexPath()));
  });

  it('emits user canonical (id-only) + by-id + by-name, sets is_bot on index row when type=bot', async () => {
    const client = createClient();
    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [
        { id: USER_A, name: 'Alice Chen', type: 'person' },
        { id: USER_B, name: 'Linear Bot', type: 'bot' },
      ],
    });

    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(writtenPaths.has(notionUserPath(USER_A)));
    assert.ok(writtenPaths.has(notionByIdAliasPath(USERS_SCOPE, USER_A)));
    assert.ok(writtenPaths.has(notionByNameAliasPath(USERS_SCOPE, 'Alice Chen', USER_A)));
    assert.ok(writtenPaths.has(notionUserPath(USER_B)));
    assert.ok(writtenPaths.has(notionByNameAliasPath(USERS_SCOPE, 'Linear Bot', USER_B)));

    // Canonical for both users is id-only — the user-path helper does
    // accept a name but we deliberately pass undefined so renames don't
    // strand the file.
    assert.ok(!writtenPaths.has(notionUserPath(USER_A, 'Alice Chen')) || notionUserPath(USER_A) === notionUserPath(USER_A, 'Alice Chen'));

    const indexBytes = client.files.get(notionUsersIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{ id: string; title: string; is_bot: boolean }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get(USER_A)!.is_bot, false);
    assert.equal(byId.get(USER_B)!.is_bot, true);
  });

  it('updates by-name alias on user rename, keeps id-only canonical stable', async () => {
    const priorPayload = {
      payload: { id: USER_A, name: 'Old Name', type: 'person' },
    };
    const client = createClient({
      initialFiles: {
        [notionByIdAliasPath(USERS_SCOPE, USER_A)]: JSON.stringify(priorPayload),
      },
    });

    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [{ id: USER_A, name: 'New Name', type: 'person' }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    assert.ok(deletedPaths.has(notionByNameAliasPath(USERS_SCOPE, 'Old Name', USER_A)));
    // Canonical (id-only) was NOT deleted on rename — that's the Devin
    // finding for users (mutable names + tombstones with only `id`).
    assert.ok(!deletedPaths.has(notionUserPath(USER_A)));

    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(writtenPaths.has(notionByNameAliasPath(USERS_SCOPE, 'New Name', USER_A)));
    assert.ok(writtenPaths.has(notionUserPath(USER_A)));
  });

  it('drops the index row when a page is deleted (no ghost _index entries)', async () => {
    const priorPagePayload = {
      payload: {
        id: PAGE_A,
        title: 'Release Plan',
        parent_id: DATABASE_A,
        parent_type: 'database',
        databaseId: DATABASE_A,
        databaseTitle: 'Tasks',
      },
    };
    const priorIndex = [
      { id: PAGE_A, title: 'Release Plan', updated: '2026-05-12T00:00:00Z', parent_id: DATABASE_A, parent_type: 'database' },
      { id: PAGE_B, title: 'Other', updated: '2026-05-11T00:00:00Z', parent_id: null, parent_type: 'workspace' },
    ];
    const client = createClient({
      initialFiles: {
        [notionByIdAliasPath(PAGES_SCOPE, PAGE_A)]: JSON.stringify(priorPagePayload),
        [notionPagesIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [{ id: PAGE_A, _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    // Canonical (under db), by-id, by-title, by-database all gone.
    assert.ok(deletedPaths.has(notionDatabasePagePath(DATABASE_A, PAGE_A)));
    assert.ok(deletedPaths.has(notionByIdAliasPath(PAGES_SCOPE, PAGE_A)));
    assert.ok(deletedPaths.has(notionByTitleAliasPath(PAGES_SCOPE, 'Release Plan', PAGE_A)));
    assert.ok(
      deletedPaths.has(
        notionPageByDatabaseAliasPath(DATABASE_A, PAGE_A, 'Tasks', 'Release Plan'),
      ),
    );

    const indexWrite = client.writes.find((w) => w.path === notionPagesIndexPath());
    assert.ok(indexWrite, 'expected an index write to prune the deleted row');
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(writtenRows.map((r) => r.id), [PAGE_B]);
  });

  it('drops the index row when a database is deleted', async () => {
    const priorPayload = { payload: { title: 'Engineering' } };
    const priorIndex = [
      { id: DATABASE_A, title: 'Engineering', updated: '2026-05-12T00:00:00Z', parent_id: null, parent_type: 'workspace' },
      { id: DATABASE_B, title: 'Other', updated: '2026-05-11T00:00:00Z', parent_id: null, parent_type: 'workspace' },
    ];
    const client = createClient({
      initialFiles: {
        [notionByIdAliasPath(DATABASES_SCOPE, DATABASE_A)]: JSON.stringify(priorPayload),
        [notionDatabasesIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      databases: [{ id: DATABASE_A, _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    assert.ok(deletedPaths.has(notionDatabaseMetadataPath(DATABASE_A)));
    assert.ok(deletedPaths.has(notionByIdAliasPath(DATABASES_SCOPE, DATABASE_A)));
    assert.ok(deletedPaths.has(notionByTitleAliasPath(DATABASES_SCOPE, 'Engineering', DATABASE_A)));

    const indexWrite = client.writes.find((w) => w.path === notionDatabasesIndexPath());
    assert.ok(indexWrite);
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(writtenRows.map((r) => r.id), [DATABASE_B]);
  });

  it('drops the index row when a user is deleted', async () => {
    const priorPayload = { payload: { id: USER_A, name: 'Alice', type: 'person' } };
    const priorIndex = [
      { id: USER_A, title: 'Alice', updated: '2026-05-12T00:00:00Z', is_bot: false },
      { id: USER_B, title: 'Bot', updated: '2026-05-11T00:00:00Z', is_bot: true },
    ];
    const client = createClient({
      initialFiles: {
        [notionByIdAliasPath(USERS_SCOPE, USER_A)]: JSON.stringify(priorPayload),
        [notionUsersIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [{ id: USER_A, _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    assert.ok(deletedPaths.has(notionUserPath(USER_A)));
    assert.ok(deletedPaths.has(notionByIdAliasPath(USERS_SCOPE, USER_A)));
    assert.ok(deletedPaths.has(notionByNameAliasPath(USERS_SCOPE, 'Alice', USER_A)));

    const indexWrite = client.writes.find((w) => w.path === notionUsersIndexPath());
    assert.ok(indexWrite);
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(writtenRows.map((r) => r.id), [USER_B]);
  });

  it('keeps distinct by-title paths for same-title pages with different UUIDs (collision-safe naming)', async () => {
    const client = createClient();
    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [
        { id: PAGE_A, title: 'Roadmap' },
        { id: PAGE_C, title: 'Roadmap' },
      ],
    });

    const writtenPaths = new Set(client.writes.map((w) => w.path));
    const aliasA = notionByTitleAliasPath(PAGES_SCOPE, 'Roadmap', PAGE_A);
    const aliasC = notionByTitleAliasPath(PAGES_SCOPE, 'Roadmap', PAGE_C);
    // Different short-id suffixes — paths must not collide.
    assert.notEqual(aliasA, aliasC);
    assert.ok(writtenPaths.has(aliasA));
    assert.ok(writtenPaths.has(aliasC));
  });

  it('skips reconciliation when the client has no readFile but still emits the new alias set', async () => {
    const client = createClient({ noRead: true });
    await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [{ id: PAGE_A, title: 'Release Plan' }],
    });

    assert.equal(client.deletes.length, 0);
    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(writtenPaths.has(notionByIdAliasPath(PAGES_SCOPE, PAGE_A)));
    assert.ok(writtenPaths.has(notionByTitleAliasPath(PAGES_SCOPE, 'Release Plan', PAGE_A)));
    // Index still flushed.
    assert.ok(writtenPaths.has(notionPagesIndexPath()));
  });

  it('captures per-path write failures without aborting the fan-out', async () => {
    const failingPath = notionByTitleAliasPath(PAGES_SCOPE, 'Release Plan', PAGE_A);
    const client = createClient({ failWriteOn: new Set([failingPath]) });

    const result = await emitNotionAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pages: [{ id: PAGE_A, title: 'Release Plan' }],
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.path, failingPath);
    // by-id and canonical still landed.
    assert.ok(client.files.has(notionByIdAliasPath(PAGES_SCOPE, PAGE_A)));
    assert.ok(client.files.has(notionStandalonePagePath(PAGE_A)));
  });
});
