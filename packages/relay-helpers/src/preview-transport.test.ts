import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PreviewTransport,
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
  type TransportPreviewAction,
} from './index.js';

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
