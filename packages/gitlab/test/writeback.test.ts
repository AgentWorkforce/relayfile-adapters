import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWrite } from '@relayfile/adapter-core';

import { GitLabWritebackHandler, resolveDeleteRequest } from '../src/writeback.js';
import { resources } from '../src/resources.js';
import { MockProvider, ok } from './helpers.js';

describe('GitLabWritebackHandler', () => {
  it('matches merge request metadata writebacks', async () => {
    const provider = new MockProvider();
    provider.register('PUT', '/api/v4/projects/acme%2Fapi/merge_requests/42', ok({ iid: 42 }));
    const handler = new GitLabWritebackHandler(provider, { connectionId: 'conn', baseUrl: 'https://gitlab.com' });

    const result = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
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
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/discussions/draft@discussion.json',
      JSON.stringify({ body: 'LGTM' }),
    );
    const issueNote = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7__fix-bug/comments/draft@note.json',
      JSON.stringify({ body: 'Needs follow-up' }),
    );

    assert.deepStrictEqual(discussion, { success: true, externalId: 'discussion-1' });
    assert.deepStrictEqual(issueNote, { success: true, externalId: '11' });
  });

  it('rejects missing required create fields and read-only fields', async () => {
    const provider = new MockProvider();
    const handler = new GitLabWritebackHandler(provider, { connectionId: 'conn', baseUrl: 'https://gitlab.com' });

    const missingBody = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7__fix-bug/comments/draft@note.json',
      JSON.stringify({}),
    );
    const readOnly = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7__fix-bug/meta.json',
      JSON.stringify({ id: '7', title: 'Updated issue' }),
    );

    assert.strictEqual(missingBody.success, false);
    assert.match(missingBody.error ?? '', /requires `body`/);
    assert.strictEqual(readOnly.success, false);
    assert.match(readOnly.error ?? '', /read-only/);
    assert.strictEqual(provider.requests.length, 0);
  });

  it('matches issue metadata updates and rejects existing comment paths', async () => {
    const provider = new MockProvider();
    provider.register('PUT', '/api/v4/projects/acme%2Fapi/issues/7', ok({ iid: 7 }));
    const handler = new GitLabWritebackHandler(provider, { connectionId: 'conn', baseUrl: 'https://gitlab.com' });

    const update = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7__fix-bug/meta.json',
      JSON.stringify({ title: 'Updated issue' }),
    );
    const invalid = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7__fix-bug/comments/11.json',
      JSON.stringify({ body: 'edit existing note' }),
    );

    assert.deepStrictEqual(update, { success: true, externalId: '7' });
    assert.deepStrictEqual(invalid, {
      success: false,
      error: 'Unsupported GitLab writeback path: /gitlab/projects/acme/api/issues/7__fix-bug/comments/11.json',
    });
  });

  it('maps canonical discussion and note paths to DELETE requests', () => {
    const discussionNotePath = '/gitlab/projects/acme/api/merge_requests/42__add-oauth/discussions/discussion-1/notes/99.json';

    assert.deepStrictEqual(
      resolveDeleteRequest('/gitlab/projects/acme/api/issues/7__fix-bug/comments/11.json'),
      {
        action: 'delete_issue_note',
        method: 'DELETE',
        endpoint: '/api/v4/projects/acme%2Fapi/issues/7/notes/11',
      },
    );
    assert.deepStrictEqual(
      resolveDeleteRequest(discussionNotePath),
      {
        action: 'delete_merge_request_discussion',
        method: 'DELETE',
        endpoint: '/api/v4/projects/acme%2Fapi/merge_requests/42/discussions/discussion-1/notes/99',
      },
    );
    const route = classifyWrite(discussionNotePath, resources, { fsEvent: 'delete' });
    assert.strictEqual(route?.kind, 'delete');
    assert.strictEqual(route?.resource.name, 'discussions');
    assert.throws(
      () => resolveDeleteRequest('/gitlab/projects/acme/api/merge_requests/42__add-oauth/discussions/discussion-1.json'),
      /Unsupported GitLab delete writeback path/,
    );
    assert.throws(
      () => resolveDeleteRequest('/gitlab/projects/acme/api/issues/7__fix-bug/comments/draft@note.json'),
      /Unsupported GitLab delete writeback path/,
    );
  });
});
