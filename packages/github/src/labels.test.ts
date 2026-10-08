import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmGitHubLabelOperation, type GitHubLabelRequest, type GitHubLabelResponse } from './labels.js';

const definition = { name: 'triaged', color: 'abcdef', description: 'Ready for review' };
const ensure: GitHubLabelRequest = { action: 'ensure_repository_label', method: 'POST', endpoint: '/repos/acme/widgets/labels', body: definition };
const add: GitHubLabelRequest = { action: 'add_issue_label', method: 'POST', endpoint: '/repos/acme/widgets/issues/42/labels', body: { labels: [definition.name] } };
const remove: GitHubLabelRequest = { action: 'remove_issue_label', method: 'DELETE', endpoint: '/repos/acme/widgets/issues/42/labels/triaged' };
const alreadyExists = reply(422, { errors: [{ resource: 'Label', code: 'already_exists' }] });

function reply(status: number, data: unknown): GitHubLabelResponse {
  return { status, ok: status >= 200 && status < 300, data };
}

function transport(...responses: GitHubLabelResponse[]): { requests: GitHubLabelRequest[]; proxy: (request: GitHubLabelRequest) => Promise<GitHubLabelResponse> } {
  const requests: GitHubLabelRequest[] = [];
  return {
    requests,
    proxy: async (request): Promise<GitHubLabelResponse> => {
      requests.push(request);
      const response = responses.shift();
      assert.ok(response, 'Unexpected extra GitHub request');
      return response;
    },
  };
}

test('confirms generic labels without a Factory allowlist and preserves response context', async (): Promise<void> => {
  const response = { ...reply(201, { id: 41, ...definition, name: 'TRIAGED', color: 'ABCDEF' }), diagnostic: 'context' };
  const result = await confirmGitHubLabelOperation({ request: ensure, proxy: async (): Promise<typeof response> => response });
  assert.equal(result.confirmed, true);
  assert.equal(result.externalId, '41');
  assert.equal(result.response.diagnostic, 'context');
  const emptyDescription = { ...definition, description: '' };
  const t = transport(reply(201, emptyDescription));
  assert.equal((await confirmGitHubLabelOperation({ request: { ...ensure, body: emptyDescription }, proxy: t.proxy })).confirmed, true);
});

test('confirms an existing label and repairs drift only when the update is confirmed', async (): Promise<void> => {
  const existing = transport(alreadyExists, reply(200, definition));
  assert.equal((await confirmGitHubLabelOperation({ request: ensure, proxy: existing.proxy })).confirmed, true);
  assert.deepEqual(existing.requests.map((request): string => request.method), ['POST', 'GET']);
  assert.equal(existing.requests[1]?.body, undefined);
  for (const updated of [reply(200, definition), reply(200, { ...definition, color: '000000' }), reply(403, { message: 'Forbidden' })]) {
    const t = transport(alreadyExists, reply(200, { ...definition, color: '000000' }), updated);
    const result = await confirmGitHubLabelOperation({ request: ensure, proxy: t.proxy });
    assert.equal(result.confirmed, updated.ok && updated.data === definition);
    assert.deepEqual(t.requests.map((request): string => request.method), ['POST', 'GET', 'PATCH']);
    assert.equal(t.requests[2]?.endpoint, '/repos/acme/widgets/labels/triaged');
    assert.deepEqual(t.requests[2]?.body, { new_name: definition.name, color: definition.color, description: definition.description });
  }
});

test('adds and removes only the requested label and requires a valid returned label set', async (): Promise<void> => {
  for (const [request, data, expected] of [
    [add, [{ name: 'TRIAGED' }, { name: 'bug' }], true],
    [add, ['triaged', 'bug'], true],
    [add, ['bug'], false],
    [add, [{ name: 'triaged' }, {}], false],
    [remove, ['bug'], true],
    [remove, [], true],
    [remove, ['triaged'], false],
    [remove, {}, false],
  ] as const) {
    const t = transport(reply(200, data));
    const result = await confirmGitHubLabelOperation({ request, proxy: t.proxy });
    assert.equal(result.confirmed, expected);
    assert.deepEqual(t.requests, [request]);
  }
});

test('treats a removal 404 as success only when a readable issue confirms absence', async (): Promise<void> => {
  for (const [response, expected] of [
    [reply(200, { labels: ['bug'] }), true],
    [reply(200, { labels: ['triaged'] }), false],
    [reply(200, {}), false],
    [reply(404, { message: 'Not Found' }), false],
    [reply(503, {}), false],
  ] as const) {
    const t = transport(reply(404, {}), response);
    assert.equal((await confirmGitHubLabelOperation({ request: remove, proxy: t.proxy })).confirmed, expected);
    assert.equal(t.requests[1]?.endpoint, '/repos/acme/widgets/issues/42');
    assert.equal(t.requests[1]?.method, 'GET');
    assert.equal(t.requests[1]?.body, undefined);
  }
});

test('rejects unconfirmed ensures and preserves provider failures without retries', async (): Promise<void> => {
  for (const response of [reply(200, {}), reply(422, { message: 'Other validation failure' }), reply(429, {}), reply(503, {})]) {
    const t = transport(response);
    const result = await confirmGitHubLabelOperation({ request: ensure, proxy: t.proxy });
    assert.equal(result.confirmed, false);
    assert.equal(result.response, response);
    assert.equal(t.requests.length, 1);
  }
  const t = transport(alreadyExists, reply(403, {}));
  assert.equal((await confirmGitHubLabelOperation({ request: ensure, proxy: t.proxy })).confirmed, false);
  assert.equal(t.requests.length, 2);
});

test('validates request bodies before sending and propagates ambiguous transport failures', async (): Promise<void> => {
  for (const request of [{ ...ensure, body: { ...definition, color: 'wrong' } }, { ...add, body: { labels: [] } }, { ...remove, endpoint: '/missing-label' }]) {
    const t = transport();
    await assert.rejects(confirmGitHubLabelOperation({ request, proxy: t.proxy }));
    assert.equal(t.requests.length, 0);
  }
  const error = new Error('Ambiguous network failure');
  for (const request of [ensure, add, remove]) {
    let attempts = 0;
    await assert.rejects(confirmGitHubLabelOperation({ request, proxy: async (): Promise<GitHubLabelResponse> => { attempts += 1; throw error; } }), error);
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  await assert.rejects(confirmGitHubLabelOperation({ request: ensure, proxy: async (): Promise<GitHubLabelResponse> => { attempts += 1; if (attempts === 1) return alreadyExists; throw error; } }), error);
  assert.equal(attempts, 2);
});
