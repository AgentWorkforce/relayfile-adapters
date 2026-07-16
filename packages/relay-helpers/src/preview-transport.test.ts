import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PreviewTransport,
  RelayWriteAuthorizationError,
  bindRelayWriteAuthorizer,
  bindPreviewTransport,
  clearPreviewTransport,
  getProcessRelayTransport,
  githubClient,
  linearClient,
  relayClient,
  slackClient,
  setPreviewTransport,
  telegramClient,
  type PreviewAction,
  type RelayTransport,
  type TransportPreviewAction,
} from './index.js';
import { executeRelayWrite } from './write-authorizer.js';

function failOnNetwork(counter: { calls: number }): typeof fetch {
  return async () => {
    counter.calls += 1;
    throw new Error('preview transport attempted a network request');
  };
}

test('Slack preview records a post and threaded reply with stable simulated receipts', async () => {
  const preview = new PreviewTransport();
  const network = { calls: 0 };
  const slack = slackClient({
    transport: preview,
    relayfileBaseUrl: 'https://relayfile.production.example',
    relayfileApiToken: 'rf_live_valid_looking',
    workspaceId: 'rw_production',
    fetchImpl: failOnNetwork(network),
  });

  const header = await slack.post('C123', 'Daily digest');
  const reply = await slack.post('C123', 'First item', { replyTo: header.ref });

  assert.equal(network.calls, 0);
  assert.equal(preview.actions.length, 2);
  assert.equal(header.ts, 'preview-slack-messages-0001');
  assert.equal(reply.ts, 'preview-slack-messages-0002');
  assert.deepEqual(preview.actions[0]?.simulatedReceipt, {
    id: 'preview-slack-messages-0001',
    timestamp: '2000-01-01T00:00:00.000Z',
  });
  assert.equal(preview.actions[0]?.kind, 'provider.write');
  assert.equal(preview.actions[0]?.status, 'previewed');
  assert.equal(preview.actions[0]?.data.operation, 'write');
  assert.equal(preview.actions[0]?.data.path, preview.actions[0]?.path);
  assert.deepEqual(preview.actions[0]?.data.parameters, preview.actions[0]?.parameters);
  assert.deepEqual(preview.actions[0]?.data.body, preview.actions[0]?.body);
  assert.deepEqual(preview.actions[0]?.data.simulatedReceipt, preview.actions[0]?.simulatedReceipt);
  assert.deepEqual(preview.actions[1]?.body, {
    text: 'First item',
    parentRef: header.ref,
    thread_ts: preview.actions[0]?.simulatedReceipt?.id,
  });
});

test('TransportPreviewAction is the canonical recorded action type', async () => {
  const preview = new PreviewTransport();
  await slackClient({ transport: preview }).post('C123', 'Ownership check');

  const canonical: TransportPreviewAction = preview.actions[0]!;
  const compatibilityAlias: PreviewAction = canonical;
  assert.strictEqual(compatibilityAlias, canonical);
});

test('Slack explicit thread replies record thread_ts from the parent simulated receipt', async () => {
  const preview = new PreviewTransport();
  const slack = slackClient({ transport: preview });
  const header = await slack.post('C123', 'Header');

  await slack.reply('C123', header.ts, 'Reply');

  assert.equal(preview.actions.length, 2);
  assert.equal(
    (preview.actions[1]?.body as Record<string, unknown>).thread_ts,
    preview.actions[0]?.simulatedReceipt?.id,
  );
});

test('thread parent references resolve across multiple previewed writes', async () => {
  const preview = new PreviewTransport();
  const slack = slackClient({ transport: preview });
  const first = await slack.post('C999', 'one');
  const second = await slack.post('C999', 'two', { replyTo: first.ref });
  await slack.post('C999', 'three', { replyTo: second.ref });

  assert.equal(preview.actions.length, 3);
  assert.equal(
    (preview.actions[1]?.body as Record<string, unknown>).thread_ts,
    preview.actions[0]?.simulatedReceipt?.id,
  );
  assert.equal(
    (preview.actions[2]?.body as Record<string, unknown>).thread_ts,
    preview.actions[1]?.simulatedReceipt?.id,
  );
});

