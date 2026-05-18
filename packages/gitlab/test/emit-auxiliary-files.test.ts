import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  emitGitLabAuxiliaryFiles,
  type GitLabEmitAuxiliaryFilesInput,
} from '../src/emit-auxiliary-files.js';

class MemoryClient {
  writes = new Map<string, string>();
  deletes: string[] = [];

  async writeFile(input: { path: string; content: string }): Promise<void> {
    this.writes.set(input.path, input.content);
  }

  async readFile(input: { path: string }): Promise<{ content: string } | null> {
    const content = this.writes.get(input.path);
    return content === undefined ? null : { content };
  }

  async deleteFile(input: { path: string }): Promise<void> {
    this.deletes.push(input.path);
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
          assignees: [{ username: 'ada' }],
          author: { username: 'linus' },
          labels: [{ title: 'P1' }],
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
    assert.ok(client.writes.has('/gitlab/projects/acme/api/merge_requests/by-assignee/ada/42.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/merge_requests/by-creator/linus/42.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/merge_requests/by-priority/p1/42.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/9__main/meta.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/by-ref/main__9.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/by-status/failed/9.json'));

    const alias = JSON.parse(client.writes.get('/gitlab/projects/acme/api/merge_requests/by-title/add-oauth__42.json') ?? '{}');
    assert.deepEqual(alias, {
      id: '42',
      canonicalPath: '/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
      title: 'Add OAuth',
      state: 'opened',
      assigneeKeys: ['ada'],
      creatorKey: 'linus',
      priority: 'P1',
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

  it('moves issue canonical and by-title aliases on title changes', async () => {
    const client = new MemoryClient();
    client.writes.set('/gitlab/projects/acme/api/issues/by-id/7.json', JSON.stringify({
      id: '7',
      canonicalPath: '/gitlab/projects/acme/api/issues/7__old-title/meta.json',
      title: 'Old title',
      state: 'opened',
    }));
    client.writes.set('/gitlab/projects/acme/api/issues/7__old-title/meta.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/issues/by-title/old-title__7.json', '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          projectPath: 'acme/api',
          iid: 7,
          title: 'New title',
          state: 'opened',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/7__old-title/meta.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/by-title/old-title__7.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/issues/7__new-title/meta.json'));
    const byTitle = JSON.parse(client.writes.get('/gitlab/projects/acme/api/issues/by-title/new-title__7.json') ?? '{}');
    assert.equal(byTitle.canonicalPath, '/gitlab/projects/acme/api/issues/7__new-title/meta.json');
  });

  it('ignores untrusted issue canonical paths recorded in the by-id alias', async () => {
    const client = new MemoryClient();
    const foreignPath = '/github/repos/acme/api/issues/7__fix-bug/meta.json';
    client.writes.set('/gitlab/projects/acme/api/issues/by-id/7.json', JSON.stringify({
      id: '7',
      canonicalPath: foreignPath,
      title: 'Fix bug',
      state: 'opened',
    }));
    client.writes.set(foreignPath, '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          projectPath: 'acme/api',
          iid: 7,
          title: 'Fix bug',
          state: 'opened',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.writes.has(foreignPath));
    assert.ok(!client.deletes.includes(foreignPath));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/issues/7__fix-bug/meta.json'));
  });

  it('moves issue assignee, creator, and priority aliases on metadata changes', async () => {
    const client = new MemoryClient();
    client.writes.set('/gitlab/projects/acme/api/issues/by-id/7.json', JSON.stringify({
      id: '7',
      canonicalPath: '/gitlab/projects/acme/api/issues/7__fix-bug/meta.json',
      title: 'Fix bug',
      state: 'opened',
      assigneeKeys: ['ada'],
      creatorKey: 'linus',
      priority: 'P1',
    }));
    client.writes.set('/gitlab/projects/acme/api/issues/by-assignee/ada/7.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/issues/by-creator/linus/7.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/issues/by-priority/p1/7.json', '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          projectPath: 'acme/api',
          iid: 7,
          title: 'Fix bug',
          state: 'opened',
          assignees: [{ username: 'grace' }],
          author: { username: 'maintainer' },
          labels: [{ title: 'priority:high' }],
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/by-assignee/ada/7.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/by-creator/linus/7.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/by-priority/p1/7.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/issues/by-assignee/grace/7.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/issues/by-creator/maintainer/7.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/issues/by-priority/high/7.json'));

    await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          projectPath: 'acme/api',
          iid: 7,
          title: 'Fix bug',
          state: 'opened',
          assignees: [{ username: 'grace' }],
          author: { username: 'maintainer' },
          labels: [{ title: 'maintenance' }],
          updated_at: '2026-05-12T10:00:00.000Z',
        },
      ],
    });

    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/by-priority/high/7.json'));
    const byId = JSON.parse(client.writes.get('/gitlab/projects/acme/api/issues/by-id/7.json') ?? '{}');
    assert.equal(byId.priority, undefined);
  });

  it('moves pipeline and deployment by-status aliases on status transitions', async () => {
    const client = new MemoryClient();
    client.writes.set('/gitlab/projects/acme/api/pipelines/by-id/9.json', JSON.stringify({
      id: '9',
      canonicalPath: '/gitlab/projects/acme/api/pipelines/9__main/meta.json',
      ref: 'main',
      status: 'running',
    }));
    client.writes.set('/gitlab/projects/acme/api/pipelines/by-status/running/9.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/deployments/14.json', JSON.stringify({
      id: '14',
      status: 'running',
    }));
    client.writes.set('/gitlab/projects/acme/api/deployments/by-status/running/14.json', '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pipelines: [
        {
          projectPath: 'acme/api',
          id: 9,
          ref: 'main',
          status: 'failed',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
      deployments: [
        {
          projectPath: 'acme/api',
          id: 14,
          status: 'success',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/pipelines/by-status/running/9.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/by-status/failed/9.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/deployments/by-status/running/14.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/deployments/by-status/success/14.json'));
  });

  it('preserves pipeline ref aliases on status-only updates', async () => {
    const client = new MemoryClient();
    client.writes.set('/gitlab/projects/acme/api/pipelines/by-id/9.json', JSON.stringify({
      id: '9',
      canonicalPath: '/gitlab/projects/acme/api/pipelines/9__main/meta.json',
      ref: 'main',
      status: 'running',
    }));
    client.writes.set('/gitlab/projects/acme/api/pipelines/by-ref/main__9.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/pipelines/by-status/running/9.json', '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pipelines: [
        {
          projectPath: 'acme/api',
          id: 9,
          status: 'failed',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/9__main/meta.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/by-ref/main__9.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/pipelines/by-status/running/9.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/by-status/failed/9.json'));
  });

  it('ignores untrusted pipeline canonical paths recorded in the by-id alias', async () => {
    const client = new MemoryClient();
    const foreignPath = '/github/repos/acme/api/actions/runs/9.json';
    client.writes.set('/gitlab/projects/acme/api/pipelines/by-id/9.json', JSON.stringify({
      id: '9',
      canonicalPath: foreignPath,
      ref: 'main',
      status: 'running',
    }));
    client.writes.set(foreignPath, '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pipelines: [
        {
          projectPath: 'acme/api',
          id: 9,
          ref: 'main',
          status: 'failed',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.writes.has(foreignPath));
    assert.ok(!client.deletes.includes(foreignPath));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/pipelines/9__main/meta.json'));
  });

  it('ignores untrusted prior canonical paths while deleting issue, pipeline, and commit tombstones', async () => {
    const client = new MemoryClient();
    const foreignPath = '/github/repos/acme/api/pulls/1__fix/meta.json';
    client.writes.set(foreignPath, '{}');
    client.writes.set('/gitlab/projects/acme/api/issues/by-id/7.json', JSON.stringify({
      id: '7',
      canonicalPath: foreignPath,
      title: 'Fix bug',
      state: 'opened',
    }));
    client.writes.set('/gitlab/projects/acme/api/issues/7__fix-bug/meta.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/issues/by-state/opened/7.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/pipelines/by-id/9.json', JSON.stringify({
      id: '9',
      canonicalPath: foreignPath,
      ref: 'main',
      status: 'running',
    }));
    client.writes.set('/gitlab/projects/acme/api/pipelines/9__main/meta.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/pipelines/by-status/running/9.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/commits/by-id/abc123.json', JSON.stringify({
      id: 'abc123',
      canonicalPath: foreignPath,
      title: 'Old commit',
    }));
    client.writes.set('/gitlab/projects/acme/api/commits/abc123__old-commit/meta.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/commits/by-title/old-commit__abc123.json', '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [{ projectPath: 'acme/api', iid: 7, _deleted: true }],
      pipelines: [{ projectPath: 'acme/api', id: 9, _deleted: true }],
      commits: [{ projectPath: 'acme/api', sha: 'abc123', _deleted: true }],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.writes.has(foreignPath));
    assert.ok(!client.deletes.includes(foreignPath));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/7__fix-bug/meta.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/issues/by-state/opened/7.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/pipelines/9__main/meta.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/pipelines/by-status/running/9.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/commits/abc123__old-commit/meta.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/commits/by-title/old-commit__abc123.json'));
  });

  it('deletes GitLab tag canonical and by-ref alias paths on tombstones', async () => {
    const client = new MemoryClient();
    client.writes.set('/gitlab/projects/acme/api/tags/v1-0__v1.0.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/tags/by-ref/v1-0__v1.0.json', '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      tags: [
        {
          projectPath: 'acme/api',
          ref: 'v1.0',
          _deleted: true,
          updated_at: '2026-05-12T09:00:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/v1-0__v1.0.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/by-ref/v1-0__v1.0.json'));
  });

  it('normalizes GitLab tag refs and falls back to name-only tag records', async () => {
    const client = new MemoryClient();

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      tags: [
        {
          projectPath: 'acme/api',
          id: '20:release/foo__bar',
          ref: 'refs/tags/release/foo__bar',
          updated_at: '2026-05-12T09:00:00.000Z',
        },
        {
          projectPath: 'acme/api',
          id: '20:release/name-only',
          name: 'release/name-only',
          updated_at: '2026-05-12T09:05:00.000Z',
        },
        {
          projectPath: 'acme/api',
          id: '20:refs/tags/release/id-only',
          updated_at: '2026-05-12T09:10:00.000Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.writes.has('/gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/tags/by-ref/release-foo-bar__release%2Ffoo__bar.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/tags/release-name-only__release%2Fname-only.json'));
    assert.ok(client.writes.has('/gitlab/projects/acme/api/tags/release-id-only__release%2Fid-only.json'));

    const index = JSON.parse(client.writes.get('/gitlab/projects/acme/api/tags/_index.json') ?? '[]');
    assert.deepEqual(
      index.map((row: { id: string }) => row.id).sort(),
      ['release/foo__bar', 'release/id-only', 'release/name-only'],
    );
  });

  it('deletes legacy GitLab tag slash paths on complex tag tombstones', async () => {
    const client = new MemoryClient();
    client.writes.set('/gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/tags/by-ref/release-foo-bar__release%2Ffoo__bar.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/tags/release/foo__bar.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/tags/by-ref/release/foo__bar.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/tags/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/tags/by-ref/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/tags/refs/tags/release/foo__bar.json', '{}');
    client.writes.set('/gitlab/projects/acme/api/tags/by-ref/refs/tags/release/foo__bar.json', '{}');

    const result = await emitGitLabAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      tags: [
        {
          projectPath: 'acme/api',
          id: '20:refs/tags/release/foo__bar',
          _deleted: true,
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/by-ref/release-foo-bar__release%2Ffoo__bar.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/release/foo__bar.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/by-ref/release/foo__bar.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/by-ref/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/refs/tags/release/foo__bar.json'));
    assert.ok(!client.writes.has('/gitlab/projects/acme/api/tags/by-ref/refs/tags/release/foo__bar.json'));
  });
});
