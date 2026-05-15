import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AuxiliaryEmitterClient,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from '@relayfile/adapter-core';

import { emitClickUpAuxiliaryFiles } from '../emit-auxiliary-files.js';
import {
  clickUpTaskByAssigneePath,
  clickUpTaskByCreatorPath,
  clickUpTaskByIdAliasPath,
  clickUpTaskByPriorityPath,
  clickUpTaskByStatePath,
} from '../path-mapper.js';

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  files: Map<string, string>;
}

function createClient(initialFiles: Record<string, string> = {}): CapturingClient {
  const files = new Map(Object.entries(initialFiles));
  return {
    writes: [],
    deletes: [],
    files,
    async writeFile(input) {
      this.writes.push(input);
      this.files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      this.deletes.push(input);
      this.files.delete(input.path);
    },
    async readFile(input: EmitReadInput): Promise<EmitReadResult | null> {
      const content = this.files.get(input.path);
      return content === undefined ? null : { content };
    },
  };
}

test('emitClickUpAuxiliaryFiles materializes task aliases for state, assignees, creator, and priority', async () => {
  const client = createClient();
  const result = await emitClickUpAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    tasks: [{
      id: 'task_1',
      name: 'Close launch checklist',
      status: { status: 'in progress' },
      assignees: [{ id: 1, username: 'Ada' }, { id: '2', username: 'Grace' }],
      creator: { id: 'creator_1', username: 'Lin' },
      priority: { priority: 'high' },
    }],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.deleted, 0);
  assert.equal(result.written, 6);
  assert.deepEqual(client.writes.map((write) => write.path), [
    clickUpTaskByIdAliasPath('task_1'),
    clickUpTaskByStatePath('in progress', 'task_1'),
    clickUpTaskByAssigneePath('1', 'task_1'),
    clickUpTaskByAssigneePath('2', 'task_1'),
    clickUpTaskByCreatorPath('creator_1', 'task_1'),
    clickUpTaskByPriorityPath('high', 'task_1'),
  ]);
});

test('emitClickUpAuxiliaryFiles removes stale grouped aliases on task transitions', async () => {
  const client = createClient({
    [clickUpTaskByIdAliasPath('task_1')]: JSON.stringify({
      provider: 'clickup',
      objectType: 'task',
      objectId: 'task_1',
      payload: {
        id: 'task_1',
        status: { status: 'to do' },
        assignees: [{ id: 'old_assignee' }],
        creator: { id: 'old_creator' },
        priority: { priority: 'low' },
      },
    }),
  });

  const result = await emitClickUpAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    tasks: [{
      id: 'task_1',
      status: { status: 'done' },
      assignees: [{ id: 'new_assignee' }],
      creator: { id: 'new_creator' },
      priority: { priority: 'urgent' },
    }],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(client.deletes.map((del) => del.path), [
    clickUpTaskByStatePath('to do', 'task_1'),
    clickUpTaskByAssigneePath('old_assignee', 'task_1'),
    clickUpTaskByCreatorPath('old_creator', 'task_1'),
    clickUpTaskByPriorityPath('low', 'task_1'),
  ]);
  assert.ok(client.files.has(clickUpTaskByStatePath('done', 'task_1')));
  assert.ok(client.files.has(clickUpTaskByAssigneePath('new_assignee', 'task_1')));
});

test('emitClickUpAuxiliaryFiles deletes prior task aliases for tombstones', async () => {
  const client = createClient({
    [clickUpTaskByIdAliasPath('task_1')]: JSON.stringify({
      provider: 'clickup',
      objectType: 'task',
      objectId: 'task_1',
      payload: {
        id: 'task_1',
        status: { status: 'done' },
        assignees: [{ id: 'user_assignee' }],
        creator: { id: 'user_creator' },
        priority: { priority: 'high' },
      },
    }),
  });

  const result = await emitClickUpAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    tasks: [{ id: 'task_1', _deleted: true }],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.deleted, 5);
  assert.deepEqual(client.deletes.map((del) => del.path), [
    clickUpTaskByIdAliasPath('task_1'),
    clickUpTaskByStatePath('done', 'task_1'),
    clickUpTaskByAssigneePath('user_assignee', 'task_1'),
    clickUpTaskByCreatorPath('user_creator', 'task_1'),
    clickUpTaskByPriorityPath('high', 'task_1'),
  ]);
});