test('Telegram reply preview records one action and makes no network requests', async () => {
  const preview = new PreviewTransport();
  const network = { calls: 0 };

  const result = await telegramClient({
    transport: preview,
    relayfileBaseUrl: 'https://relayfile.production.example',
    relayfileApiToken: 'rf_live_valid_looking',
    workspaceId: 'rw_production',
    fetchImpl: failOnNetwork(network),
  }).sendMessage('chat-1', 'reply', { replyToMessageId: 41 });

  assert.equal(network.calls, 0);
  assert.equal(result.messageId, 'preview-telegram-messages-0001');
  assert.equal(preview.actions.length, 1);
  assert.equal(preview.actions[0]?.provider, 'telegram');
  assert.equal(preview.actions[0]?.resource, 'messages');
  assert.deepEqual(preview.actions[0]?.body, { text: 'reply', reply_to_message_id: 41 });
});

test('Linear comment preview records one action and makes no network requests', async () => {
  const preview = new PreviewTransport();
  const network = { calls: 0 };
  const result = await linearClient({
    transport: preview,
    relayfileBaseUrl: 'https://relayfile.production.example',
    relayfileApiToken: 'rf_live_valid_looking',
    workspaceId: 'rw_production',
    fetchImpl: failOnNetwork(network),
  }).comment('ISS-42', 'Looks good');

  assert.equal(network.calls, 0);
  assert.equal(result.id, 'preview-linear-comments-0001');
  assert.equal(preview.actions.length, 1);
  assert.deepEqual(preview.actions[0]?.parameters, { issueId: 'ISS-42' });
  assert.deepEqual(preview.actions[0]?.body, { body: 'Looks good' });
});

test('GitHub writeback preview records one action and makes no network requests', async () => {
  const preview = new PreviewTransport();
  const network = { calls: 0 };
  const result = await githubClient({
    transport: preview,
    relayfileBaseUrl: 'https://relayfile.production.example',
    relayfileApiToken: 'rf_live_valid_looking',
    workspaceId: 'rw_production',
    fetchImpl: failOnNetwork(network),
  }).comment({ owner: 'AgentWorkforce', repo: 'cloud', number: 2619 }, 'Preview only');

  assert.equal(network.calls, 0);
  assert.equal(result.id, 'preview-github-issue-comments-0001');
  assert.equal(preview.actions.length, 1);
  assert.equal(preview.actions[0]?.path, '/github/repos/AgentWorkforce/cloud/issues/2619/comments/preview-github-issue-comments-0001.json');
});

