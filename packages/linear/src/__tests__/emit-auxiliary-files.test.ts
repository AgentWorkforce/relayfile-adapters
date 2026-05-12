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
  linearByTitleAliasPath,
  linearIssueByStatePath,
  linearIssuePath,
  linearIssuesIndexPath,
  linearProjectPath,
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
  it('returns a zero result on empty input', async () => {
    const client = createClient();
    const result = await emitLinearAuxiliaryFiles(client, { workspaceId: 'ws-1' });
    assert.deepEqual(result, { written: 0, deleted: 0, errors: [] });
    assert.equal(client.writes.length, 0);
    assert.equal(client.deletes.length, 0);
  });

  it('writes the canonical path plus by-id, by-title, by-state aliases plus index row for an issue', async () => {
    const client = createClient();
    const issue = {
      id: 'issue-123',
      identifier: 'AGE-8',
      title: 'Release Plan',
      state: { id: 'state-1', name: 'In Progress' },
      updatedAt: '2026-05-12T00:00:00Z',
    };
    const result = await emitLinearAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [issue],
    });

    // Issue emits 4 files (canonical + by-id + by-title + by-state) + 1 index.
    assert.equal(result.written, 5);
    assert.deepEqual(result.errors, []);

    const expectedPaths = [
      linearIssuePath('issue-123', 'AGE-8'),
      linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8'),
      linearByTitleAliasPath(ISSUES_SCOPE, 'Release Plan', 'issue-123'),
      linearIssueByStatePath('In Progress', 'AGE-8'),
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
      },
    };
    const client = createClient({
      initialFiles: {
        [linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8')]: JSON.stringify(priorPayload),
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

    // New by-title alias and canonical path landed.
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(linearByTitleAliasPath(ISSUES_SCOPE, 'New Title', 'issue-123')));
    assert.ok(writtenPaths.includes(linearIssuePath('issue-123', 'AGE-8')));

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
        [linearByIdAliasPath(ISSUES_SCOPE, 'AGE-8')]: JSON.stringify(priorPayload),
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

  it('writes canonical project file only (no index file today)', async () => {
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
    // No project index file is emitted (no path-mapper helper today).
    assert.ok(!writtenPaths.some((p) => p.endsWith('/projects/_index.json')));
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
        [linearByIdAliasPath(ISSUES_SCOPE, 'issue-123')]: JSON.stringify(priorPayload),
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
    assert.ok(writtenPaths.includes(linearByIdAliasPath(ISSUES_SCOPE, 'AGE-1')));
    // No by-title alias because the slug would collapse to empty.
    const byTitleEmitted = writtenPaths.some((p) => p.includes('/by-title/'));
    assert.equal(byTitleEmitted, false);
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
        [linearByIdAliasPath(ISSUES_SCOPE, 'AGE-200')]: JSON.stringify(priorRenamePayload),
        [linearByIdAliasPath(ISSUES_SCOPE, 'issue-300')]: JSON.stringify(priorDeletePayload),
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
});
