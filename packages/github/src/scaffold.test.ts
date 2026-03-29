import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CONFIG, GitHubAdapter, githubMappingPath, validateConfig } from './index.js';
import type { ConnectionProvider, ProxyRequest, ProxyResponse } from './types.js';

class MockProvider implements ConnectionProvider {
  readonly name = 'mock-provider';

  async proxy(_request: ProxyRequest): Promise<ProxyResponse> {
    return {
      status: 200,
      headers: {},
      data: null,
    };
  }
}

describe('scaffold', () => {
  it('validateConfig applies defaults', () => {
    const config = validateConfig({ repo: 'relayfile' });

    assert.strictEqual(config.baseUrl, DEFAULT_CONFIG.baseUrl);
    assert.strictEqual(config.repo, 'relayfile');
    assert.strictEqual(config.fetchFileContents, true);
    assert.ok(config.supportedEvents.includes('pull_request.opened'));
  });

  it('GitHubAdapter exposes the github adapter scaffold contract', async () => {
    const adapter = new GitHubAdapter(new MockProvider(), {
      owner: 'AgentWorkforce',
      repo: 'relayfile',
    });

    assert.strictEqual(adapter.name, 'github');
    assert.strictEqual(adapter.version, '0.1.0');
    assert.ok(adapter.supportedEvents().includes('check_run.completed'));

    const result = await adapter.ingestPullRequest({
      number: 42,
      repository: { full_name: 'AgentWorkforce/relayfile', name: 'relayfile' },
      pull_request: { number: 42 },
    });

    assert.strictEqual(result.filesWritten, 1);
    assert.strictEqual(result.paths[0], '/github/repos/AgentWorkforce/relayfile/pulls/42/metadata.json');
  });

  it('GitHubAdapter loads the copied schema mapping for webhook path computation', async () => {
    const adapter = new GitHubAdapter(new MockProvider(), {
      owner: 'AgentWorkforce',
      repo: 'relayfile',
    });

    assert.strictEqual(githubMappingPath.endsWith('/github.mapping.yaml'), true);

    const result = await adapter.ingestReview({
      action: 'submitted',
      repository: {
        full_name: 'AgentWorkforce/relayfile',
        name: 'relayfile',
        owner: { login: 'AgentWorkforce' },
      },
      pull_request: { number: 42 },
      review: { id: 77 },
    });

    assert.strictEqual(result.paths[0], '/github/repos/AgentWorkforce/relayfile/pulls/42/reviews/77.json');
  });
});
