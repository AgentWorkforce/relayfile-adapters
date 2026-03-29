import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GitLabWritebackHandler } from '../src/writeback.js';
import { MockProvider, ok } from './helpers.js';

describe('GitLabWritebackHandler', () => {
  it('matches merge request metadata writebacks', async () => {
    const provider = new MockProvider();
    provider.register('PUT', '/api/v4/projects/acme%2Fapi/merge_requests/42', ok({ iid: 42 }));
    const handler = new GitLabWritebackHandler(provider, { connectionId: 'conn', baseUrl: 'https://gitlab.com' });

    const result = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/merge_requests/42/metadata.json',
      JSON.stringify({ title: 'Updated title' }),
    );

    assert.deepStrictEqual(result, { success: true, externalId: '42' });
    assert.strictEqual(provider.requests[0].method, 'PUT');
    assert.strictEqual(provider.requests[0].endpoint, '/api/v4/projects/acme%2Fapi/merge_requests/42');
  });

  it('matches merge request discussion and issue note writebacks', async () => {
    const provider = new MockProvider();
    provider.register('POST', '/api/v4/projects/acme%2Fapi/merge_requests/42/discussions', ok({ id: 'discussion-1' }));
    provider.register('POST', '/api/v4/projects/acme%2Fapi/issues/7/notes', ok({ id: 11 }));
    const handler = new GitLabWritebackHandler(provider, { connectionId: 'conn', baseUrl: 'https://gitlab.com' });

    const discussion = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/merge_requests/42/discussions/new.json',
      JSON.stringify({ body: 'LGTM' }),
    );
    const issueNote = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7/comments/new.json',
      JSON.stringify({ body: 'Needs follow-up' }),
    );

    assert.deepStrictEqual(discussion, { success: true, externalId: 'discussion-1' });
    assert.deepStrictEqual(issueNote, { success: true, externalId: '11' });
  });

  it('matches issue metadata updates and rejects existing comment paths', async () => {
    const provider = new MockProvider();
    provider.register('PUT', '/api/v4/projects/acme%2Fapi/issues/7', ok({ iid: 7 }));
    const handler = new GitLabWritebackHandler(provider, { connectionId: 'conn', baseUrl: 'https://gitlab.com' });

    const update = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7/metadata.json',
      JSON.stringify({ title: 'Updated issue' }),
    );
    const invalid = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7/comments/11.json',
      JSON.stringify({ body: 'edit existing note' }),
    );

    assert.deepStrictEqual(update, { success: true, externalId: '7' });
    assert.deepStrictEqual(invalid, {
      success: false,
      error: 'Unsupported GitLab writeback path: /gitlab/projects/acme/api/issues/7/comments/11.json',
    });
  });
});
