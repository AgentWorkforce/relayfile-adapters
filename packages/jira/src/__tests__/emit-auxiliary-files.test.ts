import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emitJiraAuxiliaryFiles } from '../emit-auxiliary-files.js';
import type {
  DeleteFileInput,
  RelayFileClientLike,
  WriteFileInput,
} from '../jira-adapter.js';
import type { EmitReadInput, EmitReadResult } from '@relayfile/adapter-core';
import {
  jiraCommentPath,
  jiraIssueByIdAliasPath,
  jiraIssueByKeyAliasPath,
  jiraIssueByStatePath,
  jiraIssuePath,
  jiraIssuesIndexPath,
  jiraProjectPath,
  jiraProjectsIndexPath,
  jiraSprintPath,
  jiraSprintsIndexPath,
} from '../path-mapper.js';

interface CapturingClient extends RelayFileClientLike {
  writes: WriteFileInput[];
  deletes: DeleteFileInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
  readFile?: (input: EmitReadInput) => Promise<EmitReadResult | null>;
}

function createClient(options: {
  initialFiles?: Record<string, string>;
  failWriteOn?: ReadonlySet<string>;
  noRead?: boolean;
  failReadOn?: ReadonlySet<string>;
} = {}): CapturingClient {
  const files = new Map<string, string>(Object.entries(options.initialFiles ?? {}));
  const writes: WriteFileInput[] = [];
  const deletes: DeleteFileInput[] = [];
  const reads: EmitReadInput[] = [];
  const failWriteOn = options.failWriteOn ?? new Set<string>();
  const failReadOn = options.failReadOn ?? new Set<string>();

  const client: CapturingClient = {
    writes,
    deletes,
    reads,
    files,
    async writeFile(input) {
      writes.push(input);
      if (failWriteOn.has(input.path)) {
        throw new Error(`forced write failure at ${input.path}`);
      }
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      deletes.push(input);
      files.delete(input.path);
    },
  };
  if (!options.noRead) {
    client.readFile = async (input): Promise<EmitReadResult | null> => {
      reads.push(input);
      if (failReadOn.has(input.path)) {
        throw new Error(`forced read failure at ${input.path}`);
      }
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    };
  }
  return client;
}

function makeIssue(over: {
  id: string;
  key?: string;
  summary?: string;
  status?: string;
  projectKey?: string;
  updated?: string;
}): { id: string; key?: string; fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {};
  if (over.summary !== undefined) fields.summary = over.summary;
  if (over.updated !== undefined) fields.updated = over.updated;
  if (over.status) fields.status = { name: over.status };
  if (over.projectKey) fields.project = { key: over.projectKey };
  const issue: { id: string; key?: string; fields: Record<string, unknown> } = {
    id: over.id,
    fields,
  };
  if (over.key !== undefined) issue.key = over.key;
  return issue;
}

