import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWrite } from '@relayfile/adapter-core';

import { GitLabWritebackHandler, resolveDeleteRequest, resolveGitLabWritebackRequest } from '../src/writeback.js';
import { resources } from '../src/resources.js';
import { MockProvider, ok } from './helpers.js';

describe('GitLabWritebackHandler', () => {
  it('creates issues, merge requests, and branches through GitLab v4', () => {
    assert.deepStrictEqual(resolveGitLabWritebackRequest('/gitlab/projects/acme/api/issues/factory-draft.json', JSON.stringify({ title: 'Parity', labels: ['factory'] })), {
      method: 'POST', endpoint: '/api/v4/projects/acme%2Fapi/issues', body: { title: 'Parity', labels: 'factory' },
    });
    assert.deepStrictEqual(resolveGitLabWritebackRequest('/gitlab/projects/acme/api/merge-requests/factory-draft.json', JSON.stringify({ source_branch: 'factory/parity', target_branch: 'main', title: 'Parity' })), {
      method: 'POST', endpoint: '/api/v4/projects/acme%2Fapi/merge_requests', body: { source_branch: 'factory/parity', target_branch: 'main', title: 'Parity' },
    });
    assert.deepStrictEqual(resolveGitLabWritebackRequest('/gitlab/projects/acme/api/refs/factory-branch.json', JSON.stringify({ branch: 'factory/parity', ref: 'main' })), {
      method: 'POST', endpoint: '/api/v4/projects/acme%2Fapi/repository/branches', body: { branch: 'factory/parity', ref: 'main' },
    });
  });

  it('accepts and closes merge requests through canonical sidecars', () => {
    assert.deepStrictEqual(resolveGitLabWritebackRequest('/gitlab/projects/acme/api/merge_requests/42__parity/merge.json', JSON.stringify({ squash: true })), {
      method: 'PUT', endpoint: '/api/v4/projects/acme%2Fapi/merge_requests/42/merge', body: { squash: true },
    });
    assert.deepStrictEqual(resolveGitLabWritebackRequest('/gitlab/projects/acme/api/merge_requests/42__parity/close.json', JSON.stringify({ state_event: 'close' })), {
      method: 'PUT', endpoint: '/api/v4/projects/acme%2Fapi/merge_requests/42', body: { state_event: 'close' },
    });
  });

  it('rejects missing GitLab create fields, invalid lifecycle states, and unsupported paths', () => {
    assert.throws(() => resolveGitLabWritebackRequest('/gitlab/projects/acme/api/issues/draft.json', JSON.stringify({})), /GitLab issue create payload.title must be a non-empty string/);
    assert.throws(
      () => resolveGitLabWritebackRequest('/gitlab/projects/acme/api/issues/draft.json', JSON.stringify({ title: 'Parity', state_event: 'close' })),
      /GitLab issue create payload.state_event is not supported/,
    );
    assert.throws(
      () => resolveGitLabWritebackRequest('/gitlab/projects/acme/api/merge-requests/draft.json', JSON.stringify({ source_branch: 'factory/parity', target_branch: 'main', title: 'Parity', state_event: 'close' })),
      /GitLab merge request create payload.state_event is not supported/,
    );
    assert.throws(() => resolveGitLabWritebackRequest('/gitlab/projects/acme/api/merge_requests/42__parity/close.json', JSON.stringify({ state_event: 'merged' })), /state_event must be one of close, reopen/);
    assert.throws(() => resolveGitLabWritebackRequest('/gitlab/projects/acme/api/pipelines/draft.json', '{}'), /Expected an issue, merge request create\/update, branch ref, merge request merge\/close, discussion, or issue note/);
  });
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
    assert.match(missingBody.error ?? '', /body must be a non-empty string/);
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
      JSON.stringify({ state_event: 'close' }),
    );
    const invalid = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/7__fix-bug/comments/11.json',
      JSON.stringify({ body: 'edit existing note' }),
    );

    assert.deepStrictEqual(update, { success: true, externalId: '7' });
    assert.deepStrictEqual(provider.requests[0]?.body, { state_event: 'close' });
    assert.strictEqual(invalid.success, false);
    assert.match(invalid.error ?? '', /Expected an issue, merge request create\/update, branch ref, merge request merge\/close, discussion, or issue note/);
  });

  it('uses project-scoped IIDs and branch names as writeback receipts', async () => {
    const provider = new MockProvider();
    provider.register('POST', '/api/v4/projects/acme%2Fapi/issues', ok({ id: 203601504, iid: 5 }));
    provider.register('POST', '/api/v4/projects/acme%2Fapi/merge_requests', ok({ id: 203601505, iid: 6 }));
    provider.register('POST', '/api/v4/projects/acme%2Fapi/repository/branches', ok({ name: 'factory/parity' }));
    const handler = new GitLabWritebackHandler(provider, { connectionId: 'conn', baseUrl: 'https://gitlab.com' });

    const issue = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/issues/draft.json',
      JSON.stringify({ title: 'Parity' }),
    );
    const mergeRequest = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/merge-requests/draft.json',
      JSON.stringify({ source_branch: 'factory/parity', target_branch: 'main', title: 'Parity' }),
    );
    const branch = await handler.writeBack(
      'workspace-1',
      '/gitlab/projects/acme/api/refs/draft.json',
      JSON.stringify({ branch: 'factory/parity', ref: 'main' }),
    );

    assert.deepStrictEqual(issue, { success: true, externalId: '5' });
    assert.deepStrictEqual(mergeRequest, { success: true, externalId: '6' });
    assert.deepStrictEqual(branch, { success: true, externalId: 'factory/parity' });
  });

  it('falls back to global IDs for issue and merge request receipts and keeps note IDs', async () => {
    const provider = new MockProvider();
    provider.register('POST', '/api/v4/projects/acme%2Fapi/issues', ok({ id: 203601504 }));
    provider.register('POST', '/api/v4/projects/acme%2Fapi/merge_requests', ok({ id: 203601505 }));
    provider.register('POST', '/api/v4/projects/acme%2Fapi/issues/7/notes', ok({ id: 11, iid: 999 }));
    const handler = new GitLabWritebackHandler(provider, { connectionId: 'conn', baseUrl: 'https://gitlab.com' });

    const issue = await handler.writeBack('workspace-1', '/gitlab/projects/acme/api/issues/draft.json', JSON.stringify({ title: 'Parity' }));
    const mergeRequest = await handler.writeBack('workspace-1', '/gitlab/projects/acme/api/merge-requests/draft.json', JSON.stringify({ source_branch: 'factory/parity', target_branch: 'main', title: 'Parity' }));
    const note = await handler.writeBack('workspace-1', '/gitlab/projects/acme/api/issues/7__parity/comments/draft@note.json', JSON.stringify({ body: 'Note' }));

    assert.deepStrictEqual(issue, { success: true, externalId: '203601504' });
    assert.deepStrictEqual(mergeRequest, { success: true, externalId: '203601505' });
    assert.deepStrictEqual(note, { success: true, externalId: '11' });
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
