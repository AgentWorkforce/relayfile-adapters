import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RelayfileWritebackPendingError, RelayfileWritebackReceiptError } from '@relayfile/adapter-core/vfs-client';
import { WRITEBACK_PATH_CATALOG } from '@relayfile/adapter-core/writeback-paths';
import { linearByUuidAliasPath } from '@relayfile/adapter-linear/path-mapper';
import * as helpers from './index.js';
import {
  githubClient,
  linearClient,
  notionClient,
  providerClient,
  relayClient,
  slackClient,
  telegramClient,
  telegramReceiptTs,
} from './index.js';

const clientExportName = (provider: string): string =>
  `${provider.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())}Client`;

/** Fire-and-forget client bound to a throwaway mount; no writeback worker runs. */
async function mount(): Promise<{ root: string; opts: { relayfileMountRoot: string; writebackTimeoutMs: number } }> {
  const root = await mkdtemp(path.join(tmpdir(), 'relay-helpers-'));
  return { root, opts: { relayfileMountRoot: root, writebackTimeoutMs: 0 } };
}

async function onlyJsonIn(dir: string): Promise<{ name: string; body: unknown }> {
  const entries = (await readdir(dir)).filter((entry) => entry.endsWith('.json'));
  assert.equal(entries.length, 1, `expected one draft in ${dir}, saw ${entries.join(', ') || 'none'}`);
  return { name: entries[0], body: JSON.parse(await readFile(path.join(dir, entries[0]), 'utf8')) };
}

test('relayClient.path resolves catalog paths and write drops a collection draft', async () => {
  const { root, opts } = await mount();
  const linear = relayClient('linear', opts);
  assert.equal(linear.path('comments', { issueId: 'ISS-1' }), '/linear/issues/ISS-1/comments');

  await linear.write('comments', { issueId: 'ISS-1' }, { body: 'hi' });
  const draft = await onlyJsonIn(path.join(root, 'linear/issues/ISS-1/comments'));
  assert.deepEqual(draft.body, { body: 'hi' });
});

test('relayClient.write writes item (.json) resources to the exact path', async () => {
  const { root, opts } = await mount();
  const gh = relayClient('github', opts);
  // `merge` resolves to `…/merge.json` — an item path, written directly (no draft).
  await gh.write('merge', { owner: 'o', repo: 'r', pullNumber: 7 }, { merge_method: 'squash' });
  const body = JSON.parse(await readFile(path.join(root, 'github/repos/o/r/pulls/7/merge.json'), 'utf8'));
  assert.deepEqual(body, { merge_method: 'squash' });
});

test('relayClient.read / list operate over the catalog paths', async () => {
  const { root, opts } = await mount();
  await mkdir(path.join(root, 'linear/issues'), { recursive: true });
  await writeFile(path.join(root, 'linear/issues/ISS-9.json'), JSON.stringify({ id: 'ISS-9', title: 't' }));
  const linear = relayClient('linear', opts);
  const listed = await linear.list<{ id: string }>('issues');
  assert.deepEqual(listed.map((i) => i.id), ['ISS-9']);
});

test('linearClient recovers comment / createIssue / getIssue ergonomics', async () => {
  const { root, opts } = await mount();
  await mkdir(path.join(root, 'linear/issues'), { recursive: true });
  const issueId = '5d6f2e15-0f1d-45ed-826b-183265809202';
  await mkdir(path.join(root, 'linear/issues/by-uuid'), { recursive: true });
  await writeFile(path.join(root, 'linear/issues/by-uuid', `${issueId}.json`), JSON.stringify({ id: issueId, title: 'Fix' }));
  await writeFile(path.join(root, 'linear/issues', `${issueId}.json`), JSON.stringify({ id: issueId, title: 'Wrong path should not win' }));

  const linear = linearClient(opts);
  const issue = await linear.getIssue<{ title: string }>(issueId);
  assert.equal(issue.title, 'Fix');

  await linear.comment(issueId, ':rocket: done');
  const comment = await onlyJsonIn(path.join(root, 'linear/issues', issueId, 'comments'));
  assert.deepEqual(comment.body, { body: ':rocket: done' });

  // Fresh mount so the create draft is the only file in /linear/issues.
  const fresh = await mount();
  await linearClient(fresh.opts).createIssue({ teamId: 'T', title: 'New' });
  const created = await onlyJsonIn(path.join(fresh.root, 'linear/issues'));
  assert.deepEqual(created.body, { teamId: 'T', title: 'New' });
});

