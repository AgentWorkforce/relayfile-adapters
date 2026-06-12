import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ConnectionProvider, ProxyResponse } from '@relayfile/sdk';
import {
  ConfluenceAdapter,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../confluence-adapter.js';
import {
  computeConfluencePath,
  confluencePageByIdAliasPath,
  confluencePageByParentAliasPath,
  confluencePageBySpaceAliasPath,
  confluencePageByStatePath,
  confluencePageByTitleAliasPath,
  confluencePagePath,
  confluenceSpaceByIdAliasPath,
  confluenceSpaceByKeyAliasPath,
  confluenceSpaceByTitleAliasPath,
  confluenceSpacePath,
} from '../path-mapper.js';
import { resolveConfluenceReadRequest } from '../queries.js';
import {
  ReadOnlyFieldError,
  resolveConfluenceDeleteRequest,
  resolveConfluenceWritebackRequest,
} from '../writeback.js';

interface CapturingClient extends RelayFileClientLike {
  writes: WriteFileInput[];
  deletes: Array<{ workspaceId: string; path: string }>;
}

function createClient(): CapturingClient {
  return {
    writes: [],
    deletes: [],
    async writeFile(input) {
      this.writes.push(input);
      return { created: true };
    },
    async deleteFile(input) {
      this.deletes.push(input);
    },
  };
}

function createAdapter(client = createClient()): ConfluenceAdapter {
  const provider: ConnectionProvider = {
    name: 'confluence',
    async proxy<T = unknown>(): Promise<ProxyResponse<T>> {
      return { status: 200, headers: {}, data: {} as T };
    },
    async healthCheck() {
      return true;
    },
  };
  return new ConfluenceAdapter(client, provider, { connectionId: 'conn-confluence' });
}

describe('ConfluenceAdapter', () => {
  it('computes deterministic Confluence paths', () => {
    assert.equal(
      computeConfluencePath('space', '12345', { title: 'Engineering Docs' }),
      '/confluence/spaces/engineering-docs__12345.json',
    );
    assert.equal(
      computeConfluencePath('page', '98765', { title: 'Release Plan', spaceId: '12345' }),
      '/confluence/spaces/12345/pages/release-plan__98765.json',
    );
  });

  it('materializes spaces and pages from Nango-style sync records', () => {
    const adapter = createAdapter();
    assert.deepEqual(adapter.materializeSpace({ id: '12345', key: 'ENG', name: 'Engineering' }), {
      path: '/confluence/spaces/engineering__12345.json',
      payload: {
        provider: 'confluence',
        objectType: 'space',
        objectId: '12345',
        payload: { id: '12345', key: 'ENG', name: 'Engineering' },
      },
    });

    assert.equal(
      adapter.materializePage({ id: '98765', title: 'Release Plan', spaceId: '12345' }).path,
      '/confluence/spaces/12345/pages/release-plan__98765.json',
    );
  });

  it('ingests page events with space relations, body comments, and by-* alias fan-out', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      provider: 'confluence',
      eventType: 'page.updated',
      objectType: 'page',
      objectId: '98765',
      payload: {
        id: '98765',
        title: 'Release Plan',
        status: 'current',
        spaceId: '12345',
        parentId: '44444',
        body: { storage: { value: '<p>Ship carefully.</p>', representation: 'storage' } },
      },
    });

    const canonicalPath = '/confluence/spaces/12345/pages/release-plan__98765.json';
    const expectedAliasPaths = [
      confluencePageByIdAliasPath('98765'),
      confluencePageByTitleAliasPath('Release Plan', '98765'),
      confluencePageByStatePath('current', '98765'),
      confluencePageBySpaceAliasPath('12345', '98765'),
      confluencePageByParentAliasPath('44444', '98765'),
    ];

    // Canonical record + every applicable alias path are written with identical
    // bytes — readers can pick whichever lookup primitive they have.
    assert.equal(result.filesWritten, 1 + expectedAliasPaths.length);
    assert.deepEqual(result.paths, [canonicalPath, ...expectedAliasPaths]);

    const canonicalContent = client.writes.find((write) => write.path === canonicalPath)?.content;
    assert.ok(canonicalContent, 'canonical content must be present');
    for (const aliasPath of expectedAliasPaths) {
      const aliasWrite = client.writes.find((write) => write.path === aliasPath);
      assert.ok(aliasWrite, `alias ${aliasPath} must be written`);
      assert.equal(aliasWrite?.content, canonicalContent, `alias ${aliasPath} bytes must match canonical`);
    }

    assert.deepEqual(client.writes[0]?.semantics?.relations, [
      confluenceSpacePath('12345'),
      confluencePagePath('44444'),
    ]);
    assert.equal(client.writes[0]?.semantics?.comments?.[0], 'Ship carefully.');
  });

  it('skips by-title alias when the page title slugs to nothing', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    await adapter.ingestWebhook('workspace-1', {
      provider: 'confluence',
      eventType: 'page.created',
      objectType: 'page',
      objectId: '11111',
      payload: { id: '11111', title: '🚀🔥', status: 'current', spaceId: '12345' },
    });

    // by-id, by-state, by-space — no by-title, no by-parent.
    const aliasPaths = client.writes.map((write) => write.path).filter((path) => path.includes('/by-'));
    assert.deepEqual(aliasPaths, [
      confluencePageByIdAliasPath('11111'),
      confluencePageByStatePath('current', '11111'),
      confluencePageBySpaceAliasPath('12345', '11111'),
    ]);
  });

  it('emits space by-id, by-title, and by-key aliases on space ingest', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    await adapter.ingestWebhook('workspace-1', {
      provider: 'confluence',
      eventType: 'space.updated',
      objectType: 'space',
      objectId: '12345',
      payload: { id: '12345', key: 'ENG', name: 'Engineering' },
    });

    const canonicalPath = '/confluence/spaces/engineering__12345.json';
    const expectedAliasPaths = [
      confluenceSpaceByIdAliasPath('12345'),
      confluenceSpaceByTitleAliasPath('Engineering', '12345'),
      confluenceSpaceByKeyAliasPath('ENG'),
    ];

    assert.deepEqual(client.writes.map((write) => write.path), [canonicalPath, ...expectedAliasPaths]);
  });

  it('deletes the canonical path and every alias on a delete event', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      provider: 'confluence',
      eventType: 'page.deleted',
      objectType: 'page',
      objectId: '98765',
      payload: { id: '98765', title: 'Release Plan', status: 'current', spaceId: '12345' },
    });

    const canonicalPath = '/confluence/spaces/12345/pages/release-plan__98765.json';
    const expectedAliasPaths = [
      confluencePageByIdAliasPath('98765'),
      confluencePageByTitleAliasPath('Release Plan', '98765'),
      confluencePageByStatePath('current', '98765'),
      confluencePageBySpaceAliasPath('12345', '98765'),
    ];

    assert.equal(result.filesDeleted, 1 + expectedAliasPaths.length);
    assert.deepEqual(client.deletes.map((d) => d.path), [canonicalPath, ...expectedAliasPaths]);
  });

  it('materializePageFiles returns the canonical path plus every applicable alias', () => {
    const adapter = createAdapter();
    const { paths } = adapter.materializePageFiles({
      id: '98765',
      title: 'Release Plan',
      status: 'current',
      spaceId: '12345',
      parentId: '44444',
    });

    assert.deepEqual(paths, [
      '/confluence/spaces/12345/pages/release-plan__98765.json',
      confluencePageByIdAliasPath('98765'),
      confluencePageByTitleAliasPath('Release Plan', '98765'),
      confluencePageByStatePath('current', '98765'),
      confluencePageBySpaceAliasPath('12345', '98765'),
      confluencePageByParentAliasPath('44444', '98765'),
    ]);
  });

  it('materializeSpaceFiles returns the canonical path plus every applicable alias', () => {
    const adapter = createAdapter();
    const { paths } = adapter.materializeSpaceFiles({
      id: '12345',
      key: 'ENG',
      name: 'Engineering',
    });

    assert.deepEqual(paths, [
      '/confluence/spaces/engineering__12345.json',
      confluenceSpaceByIdAliasPath('12345'),
      confluenceSpaceByTitleAliasPath('Engineering', '12345'),
      confluenceSpaceByKeyAliasPath('ENG'),
    ]);
  });

  it('continues fanning out aliases when one writeFile throws and reports the failed path', async () => {
    // A mid-loop throw used to abandon the rest of the fan-out, leaving the
    // canonical record and earlier aliases written but later aliases missing.
    // Now each write is independent: the canonical + the surviving aliases
    // land, the bad path is reported in `errors`, and the caller can retry
    // just that path.
    const failingPath = confluencePageByTitleAliasPath('Release Plan', '98765');
    const client: CapturingClient = {
      writes: [],
      deletes: [],
      async writeFile(input) {
        if (input.path === failingPath) {
          throw new Error('synthetic backend error');
        }
        this.writes.push(input);
        return { created: true };
      },
      async deleteFile(input) {
        this.deletes.push(input);
      },
    };
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      provider: 'confluence',
      eventType: 'page.updated',
      objectType: 'page',
      objectId: '98765',
      payload: { id: '98765', title: 'Release Plan', status: 'current', spaceId: '12345' },
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.path, failingPath);
    assert.match(result.errors[0]!.error, /synthetic backend error/);

    const expectedWrittenPaths = [
      '/confluence/spaces/12345/pages/release-plan__98765.json',
      confluencePageByIdAliasPath('98765'),
      confluencePageByStatePath('current', '98765'),
      confluencePageBySpaceAliasPath('12345', '98765'),
    ];
    assert.deepEqual(client.writes.map((w) => w.path), expectedWrittenPaths);
    assert.deepEqual(result.paths, expectedWrittenPaths);
  });

  it('deletes stale aliases on rename via the by-id reconciliation path', async () => {
    // When an alias-driving field changes (here: title), the prior alias
    // paths (`by-title/release-plan__98765.json` and the old canonical
    // `release-plan__98765.json`) become orphans. Reconciliation reads the
    // stable by-id alias to recover the prior payload, computes the prior
    // alias set, and deletes the diff before writing the new alias set.
    const priorPayload = { id: '98765', title: 'Release Plan', status: 'current', spaceId: '12345' };
    const priorWrapper = {
      provider: 'confluence',
      workspaceId: 'workspace-1',
      objectType: 'page',
      objectId: '98765',
      deleted: false,
      payload: priorPayload,
      connectionId: 'conn-confluence',
    };
    const reads: Array<{ workspaceId: string; path: string }> = [];
    const client: CapturingClient & {
      readFile: (input: { workspaceId: string; path: string }) => Promise<{ content: string } | null>;
    } = {
      writes: [],
      deletes: [],
      async writeFile(input) {
        this.writes.push(input);
        return { updated: true };
      },
      async deleteFile(input) {
        this.deletes.push(input);
      },
      async readFile(input) {
        reads.push(input);
        if (input.path === confluencePageByIdAliasPath('98765')) {
          return { content: JSON.stringify(priorWrapper, null, 2) };
        }
        return null;
      },
    };
    const adapter = createAdapter(client);

    await adapter.ingestWebhook('workspace-1', {
      provider: 'confluence',
      eventType: 'page.updated',
      objectType: 'page',
      objectId: '98765',
      payload: { id: '98765', title: 'Launch Plan', status: 'current', spaceId: '12345' },
    });

    // The reconciliation read targeted the stable by-id path.
    assert.deepEqual(reads, [{ workspaceId: 'workspace-1', path: confluencePageByIdAliasPath('98765') }]);

    // Stale paths from the prior title were deleted: old canonical + old by-title.
    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    assert.ok(deletedPaths.has('/confluence/spaces/12345/pages/release-plan__98765.json'),
      'expected old canonical path to be deleted');
    assert.ok(deletedPaths.has(confluencePageByTitleAliasPath('Release Plan', '98765')),
      'expected old by-title alias to be deleted');

    // The stable by-id, by-state, by-space aliases are unchanged → not deleted.
    assert.ok(!deletedPaths.has(confluencePageByIdAliasPath('98765')));
    assert.ok(!deletedPaths.has(confluencePageByStatePath('current', '98765')));
    assert.ok(!deletedPaths.has(confluencePageBySpaceAliasPath('12345', '98765')));

    // New canonical + new by-title written.
    const writtenPaths = new Set(client.writes.map((w) => w.path));
    assert.ok(writtenPaths.has('/confluence/spaces/12345/pages/launch-plan__98765.json'));
    assert.ok(writtenPaths.has(confluencePageByTitleAliasPath('Launch Plan', '98765')));
  });

  it('skips reconciliation when client has no readFile (legacy adapters keep working)', async () => {
    // Pre-#69 behavior: clients without readFile see no reconciliation. The
    // adapter must still write the new alias set; it just can't clean up
    // stale aliases. This is the "degrade gracefully" contract.
    const client = createClient(); // no readFile defined
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      provider: 'confluence',
      eventType: 'page.updated',
      objectType: 'page',
      objectId: '98765',
      payload: { id: '98765', title: 'Launch Plan', status: 'current', spaceId: '12345' },
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(client.deletes, []);
    assert.ok(client.writes.length > 0);
  });

  it('treats readFile errors as non-fatal and proceeds with the write fan-out', async () => {
    // A 5xx on the reconciliation read must not block the canonical write —
    // stale aliases are a maintenance concern, not a correctness blocker.
    const client: CapturingClient & {
      readFile: () => Promise<never>;
    } = {
      writes: [],
      deletes: [],
      async writeFile(input) {
        this.writes.push(input);
        return { created: true };
      },
      async deleteFile(input) {
        this.deletes.push(input);
      },
      async readFile() {
        throw new Error('synthetic 503 from relayfile');
      },
    };
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      provider: 'confluence',
      eventType: 'page.updated',
      objectType: 'page',
      objectId: '98765',
      payload: { id: '98765', title: 'Launch Plan', status: 'current', spaceId: '12345' },
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(client.deletes, []); // no reconciliation deletes attempted
    assert.ok(client.writes.length > 0);  // canonical write still landed
  });

  it('resolves Confluence read requests to Cloud REST API v2 paths', () => {
    assert.deepEqual(resolveConfluenceReadRequest('/confluence/pages'), {
      action: 'list_pages',
      method: 'GET',
      endpoint: '/wiki/api/v2/pages',
      query: { limit: '100', 'body-format': 'storage' },
    });
    assert.deepEqual(resolveConfluenceReadRequest('/confluence/spaces/12345/pages'), {
      action: 'list_space_pages',
      method: 'GET',
      endpoint: '/wiki/api/v2/pages',
      query: { limit: '100', 'body-format': 'storage', 'space-id': '12345' },
    });
    assert.deepEqual(resolveConfluenceReadRequest('/confluence/pages/release-plan__98765.json'), {
      action: 'get_page',
      method: 'GET',
      endpoint: '/wiki/api/v2/pages/98765',
      query: { 'body-format': 'storage', 'get-draft': 'true' },
    });
  });

  it('resolves nested page creates with the space id from the path', () => {
    assert.deepEqual(
      resolveConfluenceWritebackRequest(
        '/confluence/spaces/12345/pages/draft.json',
        JSON.stringify({
          title: 'Release Plan',
          body: '<p>Ship carefully.</p>',
        }),
      ),
      {
        action: 'create_page',
        method: 'POST',
        endpoint: '/wiki/api/v2/pages',
        body: {
          spaceId: '12345',
          status: 'current',
          title: 'Release Plan',
          body: { representation: 'storage', value: '<p>Ship carefully.</p>' },
        },
      },
    );
  });

  it('prefers an explicit payload spaceId over the path-derived key', () => {
    // Confluence v2 POST /pages requires the numeric spaceId; the path only
    // carries the space key, so a caller that resolved the numeric id supplies
    // it in the payload and it must win over the path value.
    const req = resolveConfluenceWritebackRequest(
      '/confluence/spaces/OPS/pages/draft.json',
      JSON.stringify({ spaceId: '688132', title: 'Notes', body: '<p>x</p>' }),
    );
    assert.equal((req.body as { spaceId: string }).spaceId, '688132');
  });

  it('resolves page updates and increments synced version numbers', () => {
    assert.deepEqual(
      resolveConfluenceWritebackRequest(
        '/confluence/pages/release-plan__98765.json',
        JSON.stringify({
          provider: 'confluence',
          objectType: 'page',
          objectId: '98765',
          workspaceId: 'workspace-1',
          payload: {
            title: 'Release Plan',
            status: 'current',
            spaceId: '12345',
            version: { number: 7, message: 'sync update', minorEdit: true },
            body: { storage: { value: '<p>Updated.</p>', representation: 'storage' } },
          },
        }),
      ),
      {
        action: 'update_page',
        method: 'PUT',
        endpoint: '/wiki/api/v2/pages/98765',
        body: {
          id: '98765',
          status: 'current',
          title: 'Release Plan',
          body: { representation: 'storage', value: '<p>Updated.</p>' },
          spaceId: '12345',
          version: { number: 8, message: 'sync update', minorEdit: true },
        },
      },
    );
  });

  it('resolves page deletes and rejects read-only fields', () => {
    assert.deepEqual(resolveConfluenceDeleteRequest('/confluence/pages/release-plan__98765.json'), {
      action: 'delete_page',
      method: 'DELETE',
      endpoint: '/wiki/api/v2/pages/98765',
    });

    assert.throws(
      () =>
        resolveConfluenceWritebackRequest(
          '/confluence/pages/draft.json',
          JSON.stringify({
            id: '98765',
            title: 'Release Plan',
            spaceId: '12345',
            body: '<p>Ship carefully.</p>',
          }),
        ),
      ReadOnlyFieldError,
    );
  });
});
