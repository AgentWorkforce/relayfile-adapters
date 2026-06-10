import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GitLabApiClient } from '../src/api.js';
import { DEFAULT_CONFIG } from '../src/adapter.js';
import type { GitLabAdapterConfig, ProxyRequest } from '../src/types.js';
import { MockProvider, ok } from './helpers.js';

function makeConfig(overrides: Partial<GitLabAdapterConfig> = {}): GitLabAdapterConfig {
  return {
    ...DEFAULT_CONFIG,
    connectionId: 'conn-1',
    ...overrides,
  };
}

describe('GitLabApiClient.projectId', () => {
  it('URL-encodes the project path for use in API endpoints', () => {
    const client = new GitLabApiClient(new MockProvider(), makeConfig());
    assert.strictEqual(client.projectId('acme/api'), 'acme%2Fapi');
    assert.strictEqual(client.projectId('group/sub group/repo'), 'group%2Fsub%20group%2Frepo');
  });
});

describe('GitLabApiClient.request', () => {
  it('proxies through the connection provider with config base URL and connection id', async () => {
    const provider = new MockProvider();
    provider.register('GET', '/api/v4/projects/1', ok({ id: 1 }));

    const client = new GitLabApiClient(provider, makeConfig());
    const data = await client.get<{ id: number }>('/api/v4/projects/1', { search: 'x' });

    assert.deepStrictEqual(data, { id: 1 });
    assert.strictEqual(provider.requests.length, 1);
    const request = provider.requests[0] as ProxyRequest;
    assert.strictEqual(request.method, 'GET');
    assert.strictEqual(request.baseUrl, DEFAULT_CONFIG.baseUrl);
    assert.strictEqual(request.connectionId, 'conn-1');
    assert.deepStrictEqual(request.query, { search: 'x' });
  });

  it('throws a descriptive error for non-2xx responses with string details', async () => {
    const provider = new MockProvider();
    provider.register('GET', '/api/v4/projects/1', { status: 404, headers: {}, data: '404 Project Not Found' });

    const client = new GitLabApiClient(provider, makeConfig());
    await assert.rejects(
      client.get('/api/v4/projects/1'),
      /GET \/api\/v4\/projects\/1 failed with 404: 404 Project Not Found/,
    );
  });

  it('serializes object error payloads into the thrown message', async () => {
    const provider = new MockProvider();
    provider.register('POST', '/api/v4/projects/1/issues', {
      status: 400,
      headers: {},
      data: { message: 'title is missing' },
    });

    const client = new GitLabApiClient(provider, makeConfig());
    await assert.rejects(
      client.request('POST', '/api/v4/projects/1/issues', { body: {} }),
      /POST \/api\/v4\/projects\/1\/issues failed with 400: \{"message":"title is missing"\}/,
    );
  });

  it('requires a connectionId before issuing provider-backed calls', async () => {
    const provider = new MockProvider();
    provider.register('GET', '/api/v4/projects/1', ok({ id: 1 }));

    const client = new GitLabApiClient(provider, makeConfig({ connectionId: undefined }));
    await assert.rejects(client.get('/api/v4/projects/1'), /connectionId is required/);
    assert.strictEqual(provider.requests.length, 0);
  });
});

describe('GitLabApiClient.paginate', () => {
  it('follows x-next-page headers until exhausted', async () => {
    const provider = new MockProvider();
    provider.register('GET', '/api/v4/projects/1/issues', (request) => {
      const page = request.query?.page;
      if (page === '1') {
        return ok([{ iid: 1 }, { iid: 2 }], { 'X-Next-Page': '2' });
      }
      if (page === '2') {
        return ok([{ iid: 3 }], { 'x-next-page': '' });
      }
      throw new Error(`Unexpected page ${page}`);
    });

    const client = new GitLabApiClient(provider, makeConfig());
    const items = await client.paginate<{ iid: number }>('/api/v4/projects/1/issues');

    assert.deepStrictEqual(items.map((item) => item.iid), [1, 2, 3]);
    assert.strictEqual(provider.requests.length, 2);
    assert.strictEqual(provider.requests[0]?.query?.per_page, String(DEFAULT_CONFIG.perPage));
  });

  it('falls back to RFC 5988 Link headers when x-next-page is absent', async () => {
    const provider = new MockProvider();
    provider.register('GET', '/api/v4/projects/1/issues', (request) => {
      const page = request.query?.page;
      if (page === '1') {
        return ok([{ iid: 1 }], {
          Link: '<https://gitlab.example.com/api/v4/projects/1/issues?page=2&per_page=20>; rel="next", <https://gitlab.example.com/api/v4/projects/1/issues?page=9>; rel="last"',
        });
      }
      return ok([{ iid: 2 }], {});
    });

    const client = new GitLabApiClient(provider, makeConfig());
    const items = await client.paginate<{ iid: number }>('/api/v4/projects/1/issues');

    assert.deepStrictEqual(items.map((item) => item.iid), [1, 2]);
    assert.strictEqual(provider.requests[1]?.query?.page, '2');
  });

  it('stops at the requested limit and slices overshoot from the last page', async () => {
    const provider = new MockProvider();
    provider.register('GET', '/api/v4/projects/1/issues', (request) =>
      request.query?.page === '1'
        ? ok([{ iid: 1 }, { iid: 2 }, { iid: 3 }], { 'x-next-page': '2' })
        : ok([{ iid: 4 }], {}),
    );

    const client = new GitLabApiClient(provider, makeConfig());
    const items = await client.paginate<{ iid: number }>('/api/v4/projects/1/issues', {}, { limit: 2 });

    assert.deepStrictEqual(items.map((item) => item.iid), [1, 2]);
    assert.strictEqual(provider.requests.length, 1);
  });

  it('treats non-array payloads as empty pages', async () => {
    const provider = new MockProvider();
    provider.register('GET', '/api/v4/projects/1/issues', ok({ unexpected: true }));

    const client = new GitLabApiClient(provider, makeConfig());
    const items = await client.paginate('/api/v4/projects/1/issues');

    assert.deepStrictEqual(items, []);
  });

  it('honours caller-provided page and per_page query overrides', async () => {
    const provider = new MockProvider();
    provider.register('GET', '/api/v4/projects/1/issues', ok([{ iid: 7 }]));

    const client = new GitLabApiClient(provider, makeConfig());
    await client.paginate('/api/v4/projects/1/issues', { page: '3', per_page: '5' });

    assert.strictEqual(provider.requests[0]?.query?.page, '3');
    assert.strictEqual(provider.requests[0]?.query?.per_page, '5');
  });
});
