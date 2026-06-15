import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aliasCollisionSuffix, slugifyAlias } from '../alias-slug.js';
import { LinearAdapter, type ConnectionProvider, type ProxyRequest, type ProxyResponse, type RelayFileClientLike } from '../index.js';
import {
  linearByIdAliasPath,
  linearByNameAliasPath,
  linearByTitleAliasPath,
  linearIssuePath,
  linearProjectPath,
} from '../path-mapper.js';

function createAdapter() {
  const files = new Map<string, string>();
  const deletedPaths: string[] = [];
  const client = {
    async writeFile(input: { path: string; content: string }) {
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input: { path: string }) {
      files.delete(input.path);
      deletedPaths.push(input.path);
    },
    // Sync helper kept for tests that read directly. Accepts (path), (input),
    // or (workspaceId, path) so it works both for the adapter's auxiliary
    // 2-arg readFile path and the alias-emitter's legacy single-arg path call.
    readFile(workspaceIdOrPathOrInput: string | { path: string }, maybePath?: string): string | undefined {
      if (typeof workspaceIdOrPathOrInput === 'string') {
        // Adapter passes (workspaceId, path) when readFile.length >= 2.
        // Alias emitter passes a bare path. Distinguish by inspecting the
        // value — paths in this fixture always start with `/`.
        const path = maybePath ?? (workspaceIdOrPathOrInput.startsWith('/') ? workspaceIdOrPathOrInput : undefined);
        return path ? files.get(path) : undefined;
      }
      return files.get(workspaceIdOrPathOrInput.path);
    },
  } satisfies RelayFileClientLike & {
    readFile(workspaceIdOrInput: string | { path: string }, maybePath?: string): string | undefined;
  };

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

  return {
    adapter: new LinearAdapter(client, provider, {}),
    client,
    deletedPaths,
    files,
  };
}

