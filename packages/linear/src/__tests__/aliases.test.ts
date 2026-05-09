import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aliasCollisionSuffix, slugifyAlias } from '../alias-slug.js';
import { LinearAdapter, type ConnectionProvider, type ProxyRequest, type ProxyResponse, type RelayFileClientLike } from '../index.js';
import { linearByIdAliasPath, linearByTitleAliasPath, linearIssuePath } from '../path-mapper.js';

function createAdapter() {
  const files = new Map<string, string>();
  const client: RelayFileClientLike & { readFile(path: string): string | undefined } = {
    async writeFile(input) {
      files.set(input.path, input.content);
      return { created: true };
    },
    readFile(path: string) {
      return files.get(path);
    },
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

    const canonicalPath = '/linear/issues/cafe-roadmap--issue123.json';
    const byIdPath = linearByIdAliasPath('/linear/issues', 'AGE-8');
    const byTitlePath = linearByTitleAliasPath('/linear/issues', 'Cafe roadmap', 'issue-123');

    assert.ok(files.has(canonicalPath));
    assert.ok(files.has(byIdPath));
    assert.ok(files.has(byTitlePath));
    assert.strictEqual(client.readFile(byIdPath), client.readFile(canonicalPath));
    assert.strictEqual(client.readFile(byTitlePath), client.readFile(canonicalPath));

    const index = JSON.parse(client.readFile('/linear/issues/_index.json') ?? '{}') as { rows: Array<{ file: string }> };
    assert.deepStrictEqual(index.rows.map((row) => row.file), ['by-id/', 'by-title/']);
  });

  it('writes project by-id aliases from the UUID and disambiguates by-title collisions with an 8-char hash', async () => {
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

    const firstCanonicalPath = '/linear/projects/project-1.json';
    const secondCanonicalPath = '/linear/projects/project-2.json';
    const byIdPath = linearByIdAliasPath('/linear/projects', 'project-1');
    const collisionAliasPath = linearByTitleAliasPath('/linear/projects', 'Roadmap!!!', 'project-2', true);

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

    const firstCanonicalPath = linearIssuePath('issue-123', 'Cafe roadmap');
    const secondCanonicalPath = linearIssuePath('issue-999', 'Renamed roadmap');
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

    const canonicalPath = linearIssuePath(objectId, '🚀🔥');
    const byTitlePath = linearByTitleAliasPath('/linear/issues', '🚀🔥', objectId);

    assert.strictEqual(client.readFile(byTitlePath), client.readFile(canonicalPath));
    assert.ok(byTitlePath.endsWith('/by-title/untitled.json'));
  });

  it('slugging is deterministic, ASCII-folded, and strips traversal characters', () => {
    assert.strictEqual(slugifyAlias('Café ../ Roadmap'), 'cafe-roadmap');
    assert.strictEqual(slugifyAlias('Café ../ Roadmap'), slugifyAlias('Café ../ Roadmap'));
  });
});
