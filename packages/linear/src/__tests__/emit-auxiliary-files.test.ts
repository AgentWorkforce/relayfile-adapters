import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  AuxiliaryEmitterClient,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from '@relayfile/adapter-core';

import { emitLinearAuxiliaryFiles } from '../emit-auxiliary-files.js';
import {
  LINEAR_PATH_ROOT,
  linearByIdAliasPath,
  linearByNameAliasPath,
  linearByTitleAliasPath,
  linearByUuidAliasPath,
  linearCyclesIndexPath,
  linearIssueByAssigneePath,
  linearIssueByCreatorPath,
  linearIssueByEditedPath,
  linearIssueByPriorityPath,
  linearIssueByStatePath,
  linearIssuePath,
  linearIssuesIndexPath,
  linearProjectsIndexPath,
  linearProjectPath,
  linearRootIndexPath,
  linearTeamPath,
  linearTeamsIndexPath,
  linearUserPath,
  linearUsersIndexPath,
} from '../path-mapper.js';

const ISSUES_SCOPE = `${LINEAR_PATH_ROOT}/issues`;

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
}

function createClient(
  options: {
    initialFiles?: Record<string, string>;
    failWriteOn?: ReadonlySet<string>;
    noRead?: boolean;
    failReadOn?: ReadonlySet<string>;
  } = {},
): CapturingClient {
  const files = new Map<string, string>(Object.entries(options.initialFiles ?? {}));
  const writes: EmitWriteInput[] = [];
  const deletes: EmitDeleteInput[] = [];
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

describe('emitLinearAuxiliaryFiles', () => {
  it('always writes /linear/_index.json root index on empty input', async () => {
    const client = createClient();
    const result = await emitLinearAuxiliaryFiles(client, { workspaceId: 'ws-1' });
    assert.deepEqual(result.errors, []);
    assert.equal(result.deleted, 0);
    assert.equal(result.written, 1);
    assert.equal(client.writes.length, 1);
    assert.equal(client.writes[0]!.path, linearRootIndexPath());
    const rows = JSON.parse(client.files.get(linearRootIndexPath())!);
    assert.deepEqual(rows, [
      { id: 'issues', title: 'Issues' },
      { id: 'comments', title: 'Comments' },
      { id: 'teams', title: 'Teams' },
      { id: 'users', title: 'Users' },
      { id: 'projects', title: 'Projects' },
      { id: 'cycles', title: 'Cycles' },
      { id: 'milestones', title: 'Milestones' },
      { id: 'roadmaps', title: 'Roadmaps' },
    ]);
    assert.equal(client.deletes.length, 0);
  });

  it('emits /linear/_index.json alongside non-empty buckets', async () => {
    const client = createClient();
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      teams: [{ id: 'team-1', name: 'Core' }],
    });
    assert.ok(
      client.writes.some((w) => w.path === linearRootIndexPath()),
      'expected /linear/_index.json root index write',
    );
  });

  it('materializes advertised project and team aliases and reconciles renames', async () => {
    const client = createClient({
      initialFiles: {
        [linearByIdAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'project-1')]: JSON.stringify({
          provider: 'linear',
          objectType: 'project',
          objectId: 'project-1',
          payload: { id: 'project-1', name: 'Old Project' },
        }),
        [linearByTitleAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'Old Project', 'project-1')]: '{}',
        [linearByIdAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'team-1')]: JSON.stringify({
          provider: 'linear',
          objectType: 'team',
          objectId: 'team-1',
          payload: { id: 'team-1', name: 'Old Team' },
        }),
        [linearByNameAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'Old Team', 'team-1')]: '{}',
      },
    });

    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      projects: [{ id: 'project-1', name: 'New Project', updatedAt: '2026-05-12T00:00:00Z' }],
      teams: [{ id: 'team-1', name: 'New Team', key: 'CORE', updatedAt: '2026-05-12T00:00:00Z' }],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.files.has(linearProjectPath('project-1')));
    assert.ok(client.files.has(linearByIdAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'project-1')));
    assert.ok(client.files.has(linearByTitleAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'New Project', 'project-1')));
    assert.ok(!client.files.has(linearByTitleAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'Old Project', 'project-1')));
    assert.ok(client.files.has(linearTeamPath('team-1')));
    assert.ok(client.files.has(linearByIdAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'team-1')));
    assert.ok(client.files.has(linearByNameAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'New Team', 'team-1')));
    assert.ok(!client.files.has(linearByNameAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'Old Team', 'team-1')));
  });

  it('disambiguates project and team alias slug collisions', async () => {
    const client = createClient();
    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      projects: [
        { id: 'project-1', name: 'Roadmap', updatedAt: '2026-05-12T00:00:00Z' },
        { id: 'project-2', name: 'Roadmap!!!', updatedAt: '2026-05-12T00:00:00Z' },
      ],
      teams: [
        { id: 'team-1', name: 'Core', updatedAt: '2026-05-12T00:00:00Z' },
        { id: 'team-2', name: 'Core!!!', updatedAt: '2026-05-12T00:00:00Z' },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.files.has(linearByTitleAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'Roadmap', 'project-1')));
    assert.ok(client.files.has(linearByTitleAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'Roadmap!!!', 'project-2', true)));
    assert.ok(client.files.has(linearByNameAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'Core', 'team-1')));
    assert.ok(client.files.has(linearByNameAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'Core!!!', 'team-2', true)));
  });

  it('disambiguates project and team alias slug collisions without readFile support', async () => {
    const client = createClient({ noRead: true });
    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      projects: [
        { id: 'project-1', name: 'Roadmap', updatedAt: '2026-05-12T00:00:00Z' },
        { id: 'project-2', name: 'Roadmap!!!', updatedAt: '2026-05-12T00:00:00Z' },
      ],
      teams: [
        { id: 'team-1', name: 'Core', updatedAt: '2026-05-12T00:00:00Z' },
        { id: 'team-2', name: 'Core!!!', updatedAt: '2026-05-12T00:00:00Z' },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.files.has(linearByTitleAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'Roadmap', 'project-1')));
    assert.ok(client.files.has(linearByTitleAliasPath(`${LINEAR_PATH_ROOT}/projects`, 'Roadmap!!!', 'project-2', true)));
    assert.ok(client.files.has(linearByNameAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'Core', 'team-1')));
    assert.ok(client.files.has(linearByNameAliasPath(`${LINEAR_PATH_ROOT}/teams`, 'Core!!!', 'team-2', true)));
  });

  it('writes an empty index for an explicit empty cycle bucket', async () => {
    const client = createClient();
    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      cycles: [],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.deleted, 0);
    assert.equal(result.written, 2);
    assert.deepEqual(
      client.writes.map((w) => w.path),
      [linearRootIndexPath(), linearCyclesIndexPath()],
    );
    assert.deepEqual(JSON.parse(client.files.get(linearCyclesIndexPath())!), []);
  });

  it('writes the canonical path plus by-uuid, by-id, by-title, by-state aliases plus index row for an issue', async () => {
    const client = createClient();
    const issue = {
      id: 'issue-123',
      identifier: 'AGE-8',
      title: 'Release Plan',
      state: { id: 'state-1', name: 'In Progress' },
      assignee: { id: 'user-assignee', name: 'Alice' },
      creator: { id: 'user-creator', name: 'Casey' },
      priority: 2,
      updatedAt: '2026-05-12T00:00:00Z',
    };
    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [issue],
    });

    // Issue emits 9 files (canonical + by-uuid + by-id + by-title + category aliases + by-edited) + 1 issues index + 1 root index.
    assert.equal(result.written, 11);
    assert.deepEqual(result.errors, []);

    const expectedPaths = [
      linearIssuePath('issue-123', 'AGE-8'),
      linearByUuidAliasPath(ISSUES_SCOPE, 'issue-123'),
      linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8'),
      linearByTitleAliasPath(ISSUES_SCOPE, 'Release Plan', 'issue-123'),
      linearIssueByStatePath('In Progress', 'AGE-8'),
      linearIssueByAssigneePath('user-assignee', 'AGE-8'),
      linearIssueByCreatorPath('user-creator', 'AGE-8'),
      linearIssueByPriorityPath(2, 'AGE-8'),
      linearIssueByEditedPath('2026-05-12', 'issue-123'),
      linearIssuesIndexPath(),
    ];
    const writtenPaths = client.writes.map((w) => w.path);
    for (const expected of expectedPaths) {
      assert.ok(writtenPaths.includes(expected), `missing expected path ${expected}`);
    }

    // Index row carries identifier + state.
    const indexBytes = client.files.get(linearIssuesIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{
      id: string;
      title: string;
      identifier: string;
      state: string;
      updated: string;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'issue-123');
    assert.equal(rows[0]!.identifier, 'AGE-8');
    assert.equal(rows[0]!.state, 'In Progress');
    assert.equal(rows[0]!.title, 'Release Plan');

    // Canonical bytes are identical at every emitted alias path.
    const canonicalBytes = client.files.get(linearIssuePath('issue-123', 'AGE-8'));
    for (const path of expectedPaths) {
      if (path === linearIssuesIndexPath()) continue;
      assert.equal(client.files.get(path), canonicalBytes, `bytes mismatch at ${path}`);
    }
  });

  it('reconciles prior by-title alias and canonical path on issue rename via the by-id anchor', async () => {
    const priorPayload = {
      provider: 'linear',
      objectType: 'issue',
      objectId: 'issue-123',
      deleted: false,
      payload: {
        id: 'issue-123',
        identifier: 'AGE-8',
        title: 'Old Title',
        state: { name: 'In Progress' },
        updatedAt: '2026-05-11T00:00:00Z',
      },
    };
    const client = createClient({
      initialFiles: {
        [linearByUuidAliasPath(ISSUES_SCOPE, 'issue-123')]: JSON.stringify(priorPayload),
      },
    });

    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-123',
          identifier: 'AGE-8',
          title: 'New Title',
          state: { id: 's', name: 'In Progress' },
          updatedAt: '2026-05-12T00:00:00Z',
        },
      ],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    // Prior by-title alias should be deleted (title changed).
    assert.ok(
      deletedPaths.includes(linearByTitleAliasPath(ISSUES_SCOPE, 'Old Title', 'issue-123')),
      `expected prior by-title alias in deletes, got: ${deletedPaths.join(', ')}`,
    );
    // by-id alias stays — it's keyed on the identifier, which didn't change.
    assert.ok(!deletedPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8')));
    // by-uuid alias stays — it's keyed on the UUID, which never changes.
    assert.ok(!deletedPaths.includes(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-123')));
    assert.ok(
      deletedPaths.includes(linearIssueByEditedPath('2026-05-11', 'issue-123')),
      `expected prior by-edited alias in deletes, got: ${deletedPaths.join(', ')}`,
    );

    // New by-title alias and canonical path landed.
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearByTitleAliasPath(ISSUES_SCOPE, 'New Title', 'issue-123')));
    assert.ok(writtenPaths.includes(linearIssuePath('issue-123', 'AGE-8')));
    assert.ok(writtenPaths.includes(linearIssueByEditedPath('2026-05-12', 'issue-123')));

    assert.deepEqual(result.errors, []);
  });

  it('reconciles by-state alias on issue state transition', async () => {
    const priorPayload = {
      provider: 'linear',
      objectType: 'issue',
      objectId: 'issue-123',
      payload: {
        id: 'issue-123',
        identifier: 'AGE-8',
        title: 'Release Plan',
        state: { name: 'Todo' },
      },
    };
    const client = createClient({
      initialFiles: {
        [linearByUuidAliasPath(ISSUES_SCOPE, 'issue-123')]: JSON.stringify(priorPayload),
      },
    });

    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-123',
          identifier: 'AGE-8',
          title: 'Release Plan',
          state: { id: 's', name: 'Done' },
        },
      ],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(linearIssueByStatePath('Todo', 'AGE-8')),
      `expected prior by-state alias in deletes, got: ${deletedPaths.join(', ')}`,
    );
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearIssueByStatePath('Done', 'AGE-8')));
  });

  it('reconciles issue assignee, creator, and priority aliases on metadata changes', async () => {
    const priorPayload = {
      provider: 'linear',
      objectType: 'issue',
      objectId: 'issue-123',
      payload: {
        id: 'issue-123',
        identifier: 'AGE-8',
        title: 'Release Plan',
        state: { name: 'Todo' },
        assignee: { id: 'user-a' },
        creator: { id: 'user-c' },
        priority: 1,
      },
    };
    const client = createClient({
      initialFiles: {
        [linearByUuidAliasPath(ISSUES_SCOPE, 'issue-123')]: JSON.stringify(priorPayload),
      },
    });

    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-123',
          identifier: 'AGE-8',
          title: 'Release Plan',
          state: { id: 's', name: 'Todo' },
          assignee: { id: 'user-b' },
          creator: { id: 'user-d' },
          priority: 4,
        },
      ],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(deletedPaths.includes(linearIssueByAssigneePath('user-a', 'AGE-8')));
    assert.ok(deletedPaths.includes(linearIssueByCreatorPath('user-c', 'AGE-8')));
    assert.ok(deletedPaths.includes(linearIssueByPriorityPath(1, 'AGE-8')));

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearIssueByAssigneePath('user-b', 'AGE-8')));
    assert.ok(writtenPaths.includes(linearIssueByCreatorPath('user-d', 'AGE-8')));
    assert.ok(writtenPaths.includes(linearIssueByPriorityPath(4, 'AGE-8')));
  });

  it('writes canonical user + index row', async () => {
    const client = createClient();
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [
        {
          id: 'user-1',
          displayName: 'Alice',
          email: 'alice@example.com',
          updatedAt: '2026-05-12T00:00:00Z',
        },
      ],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearUserPath('user-1')));
    assert.ok(writtenPaths.includes(linearUsersIndexPath()));

    const indexBytes = client.files.get(linearUsersIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{ id: string; title: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'user-1');
    assert.equal(rows[0]!.title, 'Alice');
  });

  it('writes canonical team + index row', async () => {
    const client = createClient();
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      teams: [
        {
          id: 'team-1',
          name: 'Engineering',
          key: 'ENG',
          updatedAt: '2026-05-12T00:00:00Z',
        },
      ],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearTeamPath('team-1')));
    assert.ok(writtenPaths.includes(linearTeamsIndexPath()));

    const indexBytes = client.files.get(linearTeamsIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{ id: string; title: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'team-1');
    assert.equal(rows[0]!.title, 'Engineering');
  });

  it('writes canonical project file plus index row', async () => {
    const client = createClient();
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      projects: [
        {
          id: 'project-1',
          name: 'Roadmap',
          updatedAt: '2026-05-12T00:00:00Z',
        },
      ],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearProjectPath('project-1')));
    assert.ok(writtenPaths.includes(linearProjectsIndexPath()));
    const rows = JSON.parse(client.files.get(linearProjectsIndexPath())!) as Array<{ id: string; title: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'project-1');
    assert.equal(rows[0]!.title, 'Roadmap');
  });

  it('delete tombstone for an issue removes canonical + every prior alias and drops the index row', async () => {
    const priorPayload = {
      provider: 'linear',
      objectType: 'issue',
      objectId: 'issue-123',
      payload: {
        id: 'issue-123',
        identifier: 'AGE-8',
        title: 'Release Plan',
        state: { name: 'In Progress' },
      },
    };
    const priorIndex = [
      {
        id: 'issue-123',
        title: 'Release Plan',
        updated: '2026-05-12T00:00:00Z',
        identifier: 'AGE-8',
        state: 'In Progress',
      },
      {
        id: 'issue-456',
        title: 'Other Issue',
        updated: '2026-05-11T00:00:00Z',
        identifier: 'AGE-9',
        state: 'Todo',
      },
    ];
    const client = createClient({
      initialFiles: {
        [linearByUuidAliasPath(ISSUES_SCOPE, 'issue-123')]: JSON.stringify(priorPayload),
        [linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8')]: JSON.stringify(priorPayload),
        [linearIssuesIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [{ id: 'issue-123', _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    const expectedDeletes = [
      linearIssuePath('issue-123', 'AGE-8'),
      linearByUuidAliasPath(ISSUES_SCOPE, 'issue-123'),
      linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8'),
      linearByTitleAliasPath(ISSUES_SCOPE, 'Release Plan', 'issue-123'),
      linearIssueByStatePath('In Progress', 'AGE-8'),
    ];
    for (const path of expectedDeletes) {
      assert.ok(deletedPaths.has(path), `expected delete at ${path}`);
    }

    // Index row dropped (Devin regression #78).
    const indexWrite = client.writes.find((w) => w.path === linearIssuesIndexPath());
    assert.ok(indexWrite, 'expected an index write after delete to prune the row');
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(
      writtenRows.map((r) => r.id),
      ['issue-456'],
      'deleted issue id should no longer appear in the index',
    );
    assert.equal(result.deleted, expectedDeletes.length);
  });

  it('delete tombstone for a user drops the index row', async () => {
    const priorIndex = [
      { id: 'user-1', title: 'Alice', updated: '2026-05-12T00:00:00Z' },
      { id: 'user-2', title: 'Bob', updated: '2026-05-11T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [linearUsersIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [{ id: 'user-1', _deleted: true }],
    });

    const indexWrite = client.writes.find((w) => w.path === linearUsersIndexPath());
    assert.ok(indexWrite, 'expected index write after delete to prune the row');
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(writtenRows.map((r) => r.id), ['user-2']);
  });

  it('skips reconciliation when the client has no readFile but still emits new aliases', async () => {
    const client = createClient({ noRead: true });
    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-123',
          identifier: 'AGE-8',
          title: 'Release Plan',
          state: { id: 's', name: 'In Progress' },
        },
      ],
    });

    // No reconciliation deletes: there's no prior state to read.
    assert.equal(client.deletes.length, 0);
    assert.deepEqual(result.errors, []);

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-123')));
    assert.ok(writtenPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8')));
    assert.ok(writtenPaths.includes(linearByTitleAliasPath(ISSUES_SCOPE, 'Release Plan', 'issue-123')));
  });

  it('captures per-path write failures in errors without aborting the fan-out', async () => {
    const failingPath = linearByTitleAliasPath(ISSUES_SCOPE, 'Release Plan', 'issue-123');
    const client = createClient({ failWriteOn: new Set([failingPath]) });

    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-123',
          identifier: 'AGE-8',
          title: 'Release Plan',
          state: { id: 's', name: 'In Progress' },
        },
      ],
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.path, failingPath);
    assert.match(result.errors[0]!.error, /forced write failure/);

    // Remaining alias paths landed.
    assert.ok(client.files.has(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8')));
    assert.ok(client.files.has(linearIssueByStatePath('In Progress', 'AGE-8')));
    assert.ok(client.files.has(linearIssuesIndexPath()));
  });

  it('skips by-title alias for emoji-only / punctuation-only titles', async () => {
    const client = createClient();
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [{ id: 'issue-1', identifier: 'AGE-1', title: '🚀!!!' }],
    });
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-1')));
    assert.ok(writtenPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-1')));
    // No by-title alias because the slug would collapse to empty.
    const byTitleEmitted = writtenPaths.some((p) => p.includes('/by-title/'));
    assert.equal(byTitleEmitted, false);
  });

  it('writes by-title alias for literal Untitled issue titles', async () => {
    const client = createClient();
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [{ id: 'issue-untitled', identifier: 'AGE-2', title: 'Untitled' }],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(
      writtenPaths.includes(linearByTitleAliasPath(ISSUES_SCOPE, 'Untitled', 'issue-untitled')),
    );
  });

  it('handles a mixed batch: issue create + rename + delete in one call', async () => {
    const priorRenamePayload = {
      payload: {
        id: 'issue-200',
        identifier: 'AGE-200',
        title: 'Old Title',
        state: { name: 'In Progress' },
      },
    };
    const priorDeletePayload = {
      payload: {
        id: 'issue-300',
        identifier: 'AGE-300',
        title: 'Doomed',
        state: { name: 'Todo' },
      },
    };
    const client = createClient({
      initialFiles: {
        [linearByUuidAliasPath(ISSUES_SCOPE, 'issue-200')]: JSON.stringify(priorRenamePayload),
        [linearByIdAliasPath(ISSUES_SCOPE, 'AGE-200')]: JSON.stringify(priorRenamePayload),
        [linearByUuidAliasPath(ISSUES_SCOPE, 'issue-300')]: JSON.stringify(priorDeletePayload),
        [linearByIdAliasPath(ISSUES_SCOPE, 'AGE-300')]: JSON.stringify(priorDeletePayload),
      },
    });

    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-100',
          identifier: 'AGE-100',
          title: 'Brand New',
          state: { id: 's', name: 'Todo' },
        },
        {
          id: 'issue-200',
          identifier: 'AGE-200',
          title: 'Renamed',
          state: { id: 's', name: 'In Progress' },
        },
        { id: 'issue-300', _deleted: true },
      ],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-100')));
    assert.ok(writtenPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-200')));

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(linearByTitleAliasPath(ISSUES_SCOPE, 'Old Title', 'issue-200')),
      'expected renamed issue prior by-title alias in deletes',
    );
    assert.ok(
      deletedPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-300')),
      'expected deleted issue by-id alias in deletes',
    );
    assert.deepEqual(result.errors, []);
  });

  it('cleans up stale UUID-only canonical when an issue gains an identifier (CodeRabbit src:273)', async () => {
    // Prior write: identifier-less. The adapter wrote the canonical path
    // using the UUID as the human-readable suffix (no identifier, no
    // title) and the by-uuid alias as the stable anchor. No by-id alias
    // was emitted because the identifier was absent.
    const priorPayload = {
      provider: 'linear',
      objectType: 'issue',
      objectId: 'issue-abc',
      payload: {
        id: 'issue-abc',
        identifier: null,
        title: null,
      },
    };
    const client = createClient({
      initialFiles: {
        [linearByUuidAliasPath(ISSUES_SCOPE, 'issue-abc')]: JSON.stringify(priorPayload),
        // The prior canonical path was UUID-keyed (no human-readable
        // segment), because identifier and title were both absent.
        [linearIssuePath('issue-abc')]: JSON.stringify(priorPayload),
      },
    });

    // New write: same UUID, now bearing an identifier `AGE-1`.
    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-abc',
          identifier: 'AGE-1',
          title: 'Now Has An Identifier',
          state: { id: 's', name: 'Todo' },
        },
      ],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    // The stale UUID-keyed canonical path must be reconciled away in
    // favor of the new identifier-keyed canonical path.
    assert.ok(
      deletedPaths.includes(linearIssuePath('issue-abc')),
      `expected stale UUID-keyed canonical path in deletes, got: ${deletedPaths.join(', ')}`,
    );
    // The by-uuid alias is the stable anchor and must NOT be deleted on
    // an identifier transition — the UUID never changes.
    assert.ok(
      !deletedPaths.includes(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-abc')),
      'by-uuid alias must not be deleted across identifier transitions',
    );

    const writtenPaths = client.writes.map((w) => w.path);
    // New by-id alias keyed on the identifier was written.
    assert.ok(writtenPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-1')));
    // by-uuid alias was rewritten with the new payload.
    assert.ok(writtenPaths.includes(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-abc')));
    // New canonical path lives under the identifier slug.
    assert.ok(writtenPaths.includes(linearIssuePath('issue-abc', 'AGE-1')));
    assert.deepEqual(result.errors, []);
  });

  it('tombstone with UUID-only payload deletes canonical + every alias + index row (Devin src:300)', async () => {
    // Seed a prior write where the issue had a full identifier-bearing
    // state. The by-uuid alias is the only stable anchor — the by-id
    // alias is keyed on the identifier (AGE-8), not the UUID.
    const priorPayload = {
      provider: 'linear',
      objectType: 'issue',
      objectId: 'issue-xyz',
      payload: {
        id: 'issue-xyz',
        identifier: 'AGE-8',
        title: 'Release Plan',
        state: { name: 'In Progress' },
      },
    };
    const priorIndex = [
      {
        id: 'issue-xyz',
        title: 'Release Plan',
        updated: '2026-05-12T00:00:00Z',
        identifier: 'AGE-8',
        state: 'In Progress',
      },
    ];
    const client = createClient({
      initialFiles: {
        [linearByUuidAliasPath(ISSUES_SCOPE, 'issue-xyz')]: JSON.stringify(priorPayload),
        [linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8')]: JSON.stringify(priorPayload),
        [linearByTitleAliasPath(ISSUES_SCOPE, 'Release Plan', 'issue-xyz')]:
          JSON.stringify(priorPayload),
        [linearIssueByStatePath('In Progress', 'AGE-8')]: JSON.stringify(priorPayload),
        [linearIssuePath('issue-xyz', 'AGE-8')]: JSON.stringify(priorPayload),
        [linearIssuesIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    // Bare tombstone — only the UUID is present, no identifier/title/state.
    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [{ id: 'issue-xyz', _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    // All four prior paths must be cleaned up — this is the assertion
    // that fails on main today because planIssueDelete reads by-id keyed
    // on the UUID, never finds prior state, and skips computing the
    // identifier-keyed alias paths.
    const expected = [
      linearIssuePath('issue-xyz', 'AGE-8'),
      linearByUuidAliasPath(ISSUES_SCOPE, 'issue-xyz'),
      linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8'),
      linearByTitleAliasPath(ISSUES_SCOPE, 'Release Plan', 'issue-xyz'),
      linearIssueByStatePath('In Progress', 'AGE-8'),
    ];
    for (const path of expected) {
      assert.ok(
        deletedPaths.has(path),
        `tombstone failed to clean up ${path} (Devin regression)`,
      );
    }

    // Index row was pruned.
    const indexWrite = client.writes.find((w) => w.path === linearIssuesIndexPath());
    assert.ok(indexWrite, 'expected an index write after delete to prune the row');
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(writtenRows.map((r) => r.id), []);
    assert.equal(result.deleted, expected.length);
  });

  it('round-trip: write issue, then re-emit same UUID — prior state resolved via by-uuid anchor', async () => {
    const client = createClient();

    // First emit: seeds the by-uuid alias.
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-rt',
          identifier: 'AGE-42',
          title: 'Original Title',
          state: { id: 's', name: 'Todo' },
        },
      ],
    });

    // Capture the by-uuid alias contents.
    const anchorBytes = client.files.get(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-rt'));
    assert.ok(anchorBytes, 'by-uuid alias must be present after first emit');
    const anchorParsed = JSON.parse(anchorBytes!) as {
      payload: { id: string; identifier: string; title: string };
    };
    assert.equal(anchorParsed.payload.id, 'issue-rt');
    assert.equal(anchorParsed.payload.identifier, 'AGE-42');
    assert.equal(anchorParsed.payload.title, 'Original Title');

    // Clear capture between emits to isolate the diff.
    client.writes.length = 0;
    client.deletes.length = 0;
    client.reads.length = 0;

    // Second emit: rename the title. Prior state must come from by-uuid.
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-rt',
          identifier: 'AGE-42',
          title: 'Renamed Title',
          state: { id: 's', name: 'Todo' },
        },
      ],
    });

    // The prior-state lookup hit the by-uuid path (not by-id, not the
    // canonical path).
    const readPaths = client.reads.map((r) => r.path);
    assert.ok(
      readPaths.includes(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-rt')),
      `expected by-uuid anchor read, got: ${readPaths.join(', ')}`,
    );

    // Stale by-title alias was diffed away.
    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(linearByTitleAliasPath(ISSUES_SCOPE, 'Original Title', 'issue-rt')),
      `expected stale by-title in deletes, got: ${deletedPaths.join(', ')}`,
    );
    assert.ok(!deletedPaths.includes(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-rt')));
    assert.ok(!deletedPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-42')));
  });

  it('does not emit by-id alias when issue has no identifier (anchor is by-uuid only)', async () => {
    const client = createClient();
    await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          id: 'issue-no-ident',
          title: 'Pending Issue',
          state: { id: 's', name: 'Todo' },
        },
      ],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    // by-uuid alias is always emitted.
    assert.ok(writtenPaths.includes(linearByUuidAliasPath(ISSUES_SCOPE, 'issue-no-ident')));
    // by-id alias must NOT be emitted under the UUID — that subtree is
    // reserved for human-readable identifiers (e.g. `AGE-8`).
    assert.ok(!writtenPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'issue-no-ident')));
    assert.ok(!writtenPaths.some((p) => p.startsWith(`${ISSUES_SCOPE}/by-id/`)));
    // by-state alias also needs identifier — must not be emitted.
    assert.ok(!writtenPaths.some((p) => p.startsWith(`${ISSUES_SCOPE}/by-state/`)));
  });
});
