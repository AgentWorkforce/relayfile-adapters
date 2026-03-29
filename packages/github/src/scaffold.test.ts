import { expect, test } from 'vitest';

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

test('validateConfig applies defaults', () => {
  const config = validateConfig({ repo: 'relayfile' });

  expect(config.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
  expect(config.repo).toBe('relayfile');
  expect(config.fetchFileContents).toBe(true);
  expect(config.supportedEvents).toContain('pull_request.opened');
});

test('GitHubAdapter exposes the github adapter scaffold contract', async () => {
  const adapter = new GitHubAdapter(new MockProvider(), {
    owner: 'AgentWorkforce',
    repo: 'relayfile',
  });

  expect(adapter.name).toBe('github');
  expect(adapter.version).toBe('0.1.0');
  expect(adapter.supportedEvents()).toContain('check_run.completed');

  const result = await adapter.ingestPullRequest({
    number: 42,
    repository: { full_name: 'AgentWorkforce/relayfile', name: 'relayfile' },
    pull_request: { number: 42 },
  });

  expect(result.filesWritten).toBe(1);
  expect(result.paths[0]).toBe('/github/repos/AgentWorkforce/relayfile/pulls/42/metadata.json');
});

test('GitHubAdapter loads the copied schema mapping for webhook path computation', async () => {
  const adapter = new GitHubAdapter(new MockProvider(), {
    owner: 'AgentWorkforce',
    repo: 'relayfile',
  });

  expect(githubMappingPath.endsWith('/github.mapping.yaml')).toBe(true);

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

  expect(result.paths[0]).toBe('/github/repos/AgentWorkforce/relayfile/pulls/42/reviews/77.json');
});