test('linearClient defaults reads to WORKSPACE_ROOT when cwd is the runtime directory', async () => {
  const mountRoot = await mkdtemp(path.join(tmpdir(), 'relay-helpers-mount-'));
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'relay-helpers-runtime-'));
  const issueId = '5d6f2e15-0f1d-45ed-826b-183265809203';
  const issueAliasPath = linearByUuidAliasPath(relayClient('linear').path('issues'), issueId).replace(/^\/+/, '');
  await mkdir(path.join(mountRoot, path.dirname(issueAliasPath)), { recursive: true });
  await mkdir(path.join(runtimeRoot, path.dirname(issueAliasPath)), { recursive: true });
  await writeFile(path.join(mountRoot, issueAliasPath), JSON.stringify({ id: issueId, title: 'Mounted' }));
  await writeFile(path.join(runtimeRoot, issueAliasPath), JSON.stringify({ id: issueId, title: 'Runtime cwd' }));

  const oldCwd = process.cwd();
  const oldRelayfileMountPath = process.env.RELAYFILE_MOUNT_PATH;
  const oldWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const oldWorkforceSandboxRoot = process.env.WORKFORCE_SANDBOX_ROOT;
  const oldRelayfileMountRoot = process.env.RELAYFILE_MOUNT_ROOT;
  const oldRelayfileRoot = process.env.RELAYFILE_ROOT;
  try {
    delete process.env.RELAYFILE_MOUNT_PATH;
    process.env.WORKSPACE_ROOT = mountRoot;
    delete process.env.WORKFORCE_SANDBOX_ROOT;
    delete process.env.RELAYFILE_MOUNT_ROOT;
    delete process.env.RELAYFILE_ROOT;
    process.chdir(runtimeRoot);

    const issue = await linearClient().getIssue<{ title: string }>(issueId);
    assert.equal(issue.title, 'Mounted');
  } finally {
    process.chdir(oldCwd);
    if (oldRelayfileMountPath === undefined) delete process.env.RELAYFILE_MOUNT_PATH;
    else process.env.RELAYFILE_MOUNT_PATH = oldRelayfileMountPath;
    if (oldWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = oldWorkspaceRoot;
    if (oldWorkforceSandboxRoot === undefined) delete process.env.WORKFORCE_SANDBOX_ROOT;
    else process.env.WORKFORCE_SANDBOX_ROOT = oldWorkforceSandboxRoot;
    if (oldRelayfileMountRoot === undefined) delete process.env.RELAYFILE_MOUNT_ROOT;
    else process.env.RELAYFILE_MOUNT_ROOT = oldRelayfileMountRoot;
    if (oldRelayfileRoot === undefined) delete process.env.RELAYFILE_ROOT;
    else process.env.RELAYFILE_ROOT = oldRelayfileRoot;
  }
});

test('linearClient posts agent activities, responses, and acknowledgements', async () => {
  const { root, opts } = await mount();
  const linear = linearClient(opts);

  await linear.agentActivity('session_linear_123', { type: 'elicitation', body: 'Which repo?' });
  const activity = await onlyJsonIn(path.join(root, 'linear/agent-sessions/session_linear_123/activities'));
  assert.deepEqual(activity.body, { type: 'elicitation', body: 'Which repo?' });

  const responseMount = await mount();
  await linearClient(responseMount.opts).respond('session_linear_456', 'Done.');
  const response = await onlyJsonIn(path.join(responseMount.root, 'linear/agent-sessions/session_linear_456/activities'));
  assert.deepEqual(response.body, { type: 'response', body: 'Done.' });

  const ackMount = await mount();
  await linearClient(ackMount.opts).acknowledge('session_linear_789');
  const ack = await onlyJsonIn(path.join(ackMount.root, 'linear/agent-sessions/session_linear_789/activities'));
  assert.deepEqual(ack.body, { type: 'thought', body: 'Acknowledged.' });
});

