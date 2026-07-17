import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import test from 'node:test';
import {
  RelayfileWritebackAdmissionTimeoutError,
  RelayfileWritebackTerminalError,
} from '@relayfile/adapter-core/vfs-client';
import type {
  WritebackDeliveryStatus,
  WritebackReceipt,
  WritebackResult,
} from '@relayfile/adapter-core/vfs-client';
import {
  created,
  githubClient,
  linearClient,
  PreviewTransport,
  providerClient,
  type CreatedConfirmed,
  type CreatedDropped,
  type CreatedPending,
  type CreatedResult,
  type GithubClient,
  type LinearClient,
  type RelayTransport,
  type RelayTransportRequest,
  type RelayTransportWriteRequest,
} from './index.js';

const issueCommentsPath = providerClient('github')['issue-comments'].path({
  owner: 'o',
  repo: 'r',
  issueNumber: 1,
});
const path = `${issueCommentsPath}/issue-comments draft.json`;

test('created preserves confirmed receipts and never substitutes a path for url', () => {
  assert.deepEqual(
    created({
      path,
      absolutePath: path,
      deliveryStatus: 'confirmed',
      receipt: { created: 'comment-123', url: 'https://github.example/comments/123' },
    }),
    {
      status: 'confirmed',
      id: 'comment-123',
      url: 'https://github.example/comments/123',
      path,
      receipt: { created: 'comment-123', url: 'https://github.example/comments/123' },
    },
  );

  const withoutUrl = created({
    path,
    absolutePath: path,
    deliveryStatus: 'confirmed',
    receipt: { externalId: 'comment-456' },
  });
  assert.equal(withoutUrl.status, 'confirmed');
  assert.equal(withoutUrl.id, 'comment-456');
  assert.equal(withoutUrl.url, '');
  assert.notEqual(withoutUrl.url, path);
});

test('created infers confirmed for legacy transports that return a receipt', () => {
  const result = created({
    path,
    absolutePath: path,
    receipt: { id: 'legacy-123', url: 'https://linear.example/legacy-123' },
  });

  assert.equal(result.status, 'confirmed');
  assert.equal(result.id, 'legacy-123');
  assert.equal(result.url, 'https://linear.example/legacy-123');
});

test('created normalizes runtime numeric ids and uses sha or ts as primary receipt identifiers', () => {
  const numeric = created({
    path,
    absolutePath: path,
    deliveryStatus: 'confirmed',
    receipt: { id: 123 } as unknown as WritebackReceipt,
  });
  assert.equal(numeric.status, 'confirmed');
  assert.equal(numeric.id, '123');

  for (const [receipt, expected] of [
    [{ sha: 'commit-abc123' }, 'commit-abc123'],
    [{ ts: '1781870464.800039' }, '1781870464.800039'],
  ] as const) {
    const result = created({ path, absolutePath: path, deliveryStatus: 'confirmed', receipt });
    assert.equal(result.status, 'confirmed');
    assert.equal(result.id, expected);
    assert.notEqual(result.id, path);
  }
});

test('created returns pending without throwing when a receipt is not yet visible', () => {
  const explicit = created({ path, absolutePath: path, deliveryStatus: 'pending' });
  const legacy = created({ path, absolutePath: path });

  for (const result of [explicit, legacy]) {
    assert.deepEqual(result, { status: 'pending', id: path, url: '', path });
    assert.notEqual(result.url, path);
  }
});

test('created preserves an authoritative dropped result without throwing', () => {
  assert.deepEqual(
    created({ path, absolutePath: path, deliveryStatus: 'dropped' }),
    { status: 'dropped', id: path, url: '', path },
  );

  const diagnostic = { ok: false, reason: 'path_not_mounted' };
  assert.deepEqual(
    created({ path, absolutePath: path, deliveryStatus: 'dropped', receipt: diagnostic }),
    { status: 'dropped', id: path, url: '', path, receipt: diagnostic },
  );
});

