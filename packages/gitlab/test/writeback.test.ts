import { describe, expect, it } from 'vitest';

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

    expect(result).toEqual({ success: true, externalId: '42' });
    expect(provider.requests[0]).toMatchObject({
      method: 'PUT',
      endpoint: '/api/v4/projects/acme%2Fapi/merge_requests/42',
    });
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

    expect(discussion).toEqual({ success: true, externalId: 'discussion-1' });
    expect(issueNote).toEqual({ success: true, externalId: '11' });
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

    expect(update).toEqual({ success: true, externalId: '7' });
    expect(invalid).toEqual({
      success: false,
      error: 'Unsupported GitLab writeback path: /gitlab/projects/acme/api/issues/7/comments/11.json',
    });
  });
});