test('githubClient.comment and slackClient.post target the canonical paths', async () => {
  const { root, opts } = await mount();
  await githubClient(opts).comment({ owner: 'AgentWorkforce', repo: 'cloud', number: 1643 }, 'hello');
  const ghComment = await onlyJsonIn(path.join(root, 'github/repos/AgentWorkforce/cloud/issues/1643/comments'));
  assert.deepEqual(ghComment.body, { body: 'hello' });

  await slackClient(opts).post('C123', 'shipped');
  const msg = await onlyJsonIn(path.join(root, 'slack/channels/C123/messages'));
  assert.deepEqual(msg.body, { text: 'shipped' });
});

test('githubClient exposes pull request create, ref push, and close operations', async () => {
  const { root, opts } = await mount();
  const github = githubClient(opts);
  await github.createPullRequest({
    owner: 'AgentWorkforce', repo: 'factory', title: 'Fix #52', head: 'factory/52', base: 'main', author: 'user',
  });
  assert.deepEqual(
    (await onlyJsonIn(path.join(root, 'github/repos/AgentWorkforce/factory/pull-requests'))).body,
    { title: 'Fix #52', head: 'factory/52', base: 'main', author: 'user' },
  );

  await github.pushRef({ owner: 'AgentWorkforce', repo: 'factory', ref: 'factory/52', sha: 'abc123' });
  assert.deepEqual(
    (await onlyJsonIn(path.join(root, 'github/repos/AgentWorkforce/factory/refs'))).body,
    { ref: 'factory/52', sha: 'abc123' },
  );

  await github.updateRef({
    owner: 'AgentWorkforce', repo: 'factory', ref: 'factory/52', sha: 'def456', force: true,
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(
      root,
      'github/repos/AgentWorkforce/factory/refs/refs%2Fheads%2Ffactory%2F52.json',
    ), 'utf8')),
    { ref: 'refs/heads/factory/52', sha: 'def456', force: true },
  );

  await github.closePullRequest({ owner: 'AgentWorkforce', repo: 'factory', number: 52 });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, 'github/repos/AgentWorkforce/factory/pulls/52/close.json'), 'utf8')),
    {},
  );
});

test('telegramClient sends, edits, and reacts through canonical Telegram paths', async () => {
  const { root, opts } = await mount();
  const oldDeliveryId = process.env.WORKFORCE_TICK_DELIVERY_ID;
  process.env.WORKFORCE_TICK_DELIVERY_ID = 'telegram-delivery-1';
  try {
    const sent = await telegramClient(opts).sendMessage('C123', 'hello', {
      replyToMessageId: 41,
      threadId: 7,
      parseMode: 'MarkdownV2',
    });

    assert.equal(sent.ok, false);
    assert.equal(sent.chatId, 'C123');
    assert.equal(sent.messageId, '');
    assert.ok(sent.ref.startsWith('/telegram/chats/C123/messages/'));

    const msg = await onlyJsonIn(path.join(root, 'telegram/chats/C123/messages'));
    assert.deepEqual(msg.body, {
      text: 'hello',
      reply_to_message_id: 41,
      message_thread_id: 7,
      parse_mode: 'MarkdownV2',
      idempotencyKey: 'tick:telegram-delivery-1:1',
    });
  } finally {
    if (oldDeliveryId === undefined) delete process.env.WORKFORCE_TICK_DELIVERY_ID;
    else process.env.WORKFORCE_TICK_DELIVERY_ID = oldDeliveryId;
  }

  const edited = await telegramClient(opts).editMessage('C123', 42, 'edited', {
    disableWebPagePreview: true,
  });
  assert.deepEqual(edited, {
    ok: true,
    chatId: 'C123',
    messageId: '42',
    ref: '/telegram/chats/C123/messages/42.json',
  });
  const editBody = JSON.parse(await readFile(path.join(root, 'telegram/chats/C123/messages/42.json'), 'utf8'));
  assert.deepEqual(editBody, { text: 'edited', disable_web_page_preview: true });

  const reaction = await telegramClient(opts).react('C123', 42, '\u{1F44D}');
  assert.deepEqual(reaction, { ok: true, chatId: 'C123', messageId: '42' });
  const reactionDraft = await onlyJsonIn(path.join(root, 'telegram/chats/C123/messages/42/reactions'));
  assert.deepEqual(reactionDraft.body, { reaction: [{ type: 'emoji', emoji: '\u{1F44D}' }] });
});