test('created rejects malformed or unknown runtime transport results clearly', () => {
  const malformed: unknown[] = [
    null,
    undefined,
    'not-a-result',
    {},
    { path: '   ', absolutePath: path },
    { path, absolutePath: path, receipt: 'not-a-receipt' },
    { path, absolutePath: path, deliveryStatus: 'unknown' },
    { path, absolutePath: path, deliveryStatus: 'confirmed' },
    { path, absolutePath: path, receipt: {} },
    { path, absolutePath: path, receipt: { provider: 'github' } },
    { path, absolutePath: path, receipt: { id: Number.NaN } },
    { path, absolutePath: path, deliveryStatus: 'pending', receipt: { id: 'contradiction' } },
  ];

  for (const value of malformed) {
    assert.throws(() => created(value as WritebackResult), TypeError);
  }
});

class FixedResultTransport implements RelayTransport {
  readonly writes: RelayTransportWriteRequest[] = [];

  constructor(private readonly status: WritebackDeliveryStatus) {}

  async read<T = unknown>(_request: RelayTransportRequest): Promise<T> {
    throw new Error('read not expected');
  }

  async list<T = unknown>(_request: RelayTransportRequest): Promise<T[]> {
    throw new Error('list not expected');
  }

  async write(request: RelayTransportWriteRequest): Promise<WritebackResult> {
    this.writes.push(request);
    return {
      path: request.path,
      absolutePath: request.path,
      deliveryStatus: this.status,
      ...(this.status === 'confirmed'
        ? { receipt: { id: `${request.resource}-id`, url: `https://provider.example/${request.resource}-id` } }
        : {}),
    };
  }
}

test('GitHub and Linear ergonomic create helpers preserve every transport status', async () => {
  for (const status of ['confirmed', 'pending', 'dropped'] as const) {
    const transport = new FixedResultTransport(status);
    const github = githubClient({ transport });
    const linear = linearClient({ transport });

    const results = await Promise.all([
      github.comment({ owner: 'o', repo: 'r', number: 1 }, 'comment'),
      github.createIssue({ owner: 'o', repo: 'r', title: 'issue', body: 'body' }),
      github.createPullRequest({ owner: 'o', repo: 'r', title: 'pr', head: 'feature', base: 'main' }),
      linear.agentActivity('session-1', { type: 'thought', body: 'working' }),
      linear.respond('session-2', 'done'),
      linear.acknowledge('session-3'),
      linear.comment('issue-1', 'comment'),
      linear.createIssue({ teamId: 'team-1', title: 'issue' }),
      linear.createLabel({ name: 'label' }),
    ]);

    assert.equal(results.length, 9);
    assert.equal(transport.writes.length, 9);
    for (const result of results) {
      assert.equal(result.status, status);
      if (status === 'confirmed') {
        assert.match(result.url, /^https:\/\/provider\.example\//u);
      } else {
        assert.equal(result.url, '');
        assert.equal(result.id, result.path);
      }
    }
  }
});

test('mount-backed ergonomic helpers report both immediate and timed-out writes as pending', async () => {
  for (const writebackTimeoutMs of [0, 20]) {
    const root = await mkdtemp(nodePath.join(tmpdir(), 'relay-created-pending-'));
    const result = await githubClient({
      relayfileMountRoot: root,
      writebackTimeoutMs,
      writebackPollMs: 5,
    }).comment({ owner: 'o', repo: 'r', number: 1 }, 'pending');

    assert.equal(result.status, 'pending');
    assert.equal(result.id, result.path);
    assert.equal(result.url, '');
  }
});

test('preview receipts flow through ergonomic helpers as confirmed', async () => {
  const result = await linearClient({ transport: new PreviewTransport() })
    .createIssue({ teamId: 'team-1', title: 'preview' });

  assert.equal(result.status, 'confirmed');
  assert.match(result.id, /^preview-linear-issues-/u);
  assert.equal(result.url, '');
});

test('direct HTTP receipt timeout becomes pending instead of a retry-triggering throw', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/fs/file')) {
      return Response.json({
        opId: 'op_pending_created',
        status: 'queued',
        targetRevision: 'rev-1',
        writeback: { provider: 'github', state: 'pending' },
      });
    }
    if (url.includes('/ops/op_pending_created')) {
      return Response.json({ opId: 'op_pending_created', status: 'running', attemptCount: 1 });
    }
    return Response.json({ code: 'not_found' }, { status: 404 });
  };

  const result = await githubClient({
    relayfileBaseUrl: 'https://relayfile.example.test',
    relayfileApiToken: 'token',
    workspaceId: 'workspace-1',
    fetchImpl,
    writebackTimeoutMs: 20,
    writebackPollMs: 5,
  }).comment({ owner: 'o', repo: 'r', number: 1 }, 'pending');

  assert.equal(result.status, 'pending');
  assert.equal(result.path.startsWith(`${issueCommentsPath}/`), true);
  assert.equal(result.url, '');
});

