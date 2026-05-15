import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  emitGitLabAuxiliaryFiles,
  type GitLabEmitAuxiliaryFilesInput,
} from '../src/emit-auxiliary-files.js';

class MemoryClient {
  writes = new Map<string, string>();

  async writeFile(input: { path: string; content: string }): Promise<void> {
    this.writes.set(input.path, input.content);
  }

  async readFile(input: { path: string }): Promise<{ content: string } | null> {
    const content = this.writes.get(input.path);
    return content === undefined ? null : { content };
  }

  async deleteFile(input: { path: string }): Promise<void> {
    this.writes.delete(input.path);
  }
}

describe('emitGitLabAuxiliaryFiles', () => {
  it('writes layout, indexes, canonical records, and aliases', async () => {
    const client = new MemoryClient();
    const input: GitLabEmitAuxiliaryFilesInput = {
      workspaceId: 'ws-1',
      connectionId: 'conn',
      mergeRequests: [
        {
          projectPath: 'acme/api',
          iid: 42,
          title: 'Add OAuth',
          state: 'opened',
          updated_at: '2026-05-12T08:00:00.000Z',
        },
      ],
      pipelines: [
        {
          projectPath: 'acme/api',
          id: 9,
          ref: 'main',
          status: 'failed',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    };

    const result = await emitGitLabAuxiliaryFiles(client, input);

    assert.deepEqual(result.errors, []);
    assert.ok(result.written >= 10);
    assert.ok(client.writes.has('/gitlab/LAYOUT.md'));
    assert.ok(client.writes.has('/gitlab/_index.json'));
    assert.ok(client.writes.has('/gitlab/projects/_index.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/merge_requests/_index.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/_index.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/merge_requests/by-id/42.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/merge_requests/by-title/add-oauth__42.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/merge_requests/by-state/opened/42.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/9__main/meta.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/by-ref/main__9.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/by-status/failed/9.json'));

    const alias = JSON.parse(client.writes.get('/gitlab/projects/acme/api/merge_requests/by-title/add-oauth__42.json') ?? '{}');
    assert.deepEqual(alias, {
      id: '42',
      canonicalPath: '/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
      title: 'Add OAuth',
      state: 'opened',
    });

    const index = JSON.parse(client.writes.get('/gitlab/projects/acme/api/merge_requests/_index.json') ?? '[]');
    assert.deepEqual(index, [
      {
        id: '42',
        title: 'Add OAuth',
        updated: '2026-05-12T08:00:00.000Z',
        iid: 42,
        state: 'opened',
      },
    ]);
  });

  it('moves issue by-state aliases on state transitions', async () => {
    const client = new MemoryClient();
    client.writes.set('/gitlab/projects/acme/api/issues/by-id/7.json', JSON.stringify({
      id: '7',
      canonicalPath: '/gitlab/projects/acme/api/issues/7__fix-bug/meta.json',
      title: 'Fix bug',
      state: 'opened',
    }));
    client.writes.set('/gitlab/projects/acme/api/issues/by-state/opened/7.json', JSON.stringify({
      id: '7',
      canonicalPath: '/gitlab/projects/acme/api/issues/7__fix-bug/meta.json',
      title: 'Fix bug',
      state: 'opened',
    }));

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          projectPath: 'acme/api',
          iid: 7,
          title: 'Fix bug',
          state: 'closed',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/by-state/opened/7.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/issues/by-state/closed/7.json'));
  });
});