test('telegramReceiptTs extracts the delivered message id from common receipt shapes', () => {
  assert.equal(telegramReceiptTs({ externalId: '42', created: 'fallback' }), '42');
  assert.equal(telegramReceiptTs({ messageId: 43 }), '43');
  assert.equal(telegramReceiptTs({ message_id: '44' }), '44');
  assert.equal(telegramReceiptTs({ id: '45' }), '45');
  assert.equal(telegramReceiptTs(undefined), '');
});

test('slackClient.post can return ts from direct Relayfile op providerResult', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes('/fs/file')) {
      return Response.json({
        opId: 'op_slack_direct',
        status: 'queued',
        targetRevision: 'rev_1',
        writeback: { provider: 'slack', state: 'pending' }
      });
    }
    if (url.includes('/ops/op_slack_direct')) {
      return Response.json({
        opId: 'op_slack_direct',
        status: 'succeeded',
        attemptCount: 1,
        providerResult: {
          provider: 'slack',
          externalId: '1781870464.800039',
          ts: '1781870464.800039',
          channel: 'C123'
        }
      });
    }
    return Response.json({ code: 'not_found', message: 'unexpected request' }, { status: 404 });
  };

  const result = await slackClient({
    relayfileBaseUrl: 'https://relayfile.example.test',
    relayfileApiToken: 'token-with-fs-write-and-ops-read',
    workspaceId: 'rw_7ccfea89',
    fetchImpl,
    writebackTimeoutMs: 100,
    writebackPollMs: 5
  }).post('C123', 'shipped');

  assert.equal(result.channel, 'C123');
  assert.equal(result.ts, '1781870464.800039');
  // post() now also returns `ref` — the draft handle for server-side threading
  // (the draft's relay path, available regardless of the receipt round-trip).
  assert.ok(result.ref, 'post returns a draft-handle ref');
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/v1\/workspaces\/rw_7ccfea89\/fs\/file\?/);
  assert.match(requests[1].url, /\/v1\/workspaces\/rw_7ccfea89\/ops\/op_slack_direct$/);
});

test('slackClient.post routes over HTTP via RELAYFILE_URL/TOKEN/WORKSPACE_ID env when no mount is present (sandbox:false)', async () => {
  // Exact sandbox:false reply-bot surface: no mount root, only the env vars the
  // cloud injects. slackClient().post() must transparently go over HTTP.
  const envKeys = [
    'RELAYFILE_MOUNT_PATH',
    'WORKSPACE_ROOT',
    'WORKFORCE_SANDBOX_ROOT',
    'RELAYFILE_MOUNT_ROOT',
    'RELAYFILE_ROOT',
    'RELAYFILE_BASE_URL',
    'RELAYFILE_URL',
    'RELAYFILE_TOKEN',
    'RELAYFILE_WORKSPACE_ID',
    'RELAYFILE_WORKSPACE',
    'RELAY_WORKSPACE_ID',
  ];
  const saved = new Map<string, string | undefined>();
  for (const key of envKeys) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.RELAYFILE_URL = 'https://relayfile.example.test';
  process.env.RELAYFILE_TOKEN = 'env-token';
  process.env.RELAYFILE_WORKSPACE_ID = 'rw_env';

  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/fs/file')) {
      return Response.json({
        opId: 'op_env_post',
        status: 'queued',
        targetRevision: 'rev_1',
        writeback: { provider: 'slack', state: 'pending' },
      });
    }
    if (url.includes('/ops/op_env_post')) {
      return Response.json({
        opId: 'op_env_post',
        status: 'succeeded',
        attemptCount: 1,
        providerResult: { provider: 'slack', externalId: '1781870464.999999', ts: '1781870464.999999', channel: 'C9' },
      });
    }
    return Response.json({ code: 'not_found' }, { status: 404 });
  };

  try {
    const result = await slackClient({ fetchImpl, writebackTimeoutMs: 100, writebackPollMs: 5 }).post('C9', 'shipped');
    assert.equal(result.channel, 'C9');
    assert.equal(result.ts, '1781870464.999999');
    assert.ok(result.ref, 'post still returns a draft-handle ref over HTTP');
    assert.equal(requests.length, 2);
    assert.match(requests[0], /\/v1\/workspaces\/rw_env\/fs\/file\?/);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('slackClient.post rejects a terminal op without Slack ts instead of returning an empty ts', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/fs/file')) {
      return Response.json({
        opId: 'op_slack_no_ts',
        status: 'queued',
        targetRevision: 'rev_1',
        writeback: { provider: 'slack', state: 'pending' }
      });
    }
    if (url.includes('/ops/op_slack_no_ts')) {
      return Response.json({
        opId: 'op_slack_no_ts',
        status: 'succeeded',
        attemptCount: 1,
        providerResult: {
          provider: 'slack',
          acknowledgedAt: '2026-06-19T12:01:04Z'
        }
      });
    }
    return Response.json({ code: 'not_found', message: 'unexpected request' }, { status: 404 });
  };

  await assert.rejects(
    () =>
      slackClient({
        relayfileBaseUrl: 'https://relayfile.example.test',
        relayfileApiToken: 'token-with-fs-write-and-ops-read',
        workspaceId: 'rw_7ccfea89',
        fetchImpl,
        writebackTimeoutMs: 20,
        writebackPollMs: 5
      }).post('C123', 'shipped'),
    (error: unknown) =>
      error instanceof RelayfileWritebackReceiptError &&
      !(error instanceof RelayfileWritebackPendingError) &&
      error.opId === 'op_slack_no_ts' &&
      error.cause instanceof Error &&
      /externalId or providerResult\.ts/.test(error.cause.message)
  );
});

