import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AuxiliaryEmitterClient,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from '@relayfile/adapter-core';

import { emitAsanaAuxiliaryFiles } from '../emit-auxiliary-files.js';
import {
  asanaTaskByAssigneePath,
  asanaTaskByCreatorPath,
  asanaTaskByIdAliasPath,
  asanaTaskByPriorityPath,
  asanaTaskByStatePath,
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

test('emitAsanaAuxiliaryFiles materializes task aliases for state, assignee, creator, and priority', async () => {
  const client = createClient();
  const result = await emitAsanaAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    tasks: [{
      gid: 'task_1',
      name: 'Close launch checklist',
      completed: true,
      assignee: { gid: 'user_assignee', name: 'Ada' },
      created_by: { gid: 'user_creator', name: 'Grace' },
      custom_fields: [{ name: 'Priority', display_value: 'High' }],
    }],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.deleted, 0);
  assert.equal(result.written, 5);
  assert.deepEqual(client.writes.map((write) => write.path), [
    asanaTaskByIdAliasPath('task_1'),
    asanaTaskByStatePath('completed', 'task_1'),
    asanaTaskByAssigneePath('user_assignee', 'task_1'),
    asanaTaskByCreatorPath('user_creator', 'task_1'),
    asanaTaskByPriorityPath('High', 'task_1'),
  ]);
});

test('emitAsanaAuxiliaryFiles removes stale grouped aliases on task transitions', async () => {
  const oldById = asanaTaskByIdAliasPath('task_1');
  const client = createClient({
    [oldById]: JSON.stringify({
      provider: 'asana',
      objectType: 'task',
      objectId: 'task_1',
      payload: {
        gid: 'task_1',
        completed: false,
        assignee: { gid: 'old_assignee' },
        created_by: { gid: 'old_creator' },
        custom_fields: [{ name: 'Priority', display_value: 'Low' }],
      },
    }),
  });

  const result = await emitAsanaAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    tasks: [{
      gid: 'task_1',
      completed: true,
      assignee: { gid: 'new_assignee' },
      created_by: { gid: 'new_creator' },
      custom_fields: [{ name: 'Priority', display_value: 'High' }],
    }],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(client.deletes.map((del) => del.path), [
    asanaTaskByStatePath('open', 'task_1'),
    asanaTaskByAssigneePath('old_assignee', 'task_1'),
    asanaTaskByCreatorPath('old_creator', 'task_1'),
    asanaTaskByPriorityPath('Low', 'task_1'),
  ]);
  assert.ok(client.files.has(asanaTaskByStatePath('completed', 'task_1')));
  assert.ok(client.files.has(asanaTaskByAssigneePath('new_assignee', 'task_1')));
});

test('emitAsanaAuxiliaryFiles deletes prior task aliases for tombstones', async () => {
  const client = createClient({
    [asanaTaskByIdAliasPath('task_1')]: JSON.stringify({
      provider: 'asana',
      objectType: 'task',
      objectId: 'task_1',
      payload: {
        gid: 'task_1',
        completed: true,
        assignee: { gid: 'user_assignee' },
        created_by: { gid: 'user_creator' },
        custom_fields: [{ name: 'Priority', display_value: 'High' }],
      },
    }),
  });

  const result = await emitAsanaAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    tasks: [{ gid: 'task_1', _deleted: true }],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.deleted, 5);
  assert.deepEqual(client.deletes.map((del) => del.path), [
    asanaTaskByIdAliasPath('task_1'),
    asanaTaskByStatePath('completed', 'task_1'),
    asanaTaskByAssigneePath('user_assignee', 'task_1'),
    asanaTaskByCreatorPath('user_creator', 'task_1'),
    asanaTaskByPriorityPath('High', 'task_1'),
  ]);
});
