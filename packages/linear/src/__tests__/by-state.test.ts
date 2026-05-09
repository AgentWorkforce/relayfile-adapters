import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LINEAR_CANONICAL_STATES,
  LinearAdapter,
  linearIssueByStatePath,
  linearIssuePath,
  slugifyStateName,
  type ConnectionProvider,
  type LinearAdapterConfig,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
  type WriteFileResult,
} from '../index.js';

class RecordingClient implements RelayFileClientLike {
  readonly writes: WriteFileInput[] = [];
  readonly deletes: string[] = [];
  readonly files = new Map<string, WriteFileInput>();

  async writeFile(input: WriteFileInput): Promise<WriteFileResult> {
    const existed = this.files.has(input.path);
    this.writes.push(input);
    this.files.set(input.path, input);
    return existed ? { updated: true } : { created: true };
  }

  async deleteFile(input: { path: string; workspaceId: string }): Promise<void> {
    void input.workspaceId;
    this.deletes.push(input.path);
    this.files.delete(input.path);
  }
}

function createProvider(): ConnectionProvider {
  return {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        status: 200,
        headers: {},
        data: null as never,
      };
    },
    async healthCheck() {
      return true;
    },
  };
}

function createAdapter(client: RecordingClient, config: LinearAdapterConfig = {}): LinearAdapter {
  return new LinearAdapter(client, createProvider(), config);
}

function createIssuePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'issue_123',
    identifier: 'ENG-123',
    title: 'Ship state aliases',
    state_name: 'Todo',
    state: {
      id: 'state_todo',
      name: 'Todo',
      type: 'unstarted',
    },
    _webhook: {
      action: 'create',
    },
    ...overrides,
  };
}

test('Linear issue ingest writes canonical and by-state files with identical bytes', async () => {
  const client = new RecordingClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.create',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: createIssuePayload(),
  });

  const canonicalPath = linearIssuePath('issue_123', 'Ship state aliases');
  const aliasPath = linearIssueByStatePath('Todo', 'ENG-123');
  const canonicalWrite = client.files.get(canonicalPath);
  const aliasWrite = client.files.get(aliasPath);

  assert.ok(canonicalWrite);
  assert.ok(aliasWrite);
  assert.strictEqual(canonicalWrite?.content, aliasWrite?.content);
  assert.strictEqual(canonicalWrite?.contentType, aliasWrite?.contentType);
  assert.deepStrictEqual(result.paths, [canonicalPath, aliasPath]);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.filesWritten, 2);
});

test('slugifyStateName keeps canonical Linear state directories stable', () => {
  const expected = ['todo', 'in-progress', 'done', 'backlog', 'canceled'];

  assert.deepStrictEqual(
    LINEAR_CANONICAL_STATES.map((state) => slugifyStateName(state)),
    expected,
  );
});

test('Linear issue ingest without state_name skips by-state alias and records one error', async () => {
  const client = new RecordingClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.create',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: createIssuePayload({
      state_name: undefined,
      state: { id: 'state_missing_name' },
    }),
  });

  const canonicalPath = linearIssuePath('issue_123', 'Ship state aliases');

  assert.ok(client.files.has(canonicalPath));
  assert.strictEqual(
    Array.from(client.files.keys()).some((path) => path.includes('/by-state/')),
    false,
  );
  assert.deepStrictEqual(result.paths, [canonicalPath]);
  assert.strictEqual(result.errors.length, 1);
  assert.match(result.errors[0]?.path ?? '', /\/linear\/issues\/by-state/);
});

test('Linear by-state subtree is omitted entirely when an issue has no state', async () => {
  const client = new RecordingClient();
  const adapter = createAdapter(client);

  await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.create',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: createIssuePayload({
      state_name: undefined,
      state: undefined,
    }),
  });

  assert.deepStrictEqual(
    Array.from(client.files.keys()).filter((path) => path.includes('/linear/issues/by-state/')),
    [],
  );
});

test('Linear issue remove deletes the canonical file and every known by-state alias', async () => {
  const client = new RecordingClient();
  const adapter = createAdapter(client);
  const canonicalPath = linearIssuePath('issue_123', 'Ship state aliases');
  const aliasPath = linearIssueByStatePath('Todo', 'ENG-123');

  await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.create',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: createIssuePayload(),
  });

  const result = await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.remove',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: createIssuePayload({
      _webhook: {
        action: 'remove',
        previousData: {
          identifier: 'ENG-123',
          state_name: 'Todo',
        },
      },
    }),
  });

  assert.strictEqual(client.files.has(canonicalPath), false);
  assert.strictEqual(client.files.has(aliasPath), false);
  assert.deepStrictEqual(client.deletes.sort(), [aliasPath, canonicalPath].sort());
  assert.strictEqual(result.filesDeleted, 2);
  assert.deepStrictEqual(result.errors, []);
});

test('Linear issue state transitions delete the old by-state alias before writing the new one', async () => {
  const client = new RecordingClient();
  const adapter = createAdapter(client);
  const todoAliasPath = linearIssueByStatePath('Todo', 'ENG-123');
  const inProgressAliasPath = linearIssueByStatePath('In Progress', 'ENG-123');

  await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.create',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: createIssuePayload(),
  });

  const result = await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.update',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: createIssuePayload({
      state_name: 'In Progress',
      state: {
        id: 'state_in_progress',
        name: 'In Progress',
        type: 'started',
      },
      _webhook: {
        action: 'update',
        previousData: {
          identifier: 'ENG-123',
          state_name: 'Todo',
        },
      },
    }),
  });

  assert.strictEqual(client.files.has(todoAliasPath), false);
  assert.ok(client.files.has(inProgressAliasPath));
  assert.ok(client.deletes.includes(todoAliasPath));
  assert.deepStrictEqual(result.paths, [
    linearIssuePath('issue_123', 'Ship state aliases'),
    todoAliasPath,
    inProgressAliasPath,
  ]);
  assert.strictEqual(result.filesDeleted, 1);
});

test('Linear by-state aliases preserve mixed-case identifiers exactly', async () => {
  const client = new RecordingClient();
  const adapter = createAdapter(client);
  const identifier = 'Eng-Api-7B';
  const aliasPath = linearIssueByStatePath('Todo', identifier);

  await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.create',
    objectType: 'issue',
    objectId: 'issue_mixed_case',
    payload: createIssuePayload({
      id: 'issue_mixed_case',
      identifier,
      title: 'Preserve identifier bytes',
    }),
  });

  assert.ok(client.files.has(aliasPath));
  assert.strictEqual(aliasPath.endsWith(`/${identifier}.json`), true);
});

test('Linear custom state aliases keep Unicode reversible and avoid slug collisions with literal hyphens', () => {
  const unicodeAliasPath = linearIssueByStatePath('Révision - β', 'ENG-123');
  const hyphenAliasPath = linearIssueByStatePath('QA-QC', 'ENG-123');
  const whitespaceAliasPath = linearIssueByStatePath('QA QC', 'ENG-123');

  assert.ok(unicodeAliasPath.includes('/r%C3%A9vision-%2D-%CE%B2/'));
  assert.ok(hyphenAliasPath.includes('/qa%2Dqc/'));
  assert.ok(whitespaceAliasPath.includes('/qa-qc/'));
  assert.notStrictEqual(hyphenAliasPath, whitespaceAliasPath);
});
