import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GitLabAdapter } from '../src/adapter.js';
import { renderMergeRequestPatch } from '../src/mr/diff-parser.js';
import type { GitLabMergeRequestWebhook } from '../src/types.js';
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
      '/gitlab/projects/acme/api/merge_requests/42/metadata.json',
      '/gitlab/projects/acme/api/merge_requests/42/diff.patch',
      '/gitlab/projects/acme/api/merge_requests/42/discussions/discussion-1.json',
      '/gitlab/projects/acme/api/merge_requests/42/approvals.json',
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
});
