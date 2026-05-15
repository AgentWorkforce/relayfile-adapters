import assert from 'node:assert/strict';
import test from 'node:test';

import { emitGitLabAuxiliaryFiles } from '../src/emit-auxiliary-files.js';

test('GitLab issue tombstones delete canonical and alias files using prior by-id context', async () => {
  const writes: Array<{ path: string; content: string }> = [];
  const deletes: string[] = [];
  const seed = new Map<string, unknown>([
    [
      '/gitlab/projects/acme/api/issues/by-id/17.json',
      {
        id: '17',
        canonicalPath: '/gitlab/projects/acme/api/issues/17__fix-sync-state/meta.json',
        title: 'Fix sync state',
        state: 'opened',
        assigneeKeys: ['assignee-1'],
        creatorKey: 'creator-1',
        priority: 'high',
      },
    ],
    [
      '/gitlab/projects/acme/api/issues/_index.json',
      [
        {
          id: '17',
          title: 'Fix sync state',
          updated: '2026-05-15T10:00:00.000Z',
          iid: 17,
          state: 'opened',
        },
      ],
    ],
  ]);

  const result = await emitGitLabAuxiliaryFiles(
    {
      async writeFile(input) {
        writes.push({ path: input.path, content: input.content });
      },
      async deleteFile(input) {
        deletes.push(input.path);
      },
      async readFile(input) {
        if (seed.has(input.path)) {
          return { content: JSON.stringify(seed.get(input.path)) };
        }
        const error = new Error('not found') as Error & { status: number };
        error.status = 404;
        throw error;
      },
    },
    {
      workspaceId: 'ws_test',
      issues: [
        {
          iid: '17',
          project_path: 'acme/api',
          title: 'Renamed before delete',
          state: 'closed',
          assignees: [],
          _deleted: true,
        },
      ],
    },
  );

  assert.equal(result.errors.length, 0);
  assert.ok(deletes.includes('/gitlab/projects/acme/api/issues/17__fix-sync-state/meta.json'));
  assert.ok(deletes.includes('/gitlab/projects/acme/api/issues/by-id/17.json'));
  assert.ok(deletes.includes('/gitlab/projects/acme/api/issues/by-state/opened/17.json'));
  assert.ok(deletes.includes('/gitlab/projects/acme/api/issues/by-assignee/assignee-1/17.json'));
  assert.ok(deletes.includes('/gitlab/projects/acme/api/issues/by-creator/creator-1/17.json'));
  assert.ok(deletes.includes('/gitlab/projects/acme/api/issues/by-priority/high/17.json'));
  assert.ok(deletes.includes('/gitlab/projects/acme/api/issues/17__renamed-before-delete/meta.json'));
  assert.ok(deletes.includes('/gitlab/projects/acme/api/issues/by-state/closed/17.json'));

  const indexWrite = writes.find((write) => write.path === '/gitlab/projects/acme/api/issues/_index.json');
  assert.ok(indexWrite, 'expected issue index rewrite');
  assert.deepEqual(JSON.parse(indexWrite.content), []);
});
