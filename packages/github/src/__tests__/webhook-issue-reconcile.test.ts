import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GitHubAdapter } from '../index.js';
import type { JsonObject, ProxyRequest, ProxyResponse } from '../types.js';

const OWNER = 'AgentWorkforce';
const REPO = 'cloud';

interface ProviderOptions {
  // When set, the issue endpoint responds 404 so reconciliation falls back to
  // the webhook envelope.
  failIssueFetch?: boolean;
  apiLabels?: string[];
}

/**
 * VFS-capable provider that mirrors how the adapter runs in production: it both
 * answers GitHub API proxy calls and persists files to an in-memory mount.
 */
class ReconcileProvider {
  readonly name = 'reconcile-github';
  readonly connectionId = 'conn-reconcile';
  readonly requests: ProxyRequest[] = [];
  readonly writes = new Map<string, string>();

  constructor(private readonly options: ProviderOptions = {}) {}

  async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
    this.requests.push(request);

    const issueEndpoint = `/repos/${OWNER}/${REPO}/issues/2174`;
    if (request.endpoint === issueEndpoint) {
      if (this.options.failIssueFetch) {
        return { status: 404, headers: {}, data: { message: 'Not Found' } as T };
      }
      return {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        data: createApiIssue(this.options.apiLabels ?? ['factory']) as T,
      };
    }

    if (request.endpoint.startsWith(`${issueEndpoint}/comments`)) {
      return { status: 200, headers: {}, data: [] as unknown as T };
    }

    throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.writes.set(path, content);
  }

  async readFile(path: string): Promise<string | undefined> {
    return this.writes.get(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.writes.has(path);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

function createApiIssue(labelNames: string[]): JsonObject {
  return {
    number: 2174,
    title: 'Factory: backfill missing issues',
    state: 'open',
    body: 'A factory-labeled issue.',
    html_url: `https://github.com/${OWNER}/${REPO}/issues/2174`,
    user: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
    assignees: [],
    labels: labelNames.map((name) => ({ name })),
    milestone: null,
    created_at: '2026-05-28T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    closed_at: null,
  };
}

function issueWebhookPayload(action: string, envelopeLabels: string[]): Record<string, unknown> {
  return {
    action,
    repository: {
      full_name: `${OWNER}/${REPO}`,
      name: REPO,
      owner: { login: OWNER },
    },
    issue: {
      number: 2174,
      title: 'Factory: backfill missing issues',
      state: 'open',
      labels: envelopeLabels.map((name) => ({ name })),
      user: { login: 'octocat' },
    },
  };
}

function metaPath(writes: Map<string, string>): string {
  const found = [...writes.keys()].find(
    (path) => path.startsWith(`/github/repos/${OWNER}/${REPO}/issues/2174`) && path.endsWith('/meta.json'),
  );
  assert.ok(found, 'expected an issue meta.json to be written');
  return found;
}

function readJson(writes: Map<string, string>, path: string): JsonObject {
  const raw = writes.get(path);
  assert.ok(typeof raw === 'string', `expected VFS file at ${path}`);
  return JSON.parse(raw) as JsonObject;
}

const issuesIndexPath = `/github/repos/${OWNER}/${REPO}/issues/_index.json`;

describe('GitHub webhook issue reconciliation (issue #176)', () => {
  it('re-fetches the issue on issues.labeled instead of trusting the empty envelope', async () => {
    const provider = new ReconcileProvider({ apiLabels: ['factory', 'bug'] });
    const adapter = new GitHubAdapter(provider as never, { owner: OWNER, repo: REPO });

    // Envelope carries no labels — the bug being fixed. Reconciliation must
    // re-fetch and write the authoritative labels anyway.
    const result = await adapter.routeWebhook(issueWebhookPayload('labeled', []), undefined, {
      'x-github-event': 'issues',
    });

    assert.deepEqual(result.errors, []);
    assert.ok(
      provider.requests.some((request) => request.endpoint === `/repos/${OWNER}/${REPO}/issues/2174`),
      'expected the adapter to re-fetch the issue from the GitHub API',
    );

    const meta = readJson(provider.writes, metaPath(provider.writes));
    assert.deepEqual(meta.labels, ['factory', 'bug']);
    assert.equal(meta.state, 'open');

    const indexRows = JSON.parse(provider.writes.get(issuesIndexPath) ?? '[]') as JsonObject[];
    const row = indexRows.find((entry) => entry.number === 2174);
    assert.ok(row, 'expected an index row for #2174');
    assert.deepEqual(row.labels, ['factory', 'bug']);
  });

  it('opens a complete record on issues.opened with labels', async () => {
    const provider = new ReconcileProvider({ apiLabels: ['factory'] });
    const adapter = new GitHubAdapter(provider as never, { owner: OWNER, repo: REPO });

    await adapter.routeWebhook(issueWebhookPayload('opened', ['factory']), undefined, {
      'x-github-event': 'issues',
    });

    const meta = readJson(provider.writes, metaPath(provider.writes));
    assert.deepEqual(meta.labels, ['factory']);
  });

  it('falls back to the envelope labels when the API re-fetch fails', async () => {
    const provider = new ReconcileProvider({ failIssueFetch: true });
    const adapter = new GitHubAdapter(provider as never, { owner: OWNER, repo: REPO });

    const result = await adapter.routeWebhook(issueWebhookPayload('labeled', ['factory']), undefined, {
      'x-github-event': 'issues',
    });

    assert.deepEqual(result.errors, []);
    const meta = readJson(provider.writes, metaPath(provider.writes));
    // Labels came from the webhook envelope, not the (failed) API fetch.
    assert.deepEqual(meta.labels, ['factory']);
  });

  it('backfills a missing issue meta.json when only a comment event arrives', async () => {
    const provider = new ReconcileProvider({ apiLabels: ['factory'] });
    const adapter = new GitHubAdapter(provider as never, { owner: OWNER, repo: REPO });

    const commentPayload = {
      action: 'created',
      repository: { full_name: `${OWNER}/${REPO}`, name: REPO, owner: { login: OWNER } },
      issue: { number: 2174, title: 'Factory: backfill missing issues' },
      comment: { id: 9001, body: 'A comment on an un-materialized issue' },
    };

    await adapter.routeWebhook(commentPayload, undefined, { 'x-github-event': 'issue_comment' });

    // The parent issue record was materialized as a side effect of the comment.
    const meta = readJson(provider.writes, metaPath(provider.writes));
    assert.deepEqual(meta.labels, ['factory']);
  });

  it('does not re-backfill when the issue meta.json already exists', async () => {
    const provider = new ReconcileProvider({ apiLabels: ['factory'] });
    const adapter = new GitHubAdapter(provider as never, { owner: OWNER, repo: REPO });

    // Materialize the issue first via a labeled event.
    await adapter.routeWebhook(issueWebhookPayload('labeled', []), undefined, { 'x-github-event': 'issues' });
    const fetchCountAfterFirst = provider.requests.filter(
      (request) => request.endpoint === `/repos/${OWNER}/${REPO}/issues/2174`,
    ).length;

    const commentPayload = {
      action: 'created',
      repository: { full_name: `${OWNER}/${REPO}`, name: REPO, owner: { login: OWNER } },
      issue: { number: 2174, title: 'Factory: backfill missing issues' },
      comment: { id: 9002, body: 'second comment' },
    };
    await adapter.routeWebhook(commentPayload, undefined, { 'x-github-event': 'issue_comment' });

    const fetchCountAfterComment = provider.requests.filter(
      (request) => request.endpoint === `/repos/${OWNER}/${REPO}/issues/2174`,
    ).length;

    // The comment event must not trigger another issue re-fetch once the
    // by-id alias is present.
    assert.equal(fetchCountAfterComment, fetchCountAfterFirst);
  });
});