test('process preview binding outranks production-like ambient credentials', async () => {
  // Common bundled shape: a module-level client is constructed before the Run
  // engine installs its process preview binding.
  const slack = slackClient();
  const preview = new PreviewTransport();
  const restoreBinding = bindPreviewTransport(preview);
  const savedFetch = globalThis.fetch;
  const network = { calls: 0 };
  const env = new Map<string, string | undefined>();
  const productionLike = {
    RELAYFILE_URL: 'https://relayfile.production.example',
    RELAYFILE_TOKEN: 'rf_live_valid_looking',
    RELAYFILE_WORKSPACE_ID: 'rw_production',
    SLACK_TOKEN: 'xoxb-production-looking',
    TELEGRAM_BOT_TOKEN: '123456:production-looking',
    LINEAR_API_KEY: 'lin_api_production_looking',
    GITHUB_TOKEN: 'ghp_production_looking',
  };
  for (const [key, value] of Object.entries(productionLike)) {
    env.set(key, process.env[key]);
    process.env[key] = value;
  }
  globalThis.fetch = failOnNetwork(network);

  try {
    await slack.post('C-safe', 'never live');
    assert.equal(network.calls, 0);
    assert.equal(preview.actions.length, 1);
  } finally {
    restoreBinding();
    globalThis.fetch = savedFetch;
    for (const [key, value] of env) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('final-write denial cannot be bypassed by an explicit PreviewTransport', async () => {
  const authoredPreview = new PreviewTransport();
  const network = { calls: 0 };
  const deniedActions: Array<Record<string, unknown>> = [];
  let authorizationCalls = 0;
  const restoreAuthorization = bindRelayWriteAuthorizer((request) => {
    authorizationCalls += 1;
    deniedActions.push({
      kind: 'provider.write',
      status: 'denied',
      provider: request.provider,
      resource: request.resource,
      path: request.path,
      body: '[REDACTED]',
    });
    return { allowed: false, reason: 'local write policy denies provider writes' };
  });

  try {
    await assert.rejects(
      () => slackClient({
        transport: authoredPreview,
        relayfileApiToken: 'rf_live_do_not_leak',
        fetchImpl: failOnNetwork(network),
      }).post('C999', 'secret message body'),
      (error: unknown) => {
        assert.ok(error instanceof RelayWriteAuthorizationError);
        assert.equal(error.code, 'RELAY_WRITE_DENIED');
        assert.equal(error.provider, 'slack');
        assert.equal(error.resource, 'messages');
        assert.doesNotMatch(error.message, /secret|rf_live/u);
        return true;
      },
    );
  } finally {
    restoreAuthorization();
  }

  assert.equal(authorizationCalls, 1);
  assert.equal(deniedActions.length, 1);
  assert.equal(deniedActions[0]?.body, '[REDACTED]');
  assert.equal(authoredPreview.actions.length, 0);
  assert.equal(network.calls, 0);
});

test('final-write authorization redirects an explicit transport to the canonical preview', async () => {
  const authoredPreview = new PreviewTransport();
  const canonicalPreview = new PreviewTransport();
  const restoreAuthorization = bindRelayWriteAuthorizer(() => ({
    allowed: true,
    transport: canonicalPreview,
  }));

  try {
    const result = await slackClient({ transport: authoredPreview }).post('C123', 'canonical only');
    assert.equal(result.ts, 'preview-slack-messages-0001');
  } finally {
    restoreAuthorization();
  }

  assert.equal(authoredPreview.actions.length, 0);
  assert.equal(canonicalPreview.actions.length, 1);
  assert.equal(canonicalPreview.actions[0]?.provider, 'slack');
  assert.equal(canonicalPreview.actions[0]?.resource, 'messages');
});

test('custom transports and unknown provider/resource requests are denied before mutation', async () => {
  const customCalls = { reads: 0, lists: 0, writes: 0 };
  const customTransport: RelayTransport = {
    async read<T>() {
      customCalls.reads += 1;
      return undefined as T;
    },
    async list<T>() {
      customCalls.lists += 1;
      return [] as T[];
    },
    async write(request) {
      customCalls.writes += 1;
      return { path: request.path, absolutePath: request.path, receipt: { id: 'unsafe-receipt' } };
    },
  };
  const deniedActions: Array<Record<string, unknown>> = [];
  const restoreAuthorization = bindRelayWriteAuthorizer((request) => {
    deniedActions.push({
      kind: 'provider.write',
      status: 'denied',
      provider: request.provider,
      resource: request.resource,
      body: '[REDACTED]',
    });
    return { allowed: false };
  });

  try {
    await assert.rejects(
      () => executeRelayWrite(customTransport, {
        provider: 'future-provider',
        resource: 'future-resource',
        parameters: { targetId: 'target-1' },
        path: '/future-provider/future-resource',
        body: { token: 'provider_secret_must_not_leak' },
      }),
      (error: unknown) => {
        assert.ok(error instanceof RelayWriteAuthorizationError);
        assert.equal(error.provider, 'future-provider');
        assert.equal(error.resource, 'future-resource');
        assert.doesNotMatch(error.message, /provider_secret/u);
        return true;
      },
    );
  } finally {
    restoreAuthorization();
  }

  assert.equal(deniedActions.length, 1);
  assert.equal(deniedActions[0]?.body, '[REDACTED]');
  assert.deepEqual(customCalls, { reads: 0, lists: 0, writes: 0 });
});

test('custom transports and unknown provider/resource requests redirect to the canonical preview', async () => {
  let customWrites = 0;
  const customTransport: RelayTransport = {
    async read<T>() {
      return undefined as T;
    },
    async list<T>() {
      return [] as T[];
    },
    async write(request) {
      customWrites += 1;
      return { path: request.path, absolutePath: request.path, receipt: { id: 'unsafe-receipt' } };
    },
  };
  const canonicalPreview = new PreviewTransport();
  const restoreAuthorization = bindRelayWriteAuthorizer(() => ({
    allowed: true,
    transport: canonicalPreview,
  }));

  try {
    const result = await executeRelayWrite(customTransport, {
      provider: 'future-provider',
      resource: 'future-resource',
      parameters: { targetId: 'target-1' },
      path: '/future-provider/future-resource',
      body: { value: 'preview only' },
    });
    assert.equal(result.receipt?.id, 'preview-future-provider-future-resource-0001');
  } finally {
    restoreAuthorization();
  }

  assert.equal(customWrites, 0);
  assert.equal(canonicalPreview.actions.length, 1);
  assert.equal(canonicalPreview.actions[0]?.provider, 'future-provider');
  assert.equal(canonicalPreview.actions[0]?.resource, 'future-resource');
});

test('bespoke direct write paths also honor the canonical preview override', async () => {
  const authoredPreview = new PreviewTransport();
  const canonicalPreview = new PreviewTransport();
  const restoreAuthorization = bindRelayWriteAuthorizer(() => ({
    allowed: true,
    transport: canonicalPreview,
  }));

  try {
    await githubClient({ transport: authoredPreview }).updateRef({
      owner: 'AgentWorkforce',
      repo: 'cloud',
      ref: 'main',
      sha: 'abc123',
    });
    await linearClient({ transport: authoredPreview }).updateIssue('ISS-1', { title: 'Updated' });
    await linearClient({ transport: authoredPreview }).updateLabel('LABEL-1', { name: 'priority' });
  } finally {
    restoreAuthorization();
  }

  assert.equal(authoredPreview.actions.length, 0);
  assert.deepEqual(
    canonicalPreview.actions.map(({ provider, resource }) => ({ provider, resource })),
    [
      { provider: 'github', resource: 'refs' },
      { provider: 'linear', resource: 'issues' },
      { provider: 'linear', resource: 'labels' },
    ],
  );
});

test('write authorizer bindings nest and restore without affecting reads or lists', async () => {
  const authoredPreview = new PreviewTransport({
    fixtures: {
      '/linear/issues': [{ id: 'ISS-1' }],
      '/github/repos/o/r/pulls/7/merge.json': { merged: false },
    },
  });
  const canonicalPreview = new PreviewTransport();
  let outerCalls = 0;
  let innerCalls = 0;
  const restoreOuter = bindRelayWriteAuthorizer(() => {
    outerCalls += 1;
    return { allowed: false };
  });
  const restoreInner = bindRelayWriteAuthorizer(() => {
    innerCalls += 1;
    return { allowed: true, transport: canonicalPreview };
  });

  try {
    const issues = await linearClient({ transport: authoredPreview }).listIssues<{ id: string }>();
    const merge = await relayClient('github', { transport: authoredPreview }).read<{ merged: boolean }>(
      'merge',
      { owner: 'o', repo: 'r', pullNumber: 7 },
    );
    assert.deepEqual(issues, [{ id: 'ISS-1' }]);
    assert.deepEqual(merge, { merged: false });
    assert.equal(innerCalls, 0);
    assert.equal(outerCalls, 0);

    await slackClient({ transport: authoredPreview }).post('C1', 'inner preview');
    restoreInner();
    await assert.rejects(
      () => slackClient({ transport: authoredPreview }).post('C1', 'outer denial'),
      RelayWriteAuthorizationError,
    );
  } finally {
    restoreInner();
    restoreOuter();
  }

  await slackClient({ transport: authoredPreview }).post('C1', 'restored authored transport');
  assert.equal(innerCalls, 1);
  assert.equal(outerCalls, 1);
  assert.equal(canonicalPreview.actions.length, 1);
  assert.equal(authoredPreview.actions.filter((action) => action.kind === 'provider.write').length, 1);
});

test('clearPreviewTransport fully clears the shared symbol binding', () => {
  const preview = new PreviewTransport();
  setPreviewTransport(preview);
  assert.equal(getProcessRelayTransport(), preview);

  clearPreviewTransport();

  assert.equal(getProcessRelayTransport(), undefined);
  const registry = globalThis as unknown as Record<symbol, unknown>;
  assert.equal(registry[Symbol.for('agentworkforce.preview-transport')], undefined);
});

test('preview reads and lists use seeded data and record accesses', async () => {
  const mergePath = '/github/repos/AgentWorkforce/cloud/pulls/7/merge.json';
  const preview = new PreviewTransport({
    fixtures: {
      [mergePath]: { merged: false },
      '/linear/issues': [{ id: 'ISS-1', title: 'Seeded issue' }],
    },
  });

  const merge = await relayClient('github', { transport: preview }).read<{ merged: boolean }>(
    'merge',
    { owner: 'AgentWorkforce', repo: 'cloud', pullNumber: 7 },
  );
  const issues = await linearClient({ transport: preview }).listIssues<{ id: string }>();

  assert.deepEqual(merge, { merged: false });
  assert.deepEqual(issues, [{ id: 'ISS-1', title: 'Seeded issue' }]);
  assert.deepEqual(preview.accesses.map((access) => access.method), ['read', 'list']);
  assert.deepEqual(preview.actions.map((action) => action.method), ['read', 'list']);
  assert.deepEqual(preview.actions.map((action) => action.kind), ['provider.read', 'provider.read']);
  assert.deepEqual(preview.actions.map((action) => action.status), ['previewed', 'previewed']);
  assert.deepEqual(preview.actions.map((action) => action.data.operation), ['read', 'list']);
});