test('every catalog provider has a named client export', () => {
  const providers = Object.keys(WRITEBACK_PATH_CATALOG);
  assert.ok(providers.length >= 29, `expected >=29 providers, saw ${providers.length}`);
  const missing = providers.filter(
    (provider) => typeof (helpers as Record<string, unknown>)[clientExportName(provider)] !== 'function'
  );
  assert.deepEqual(missing, [], `providers without a named client export: ${missing.join(', ')}`);
});

test('src/generated/clients.ts is in sync with the catalog', async () => {
  // dist/<this>.test.js → package root is one level up.
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { renderClients } = await import(
    pathToFileURL(path.join(pkgRoot, 'scripts/generate-clients.mjs')).href
  );
  const committed = await readFile(path.join(pkgRoot, 'src/generated/clients.ts'), 'utf8');
  assert.equal(
    committed,
    renderClients(),
    'generated clients are stale — run `npm run gen -w @relayfile/relay-helpers`'
  );
});

test('a named resource-keyed client resolves and writes catalog paths', async () => {
  const { root, opts } = await mount();
  const notion = notionClient(opts);
  assert.equal(notion.pages.path({ databaseId: 'db1' }), '/notion/databases/db1/pages');
  await notion.pages.write({ databaseId: 'db1' }, { title: 'P' });
  const draft = await onlyJsonIn(path.join(root, 'notion/databases/db1/pages'));
  assert.deepEqual(draft.body, { title: 'P' });
});

test('read() rejects (not throws synchronously) on a collection resource', async () => {
  const { opts } = await mount();
  // `comments` is a collection path, so read is invalid — but calling it must
  // not throw synchronously; the returned promise rejects so `.catch()` works.
  const promise = relayClient('linear', opts).read('comments', { issueId: 'ISS-1' });
  await assert.rejects(promise, /resolves to collection/);
});

test('providerClient throws a clear error for an unknown provider', () => {
  assert.throws(
    () => providerClient('not-a-provider' as never),
    /Unknown writeback provider "not-a-provider"/
  );
});

test('relayClient (dynamic) still resolves paths for every provider', () => {
  for (const provider of Object.keys(WRITEBACK_PATH_CATALOG)) {
    const client = relayClient(provider as keyof typeof WRITEBACK_PATH_CATALOG);
    const [resource, variants] = Object.entries(WRITEBACK_PATH_CATALOG[provider as keyof typeof WRITEBACK_PATH_CATALOG])[0];
    const params = Object.fromEntries((variants[0].params as readonly string[]).map((name) => [name, 'x']));
    assert.ok(client.path(resource as never, params).startsWith(`/${provider}`));
  }
});