describe('emitJiraAuxiliaryFiles', () => {
  it('returns a zero result on empty input', async () => {
    const client = createClient();
    const result = await emitJiraAuxiliaryFiles(client, { workspaceId: 'ws-1' });
    assert.deepEqual(result, { written: 0, deleted: 0, errors: [] });
    assert.equal(client.writes.length, 0);
    assert.equal(client.deletes.length, 0);
  });

  it('writes an empty index for an explicit empty sprint bucket', async () => {
    const client = createClient();
    const result = await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      sprints: [],
    });

    assert.deepEqual(result, { written: 1, deleted: 0, errors: [] });
    assert.equal(client.writes.length, 1);
    assert.equal(client.writes[0]!.path, jiraSprintsIndexPath());
    assert.deepEqual(JSON.parse(client.files.get(jiraSprintsIndexPath())!), []);
  });

  it('writes canonical + by-id + by-key + by-state for an issue plus an index row', async () => {
    const client = createClient();
    const issue = makeIssue({
      id: '10001',
      key: 'KAN-42',
      summary: 'Release Plan',
      status: 'In Progress',
      projectKey: 'KAN',
      updated: '2026-05-12T00:00:00Z',
    });

    const result = await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [issue],
    });

    // 4 file writes (canonical + by-id + by-key + by-state) + 1 index write.
    assert.equal(result.written, 5);
    assert.deepEqual(result.errors, []);

    const expectedFilePaths = [
      jiraIssuePath('10001', 'Release Plan'),
      jiraIssueByIdAliasPath('10001'),
      jiraIssueByKeyAliasPath('KAN-42'),
      jiraIssueByStatePath('In Progress', '10001'),
    ];
    const writtenPaths = client.writes.map((w) => w.path);
    for (const expected of expectedFilePaths) {
      assert.ok(writtenPaths.includes(expected), `missing expected path ${expected}`);
    }
    assert.ok(writtenPaths.includes(jiraIssuesIndexPath()));

    // by-state lives under the slugged status folder.
    assert.ok(
      writtenPaths.some((p) => p.startsWith('/jira/issues/by-state/in-progress/')),
      'by-state path should be slugged to "in-progress"',
    );

    // Index row shape matches the LAYOUT contract.
    const indexBytes = client.files.get(jiraIssuesIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{
      id: string;
      title: string;
      updated: string;
      key: string;
      state: string;
      projectKey: string;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, '10001');
    assert.equal(rows[0]!.title, 'Release Plan');
    assert.equal(rows[0]!.updated, '2026-05-12T00:00:00Z');
    assert.equal(rows[0]!.key, 'KAN-42');
    assert.equal(rows[0]!.state, 'In Progress');
    assert.equal(rows[0]!.projectKey, 'KAN');

    // Canonical bytes are identical at every emitted file path.
    const canonicalBytes = client.files.get(jiraIssuePath('10001', 'Release Plan'));
    for (const path of expectedFilePaths) {
      assert.equal(client.files.get(path), canonicalBytes, `bytes mismatch at ${path}`);
    }
  });

  it('reconciles prior canonical on summary rename; by-key remains stable', async () => {
    const priorPayload = {
      provider: 'jira',
      objectType: 'issue',
      objectId: '10001',
      deleted: false,
      payload: {
        id: '10001',
        key: 'KAN-42',
        fields: {
          summary: 'Old Summary',
          status: { name: 'In Progress' },
        },
      },
    };
    const client = createClient({
      initialFiles: {
        [jiraIssueByIdAliasPath('10001')]: JSON.stringify(priorPayload),
      },
    });

    const result = await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        makeIssue({
          id: '10001',
          key: 'KAN-42',
          summary: 'New Summary',
          status: 'In Progress',
        }),
      ],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    // Old canonical slug was 'old-summary'; it must be deleted.
    assert.ok(
      deletedPaths.includes(jiraIssuePath('10001', 'Old Summary')),
      `expected prior canonical in deletes, got: ${deletedPaths.join(', ')}`,
    );
    // by-key didn't change → not in deletes.
    assert.ok(!deletedPaths.includes(jiraIssueByKeyAliasPath('KAN-42')));
    // by-id is the anchor → never in deletes.
    assert.ok(!deletedPaths.includes(jiraIssueByIdAliasPath('10001')));

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(jiraIssuePath('10001', 'New Summary')));
    assert.ok(writtenPaths.includes(jiraIssueByKeyAliasPath('KAN-42')));
    assert.deepEqual(result.errors, []);
  });

  it('deletes old by-state and writes new by-state on a status transition', async () => {
    const priorPayload = {
      payload: {
        id: '10001',
        key: 'KAN-42',
        fields: {
          summary: 'Release Plan',
          status: { name: 'To Do' },
        },
      },
    };
    const client = createClient({
      initialFiles: {
        [jiraIssueByIdAliasPath('10001')]: JSON.stringify(priorPayload),
      },
    });

    await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        makeIssue({
          id: '10001',
          key: 'KAN-42',
          summary: 'Release Plan',
          status: 'In Progress',
        }),
      ],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(jiraIssueByStatePath('To Do', '10001')),
      `expected old by-state path deleted, got: ${deletedPaths.join(', ')}`,
    );
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(jiraIssueByStatePath('In Progress', '10001')));
  });

  it('writes canonical + index row for a project record', async () => {
    const client = createClient();
    await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      projects: [{ id: '99', key: 'KAN', name: 'Kanban Project' }],
    });
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(jiraProjectPath('99', 'Kanban Project')));
    assert.ok(writtenPaths.includes(jiraProjectsIndexPath()));

    const rows = JSON.parse(client.files.get(jiraProjectsIndexPath())!) as Array<{
      id: string;
      title: string;
      key: string;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, '99');
    assert.equal(rows[0]!.title, 'Kanban Project');
    assert.equal(rows[0]!.key, 'KAN');
  });

  it('writes canonical + index row for a sprint record', async () => {
    const client = createClient();
    await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      sprints: [{ id: 7, name: 'Sprint 7', state: 'active' }],
    });
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(jiraSprintPath('7', 'Sprint 7')));
    assert.ok(writtenPaths.includes(jiraSprintsIndexPath()));

    const rows = JSON.parse(client.files.get(jiraSprintsIndexPath())!) as Array<{
      id: string;
      title: string;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, '7');
    assert.equal(rows[0]!.title, 'Sprint 7');
  });

  it('writes a comment at the nested /jira/issues/<issueIdOrKey>/comments path', async () => {
    const client = createClient();
    await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      comments: [
        { id: '500', body: 'lgtm', issueIdOrKey: 'KAN-42' },
      ],
    });
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(jiraCommentPath('500', 'KAN-42')));
    assert.equal(writtenPaths[0], '/jira/issues/KAN-42/comments/500.json');
  });

  it('drops the index row when an issue tombstone arrives (no ghost entries)', async () => {
    // Regression for the Devin finding on PR #78: planIssueDelete must
    // call `IndexFileReconciler.remove(id)` alongside the file deletes
    // or `_index.json` accumulates entries for records whose canonical
    // and alias files are gone.
    const priorPayload = {
      payload: {
        id: '10001',
        key: 'KAN-42',
        fields: {
          summary: 'Release Plan',
          status: { name: 'In Progress' },
        },
      },
    };
    const priorIndex = [
      {
        id: '10001',
        title: 'Release Plan',
        updated: '2026-05-12T00:00:00Z',
        key: 'KAN-42',
        state: 'In Progress',
        projectKey: 'KAN',
      },
      {
        id: '10002',
        title: 'Other',
        updated: '2026-05-11T00:00:00Z',
        key: 'KAN-43',
        state: 'To Do',
        projectKey: 'KAN',
      },
    ];
    const client = createClient({
      initialFiles: {
        [jiraIssueByIdAliasPath('10001')]: JSON.stringify(priorPayload),
        [jiraIssuesIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [{ id: '10001', _deleted: true }],
    });

    // Every alias and the canonical record dropped.
    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    for (const expected of [
      jiraIssuePath('10001', 'Release Plan'),
      jiraIssueByIdAliasPath('10001'),
      jiraIssueByKeyAliasPath('KAN-42'),
      jiraIssueByStatePath('In Progress', '10001'),
    ]) {
      assert.ok(deletedPaths.has(expected), `expected delete at ${expected}`);
    }

    // Index file got rewritten without the deleted row.
    const indexWrite = client.writes.find((w) => w.path === jiraIssuesIndexPath());
    assert.ok(indexWrite, 'expected an index write after delete to prune the row');
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(
      writtenRows.map((r) => r.id),
      ['10002'],
      'deleted issue id should no longer appear in the index',
    );
  });

  it('degrades to no reconciliation when the client lacks readFile', async () => {
    const client = createClient({ noRead: true });
    const result = await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        makeIssue({
          id: '10001',
          key: 'KAN-42',
          summary: 'Release Plan',
          status: 'In Progress',
        }),
      ],
    });

    // No reconciliation deletes happened because reads aren't supported.
    assert.equal(client.deletes.length, 0);
    assert.deepEqual(result.errors, []);

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(jiraIssueByIdAliasPath('10001')));
    assert.ok(writtenPaths.includes(jiraIssueByKeyAliasPath('KAN-42')));
  });

  it('captures per-path write failures in errors without aborting the fan-out', async () => {
    const failingPath = jiraIssueByKeyAliasPath('KAN-42');
    const client = createClient({ failWriteOn: new Set([failingPath]) });

    const result = await emitJiraAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        makeIssue({
          id: '10001',
          key: 'KAN-42',
          summary: 'Release Plan',
          status: 'In Progress',
        }),
      ],
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.path, failingPath);
    assert.match(result.errors[0]!.error, /forced write failure/);

    // The remaining paths landed, including by-id (the anchor).
    assert.ok(client.files.has(jiraIssueByIdAliasPath('10001')));
    assert.ok(client.files.has(jiraIssueByStatePath('In Progress', '10001')));
    assert.ok(client.files.has(jiraIssuesIndexPath()));
  });
});