describe('linear aliases', () => {
  it('writes issue aliases, keeps AGE-8 verbatim in by-id, and updates the parent _index.json', async () => {
    const { adapter, client, files } = createAdapter();
    const event = {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId: 'issue-123',
      payload: {
        id: 'issue-123',
        identifier: 'AGE-8',
        title: 'Cafe roadmap',
      },
    };

    await adapter.ingestWebhook('ws-linear', event);

    const canonicalPath = '/linear/issues/AGE-8__issue-123.json';
    const byIdPath = linearByIdAliasPath('/linear/issues', 'AGE-8');
    const byTitlePath = linearByTitleAliasPath('/linear/issues', 'Cafe roadmap', 'issue-123');

    assert.ok(files.has(canonicalPath));
    assert.ok(files.has(byIdPath));
    assert.ok(files.has(byTitlePath));
    assert.strictEqual(client.readFile(byIdPath), client.readFile(canonicalPath));
    assert.strictEqual(client.readFile(byTitlePath), client.readFile(canonicalPath));

    // PR 1's writeAuxiliaryFiles overwrites the alias-row `_index.json`
    // emitted by writeLinearAliases with the canonical issue-row array. The
    // alias rows therefore live only transiently inside writeLinearAliases;
    // the durable record reflects the canonical shape.
    const index = JSON.parse(client.readFile('/linear/issues/_index.json') ?? '[]') as Array<{ id: string }>;
    assert.deepStrictEqual(index.map((row) => row.id), ['issue-123']);
  });

  it('writes project by-id aliases from the UUID and disambiguates by-name collisions with an 8-char hash', async () => {
    const { adapter, client } = createAdapter();

    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'project.create',
      objectType: 'project',
      objectId: 'project-1',
      payload: {
        id: 'project-1',
        name: 'Roadmap',
      },
    });
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'project.create',
      objectType: 'project',
      objectId: 'project-2',
      payload: {
        id: 'project-2',
        name: 'Roadmap!!!',
      },
    });

    const firstCanonicalPath = linearProjectPath('project-1');
    const secondCanonicalPath = linearProjectPath('project-2');
    const byIdPath = linearByIdAliasPath('/linear/projects', 'project-1');
    const collisionAliasPath = linearByNameAliasPath('/linear/projects', 'Roadmap!!!', 'project-2', true);

    assert.strictEqual(client.readFile(byIdPath), client.readFile(firstCanonicalPath));
    assert.strictEqual(client.readFile(collisionAliasPath), client.readFile(secondCanonicalPath));
    assert.ok(collisionAliasPath.endsWith(`${aliasCollisionSuffix('project-2')}.json`));
  });

  it('falls back to the object id for issue by-id aliases when the public identifier is missing', async () => {
    const { adapter, client } = createAdapter();
    const objectId = 'issue-uuid-42';

    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId,
      payload: {
        id: objectId,
        title: 'Roadmap without public ID',
      },
    });

    const canonicalPath = linearIssuePath(objectId, 'Roadmap without public ID');
    const byIdPath = linearByIdAliasPath('/linear/issues', objectId);
    assert.strictEqual(client.readFile(byIdPath), client.readFile(canonicalPath));
  });

  it('uses deterministic last-write-wins behavior when two issue payloads collide on the same by-id alias', async () => {
    const { adapter, client } = createAdapter();
    const identifier = 'AGE-8';

    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId: 'issue-123',
      payload: {
        id: 'issue-123',
        identifier,
        title: 'Cafe roadmap',
      },
    });
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.update',
      objectType: 'issue',
      objectId: 'issue-999',
      payload: {
        id: 'issue-999',
        identifier,
        title: 'Renamed roadmap',
      },
    });

    // Adapter computes humanReadable via getLinearIssueHumanReadable which
    // prefers `identifier` over title, so canonical filenames here use the
    // shared `AGE-8` prefix and only differ in the trailing id segment.
    const firstCanonicalPath = linearIssuePath('issue-123', identifier);
    const secondCanonicalPath = linearIssuePath('issue-999', identifier);
    const byIdPath = linearByIdAliasPath('/linear/issues', identifier);

    assert.notStrictEqual(client.readFile(firstCanonicalPath), client.readFile(secondCanonicalPath));
    assert.strictEqual(client.readFile(byIdPath), client.readFile(secondCanonicalPath));
  });

  it('writes an untitled by-title alias when an issue title slugs to nothing', async () => {
    const { adapter, client } = createAdapter();
    const objectId = 'issue-emoji-1';

    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId,
      payload: {
        id: objectId,
        identifier: 'AGE-EMOJI',
        title: '🚀🔥',
      },
    });

    // Adapter prefers `identifier` over title via getLinearIssueHumanReadable,
    // so the canonical path uses the identifier-derived slug rather than the
    // emoji title (which would slug to nothing).
    const canonicalPath = linearIssuePath(objectId, 'AGE-EMOJI');
    const byTitlePath = linearByTitleAliasPath('/linear/issues', '🚀🔥', objectId);

    assert.strictEqual(client.readFile(byTitlePath), client.readFile(canonicalPath));
    assert.ok(byTitlePath.endsWith('/by-title/untitled.json'));
  });

  it('slugging is deterministic, ASCII-folded, and strips traversal characters', () => {
    assert.strictEqual(slugifyAlias('Café ../ Roadmap'), 'cafe-roadmap');
    assert.strictEqual(slugifyAlias('Café ../ Roadmap'), slugifyAlias('Café ../ Roadmap'));
  });

  it('deletes the stale by-title alias when an issue title changes on re-ingest (issue #106)', async () => {
    const { adapter, client, deletedPaths, files } = createAdapter();
    const objectId = 'issue-106';
    const basePayload = { id: objectId, identifier: 'AGE-106' };

    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId,
      payload: { ...basePayload, title: 'Original title' },
    });
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.update',
      objectType: 'issue',
      objectId,
      payload: { ...basePayload, title: 'Renamed title' },
    });

    const canonicalPath = linearIssuePath(objectId, 'AGE-106');
    const oldAliasPath = linearByTitleAliasPath('/linear/issues', 'Original title', objectId);
    const newAliasPath = linearByTitleAliasPath('/linear/issues', 'Renamed title', objectId);

    // (a) the new alias is written, (b) the stale alias is deleted,
    // (c) the canonical record file is intact.
    assert.strictEqual(client.readFile(newAliasPath), client.readFile(canonicalPath));
    assert.strictEqual(files.has(oldAliasPath), false);
    assert.ok(files.has(canonicalPath));
    assert.deepStrictEqual(deletedPaths, [oldAliasPath]);
  });

  it('deletes the stale by-name alias when a project is renamed on re-ingest (issue #106)', async () => {
    const { adapter, client, deletedPaths, files } = createAdapter();
    const objectId = 'project-106';

    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'project.create',
      objectType: 'project',
      objectId,
      payload: { id: objectId, name: 'Old project name' },
    });
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'project.update',
      objectType: 'project',
      objectId,
      payload: { id: objectId, name: 'New project name' },
    });

    const canonicalPath = linearProjectPath(objectId);
    const oldAliasPath = linearByNameAliasPath('/linear/projects', 'Old project name', objectId);
    const newAliasPath = linearByNameAliasPath('/linear/projects', 'New project name', objectId);

    assert.strictEqual(client.readFile(newAliasPath), client.readFile(canonicalPath));
    assert.strictEqual(files.has(oldAliasPath), false);
    assert.ok(files.has(canonicalPath));
    assert.deepStrictEqual(deletedPaths, [oldAliasPath]);
  });

  it('deletes nothing when a record is re-ingested with an unchanged title', async () => {
    const { adapter, deletedPaths, files } = createAdapter();
    const objectId = 'issue-stable';
    const payload = { id: objectId, identifier: 'AGE-200', title: 'Stable title' };

    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId,
      payload,
    });
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.update',
      objectType: 'issue',
      objectId,
      payload,
    });

    const aliasPath = linearByTitleAliasPath('/linear/issues', 'Stable title', objectId);
    assert.ok(files.has(aliasPath));
    assert.ok(files.has(linearIssuePath(objectId, 'AGE-200')));
    assert.deepStrictEqual(deletedPaths, []);
  });

  it('does not delete a by-title alias owned by another record sharing the slug', async () => {
    const { adapter, deletedPaths, files } = createAdapter();

    // Record A claims the base slug.
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId: 'issue-a',
      payload: { id: 'issue-a', identifier: 'AGE-301', title: 'Shared title' },
    });
    // Record B collides and lands on the hashed variant.
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId: 'issue-b',
      payload: { id: 'issue-b', identifier: 'AGE-302', title: 'Shared title' },
    });
    // Record B is renamed — only B's stale collision alias may be removed.
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.update',
      objectType: 'issue',
      objectId: 'issue-b',
      payload: { id: 'issue-b', identifier: 'AGE-302', title: 'Renamed shared title' },
    });

    const baseAliasPath = linearByTitleAliasPath('/linear/issues', 'Shared title', 'issue-a');
    const collisionAliasPath = linearByTitleAliasPath('/linear/issues', 'Shared title', 'issue-b', true);

    assert.ok(files.has(baseAliasPath), 'record A keeps its base alias');
    assert.strictEqual(files.has(collisionAliasPath), false, 'record B stale collision alias is removed');
    assert.deepStrictEqual(deletedPaths, [collisionAliasPath]);
  });

  it('cleans stale aliases when the client only supports object-shaped reads', async () => {
    const files = new Map<string, string>();
    const deletedPaths: string[] = [];
    const client = {
      async writeFile(input: { path: string; content: string }) {
        files.set(input.path, input.content);
        return { created: true };
      },
      async deleteFile(input: { path: string }) {
        files.delete(input.path);
        deletedPaths.push(input.path);
      },
      readFile(
        inputOrWorkspaceId: string | { path: string },
        _path?: string,
      ): { content: string } | undefined {
        if (typeof inputOrWorkspaceId === 'string') {
          throw new Error('object-shaped readFile input required');
        }
        const content = files.get(inputOrWorkspaceId.path);
        return content === undefined ? undefined : { content };
      },
    } satisfies RelayFileClientLike;
    const provider: ConnectionProvider = {
      name: 'linear-test-provider',
      async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
        return { status: 200, headers: {}, data: null as never };
      },
      async healthCheck() {
        return true;
      },
    };
    const adapter = new LinearAdapter(client, provider, {});
    const objectId = 'issue-object-read';
    const basePayload = { id: objectId, identifier: 'AGE-401' };

    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.create',
      objectType: 'issue',
      objectId,
      payload: { ...basePayload, title: 'Object read old title' },
    });
    await adapter.ingestWebhook('ws-linear', {
      provider: 'linear',
      eventType: 'issue.update',
      objectType: 'issue',
      objectId,
      payload: { ...basePayload, title: 'Object read new title' },
    });

    const oldAliasPath = linearByTitleAliasPath('/linear/issues', 'Object read old title', objectId);
    const newAliasPath = linearByTitleAliasPath('/linear/issues', 'Object read new title', objectId);

    assert.strictEqual(files.has(oldAliasPath), false);
    assert.ok(files.has(newAliasPath));
    assert.deepStrictEqual(deletedPaths, [oldAliasPath]);
  });
});
