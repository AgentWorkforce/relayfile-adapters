import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GitLabAdapter } from '../src/adapter.js';
import { renderMergeRequestPatch } from '../src/mr/diff-parser.js';
import type { GitLabNoteWebhook, GitLabMergeRequestWebhook, GitLabTagPushWebhook } from '../src/types.js';
import { MockProvider, ok } from './helpers.js';

describe('GitLabAdapter e2e ingestion', () => {
  it('ingests a merge request webhook and fetches related GitLab resources', async () => {
    const provider = new MockProvider();
    const adapter = new GitLabAdapter(provider, {
      connectionId: 'conn',
      projectPath: 'acme/api',
    });

    provider.register(
      'GET',
      '/api/v4/projects/acme%2Fapi/merge_requests/42',
      ok({
        id: 42,
        iid: 42,
        title: 'Add feature',
        description: null,
        state: 'opened',
        author: { id: 2, username: 'dev', name: 'Dev' },
        labels: [],
        source_branch: 'feature',
        target_branch: 'main',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }),
    );
    provider.register(
      'GET',
      '/api/v4/projects/acme%2Fapi/merge_requests/42/diffs',
      ok([
        {
          old_path: 'src/app.ts',
          new_path: 'src/app.ts',
          new_file: false,
          renamed_file: false,
          deleted_file: false,
          diff: '@@ -1 +1 @@\n-console.log("old")\n+console.log("new")\n',
        },
      ]),
    );
    provider.register(
      'GET',
      '/api/v4/projects/acme%2Fapi/merge_requests/42/discussions',
      ok([
        {
          id: 'discussion-1',
          individual_note: false,
          notes: [
            {
              id: 10,
              body: 'Please rename this',
              author: { id: 2, username: 'dev', name: 'Dev' },
              noteable_type: 'MergeRequest',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      ]),
    );
    provider.register(
      'GET',
      '/api/v4/projects/acme%2Fapi/merge_requests/42/approvals',
      ok({
        approved: false,
        approved_by: [],
        approvals_left: 1,
        approvals_required: 1,
      }),
    );

    const payload = {
      object_kind: 'merge_request',
      project: {
        id: 1,
        name: 'api',
        path: 'api',
        path_with_namespace: 'acme/api',
      },
      object_attributes: {
        id: 42,
        iid: 42,
        title: 'Add feature',
        description: null,
        state: 'opened',
        author: { id: 2, username: 'dev', name: 'Dev' },
        labels: [],
        source_branch: 'feature',
        target_branch: 'main',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        action: 'open',
      },
    } as GitLabMergeRequestWebhook;

    const result = await adapter.routeWebhook(payload, 'merge_request.open');

    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.paths, [
      '/gitlab/projects/acme/api/merge_requests/42__add-feature/meta.json',
      '/gitlab/projects/acme/api/merge_requests/42__add-feature/diff.patch',
      '/gitlab/projects/acme/api/merge_requests/42__add-feature/discussions/discussion-1.json',
      '/gitlab/projects/acme/api/merge_requests/42__add-feature/approvals.json',
    ]);
    assert.strictEqual(result.filesWritten, 4);
    assert.strictEqual(
      result.operations[1]?.content,
      renderMergeRequestPatch([
        {
          old_path: 'src/app.ts',
          new_path: 'src/app.ts',
          new_file: false,
          renamed_file: false,
          deleted_file: false,
          diff: '@@ -1 +1 @@\n-console.log("old")\n+console.log("new")\n',
        },
      ]),
    );
  });

  it('backfills the parent issue meta (with labels) on an issue comment webhook (#176)', async () => {
    const provider = new MockProvider();
    const adapter = new GitLabAdapter(provider, {
      connectionId: 'conn',
      projectPath: 'acme/api',
    });

    // The authoritative issue, re-fetched during comment ingestion, carries the
    // `factory` label that the webhook envelope alone would not have surfaced.
    provider.register(
      'GET',
      '/api/v4/projects/acme%2Fapi/issues/7',
      ok({
        id: 700,
        iid: 7,
        title: 'Fix the thing',
        description: 'body',
        state: 'opened',
        author: { id: 2, username: 'dev', name: 'Dev' },
        labels: ['factory'],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      }),
    );

    const payload = {
      object_kind: 'note',
      project: {
        id: 1,
        name: 'api',
        path: 'api',
        path_with_namespace: 'acme/api',
      },
      issue: {
        id: 700,
        iid: 7,
        title: 'Fix the thing',
        description: 'body',
        state: 'opened',
        author: { id: 2, username: 'dev', name: 'Dev' },
        labels: ['factory'],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      },
      object_attributes: {
        id: 99,
        body: 'A comment',
        author: { id: 2, username: 'dev', name: 'Dev' },
        noteable_type: 'Issue',
        noteable_iid: 7,
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
      },
    } as GitLabNoteWebhook;

    const result = await adapter.routeWebhook(payload, 'note.Issue');

    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.paths, [
      '/gitlab/projects/acme/api/issues/7__fix-the-thing/comments/99.json',
      '/gitlab/projects/acme/api/issues/7__fix-the-thing/meta.json',
    ]);

    const metaOperation = result.operations.find((operation) => operation.path.endsWith('/meta.json'));
    assert.ok(metaOperation, 'expected an issue meta.json operation');
    const meta = JSON.parse(metaOperation.content ?? '{}');
    assert.deepStrictEqual(meta.labels, ['factory']);
    assert.strictEqual(meta.iid, 7);
  });

  it('still records the comment when the parent issue re-fetch fails (#176)', async () => {
    const provider = new MockProvider();
    const adapter = new GitLabAdapter(provider, {
      connectionId: 'conn',
      projectPath: 'acme/api',
    });

    // No handler registered for the issue fetch -> the API call throws. The
    // comment must still be ingested.
    const payload = {
      object_kind: 'note',
      project: {
        id: 1,
        name: 'api',
        path: 'api',
        path_with_namespace: 'acme/api',
      },
      issue: {
        id: 700,
        iid: 7,
        title: 'Fix the thing',
        description: 'body',
        state: 'opened',
        author: { id: 2, username: 'dev', name: 'Dev' },
        labels: ['factory'],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      },
      object_attributes: {
        id: 99,
        body: 'A comment',
        author: { id: 2, username: 'dev', name: 'Dev' },
        noteable_type: 'Issue',
        noteable_iid: 7,
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
      },
    } as GitLabNoteWebhook;

    const result = await adapter.routeWebhook(payload, 'note.Issue');

    assert.deepStrictEqual(result.paths, [
      '/gitlab/projects/acme/api/issues/7__fix-the-thing/comments/99.json',
    ]);
    assert.strictEqual(result.filesWritten, 1);
  });

  it('maps tag deletion webhooks to delete operations', async () => {
    const provider = new MockProvider();
    const adapter = new GitLabAdapter(provider, {
      connectionId: 'conn',
      projectPath: 'acme/api',
    });

    const payload = {
      object_kind: 'tag_push',
      event_name: 'tag_push',
      before: 'deadbeef',
      after: '0000000000000000000000000000000000000000',
      checkout_sha: null,
      ref: 'refs/tags/v1.0',
      commits: [],
      project: {
        id: 1,
        name: 'api',
        path: 'api',
        path_with_namespace: 'acme/api',
      },
    } as GitLabTagPushWebhook;

    const result = await adapter.routeWebhook(payload, 'tag_push');

    assert.equal(result.filesDeleted, 4);
    assert.equal(result.filesWritten, 0);
    assert.deepEqual(result.paths, [
      '/gitlab/projects/acme/api/tags/v1-0__v1.0.json',
      '/gitlab/projects/acme/api/tags/by-ref/v1-0__v1.0.json',
      '/gitlab/projects/acme/api/tags/refs-tags-v1-0__refs%2Ftags%2Fv1.0.json',
      '/gitlab/projects/acme/api/tags/by-ref/refs-tags-v1-0__refs%2Ftags%2Fv1.0.json',
    ]);
    assert.deepEqual(result.operations, [
      {
        path: '/gitlab/projects/acme/api/tags/v1-0__v1.0.json',
        mode: 'delete',
      },
      {
        path: '/gitlab/projects/acme/api/tags/by-ref/v1-0__v1.0.json',
        mode: 'delete',
      },
      {
        path: '/gitlab/projects/acme/api/tags/refs-tags-v1-0__refs%2Ftags%2Fv1.0.json',
        mode: 'delete',
      },
      {
        path: '/gitlab/projects/acme/api/tags/by-ref/refs-tags-v1-0__refs%2Ftags%2Fv1.0.json',
        mode: 'delete',
      },
    ]);
  });

  it('maps complex tag deletion webhooks to fixed and legacy delete operations', async () => {
    const provider = new MockProvider();
    const adapter = new GitLabAdapter(provider, {
      connectionId: 'conn',
      projectPath: 'acme/api',
    });

    const payload = {
      object_kind: 'tag_push',
      event_name: 'tag_push',
      before: 'deadbeef',
      after: '0000000000000000000000000000000000000000',
      checkout_sha: null,
      ref: 'refs/tags/release/foo__bar',
      commits: [],
      project: {
        id: 1,
        name: 'api',
        path: 'api',
        path_with_namespace: 'acme/api',
      },
    } as GitLabTagPushWebhook;

    const result = await adapter.routeWebhook(payload, 'tag_push');

    assert.equal(result.filesDeleted, 8);
    assert.equal(result.filesWritten, 0);
    assert.deepEqual(result.paths, [
      '/gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json',
      '/gitlab/projects/acme/api/tags/by-ref/release-foo-bar__release%2Ffoo__bar.json',
      '/gitlab/projects/acme/api/tags/release/foo__bar.json',
      '/gitlab/projects/acme/api/tags/by-ref/release/foo__bar.json',
      '/gitlab/projects/acme/api/tags/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json',
      '/gitlab/projects/acme/api/tags/by-ref/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json',
      '/gitlab/projects/acme/api/tags/refs/tags/release/foo__bar.json',
      '/gitlab/projects/acme/api/tags/by-ref/refs/tags/release/foo__bar.json',
    ]);
  });
});