test('direct HTTP terminal operation evidence becomes dropped without retrying', async () => {
  let opReads = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/fs/file')) {
      return Response.json({
        opId: 'op_dropped_created',
        status: 'queued',
        targetRevision: 'rev-1',
        writeback: { provider: 'linear', state: 'pending' },
      });
    }
    if (url.includes('/ops/op_dropped_created')) {
      opReads += 1;
      return Response.json({
        opId: 'op_dropped_created',
        status: 'dead_lettered',
        attemptCount: 1,
        lastError: 'path is outside the mounted integration scope',
      });
    }
    return Response.json({ code: 'not_found' }, { status: 404 });
  };

  const result = await linearClient({
    relayfileBaseUrl: 'https://relayfile.example.test',
    relayfileApiToken: 'token',
    workspaceId: 'workspace-1',
    fetchImpl,
    writebackTimeoutMs: 100,
    writebackPollMs: 5,
  }).createIssue({ teamId: 'team-1', title: 'dropped' });

  assert.equal(result.status, 'dropped');
  assert.equal(opReads, 1);
  assert.match(result.reason ?? '', /dead_lettered.*outside the mounted integration scope/u);
  assert.equal(result.url, '');
});

test('ambiguous admission timeouts remain errors rather than false dropped certainty', async () => {
  const admissionError = new RelayfileWritebackAdmissionTimeoutError({
    provider: 'github',
    operation: 'write.issue-comments',
    path,
    timeoutMs: 20,
  });
  const transport: RelayTransport = {
    read: async <T>() => undefined as T,
    list: async <T>() => [] as T[],
    write: async () => { throw admissionError; },
  };

  await assert.rejects(
    () => githubClient({ transport }).comment({ owner: 'o', repo: 'r', number: 1 }, 'ambiguous'),
    (error: unknown) => error === admissionError,
  );
});

test('legacy pathless terminal errors remain constructible and are not misclassified as dropped', async () => {
  const legacyError = new RelayfileWritebackTerminalError({
    provider: 'github',
    operation: 'write.issue-comments',
    opId: 'op_legacy_terminal',
    status: 'failed',
    lastError: 'legacy caller has no path',
  });
  const transport: RelayTransport = {
    read: async <T>() => undefined as T,
    list: async <T>() => [] as T[],
    write: async () => { throw legacyError; },
  };

  assert.equal(legacyError.path, undefined);
  await assert.rejects(
    () => githubClient({ transport }).comment({ owner: 'o', repo: 'r', number: 1 }, 'legacy'),
    (error: unknown) => error === legacyError,
  );
});

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type _GithubCommentResult = Assert<
  Equal<Awaited<ReturnType<GithubClient['comment']>>, CreatedResult>
>;
type _LinearCreateResult = Assert<
  Equal<Awaited<ReturnType<LinearClient['createIssue']>>, CreatedResult>
>;
type _LegacyIdUrlShape = Assert<
  CreatedResult extends { id: string; url: string } ? true : false
>;

function assertCreatedOverloads(result: WritebackResult, pending: Promise<WritebackResult>): void {
  const sync: CreatedResult = created(result);
  const asyncResult: Promise<CreatedResult> = created(pending);
  void sync;
  void asyncResult;
}

void assertCreatedOverloads;

function assertCreatedResultNarrowing(result: CreatedResult): string {
  switch (result.status) {
    case 'confirmed': {
      const narrowed: CreatedConfirmed = result;
      const url: string = narrowed.url;
      return url;
    }
    case 'pending': {
      const narrowed: CreatedPending = result;
      const url: '' = narrowed.url;
      return url;
    }
    case 'dropped': {
      const narrowed: CreatedDropped = result;
      const url: '' = narrowed.url;
      return url;
    }
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

void assertCreatedResultNarrowing;

// @ts-expect-error unknown statuses cannot enter the typed writeback contract
const invalidStatus: WritebackResult = { path, absolutePath: path, deliveryStatus: 'unknown' };
void invalidStatus;
