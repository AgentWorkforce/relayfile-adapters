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
  confluencePagePath,
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

  it('ingests page events with space relations and body comments', async () => {
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
        body: { storage: { value: '<p>Ship carefully.</p>', representation: 'storage' } },
      },
    });

    assert.equal(result.filesWritten, 1);
    assert.equal(client.writes[0]?.path, '/confluence/spaces/12345/pages/release-plan__98765.json');
    assert.deepEqual(client.writes[0]?.semantics?.relations, [
      confluenceSpacePath('12345'),
    ]);
    assert.equal(client.writes[0]?.semantics?.comments?.[0], 'Ship carefully.');
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
