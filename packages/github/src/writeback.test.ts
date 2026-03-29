import { expect, test } from 'vitest';

import { GitHubWritebackHandler } from './writeback.js';
import type {
  GitHubProxyProvider,
  JsonObject,
  ProxyRequest,
  ProxyResponse,
} from './types.js';

class FakeProvider implements GitHubProxyProvider {
  readonly name = 'fake-nango';
  readonly requests: ProxyRequest[] = [];
  private readonly responseFactory: (request: ProxyRequest) => Promise<ProxyResponse> | ProxyResponse;

  constructor(responseFactory: (request: ProxyRequest) => Promise<ProxyResponse> | ProxyResponse) {
    this.responseFactory = responseFactory;
  }

  async proxy(request: ProxyRequest): Promise<ProxyResponse> {
    this.requests.push(request);
    return this.responseFactory(request);
  }
}

function createHandler(
  responseFactory?: (request: ProxyRequest) => Promise<ProxyResponse> | ProxyResponse,
) {
  const provider = new FakeProvider(
    responseFactory ??
      (() => ({
        status: 201,
        headers: {},
        data: { id: 991 } satisfies JsonObject,
      })),
  );

  const handler = new GitHubWritebackHandler(provider, {
    defaultConnectionId: 'conn-default',
  });

  return { handler, provider };
}

test('parseReviewPayload maps agent review JSON into typed GitHub review input', () => {
  const { handler } = createHandler();
  const content = JSON.stringify({
    event: 'REQUEST_CHANGES',
    body: 'Please address the findings below.',
    comments: [
      {
        path: 'src/index.ts',
        line: 14,
        side: 'RIGHT',
        body: 'Null check is missing here.',
        suggestion: 'if (!value) {\n  return;\n}',
      },
    ],
    metadata: {
      commitSha: 'abc123',
      connectionId: 'conn-metadata',
    },
  });

  const parsed = handler.parseReviewPayload(content);
  const mapped = handler.toGitHubReview(parsed);

  expect(parsed.event).toBe('REQUEST_CHANGES');
  expect(parsed.comments[0]?.line).toBe(14);
  expect(mapped.comments[0]?.line).toBe(14);
  expect(mapped.comments[0]?.body).toBe(
    'Null check is missing here.\n\n```suggestion\nif (!value) {\n  return;\n}\n```',
  );
});

test('extractWritebackTarget parses owner, repo, and pull request number from relayfile path', () => {
  const { handler } = createHandler();
  const target = handler.extractWritebackTarget(
    '/github/repos/openai/relayfile/pulls/42/reviews/agent-reviewer.json',
  );

  expect(target).toEqual({
    owner: 'openai',
    repo: 'relayfile',
    prNumber: 42,
  });
});

test('handleWriteback submits mapped review comments to the GitHub reviews endpoint', async () => {
  const { handler, provider } = createHandler();
  const result = await handler.handleWriteback(
    'workspace-1',
    '/github/repos/acme/widgets/pulls/7/reviews/agent-42.json',
    JSON.stringify({
      event: 'COMMENT',
      body: 'Automated review summary.',
      comments: [
        {
          path: 'src/writeback.ts',
          line: 88,
          side: 'RIGHT',
          body: 'This line is still doing redundant work.',
        },
      ],
    }),
  );

  expect(result.success).toBe(true);
  expect(result.externalId).toBe('991');
  expect(provider.requests).toHaveLength(1);
  expect(provider.requests[0]?.endpoint).toBe('/repos/acme/widgets/pulls/7/reviews');
  expect(provider.requests[0]?.connectionId).toBe('conn-default');

  const body = provider.requests[0]?.body as JsonObject;
  const comments = body.comments;
  expect(Array.isArray(comments)).toBe(true);
  const firstComment = comments[0];
  expect(typeof firstComment).toBe('object');
  expect((firstComment as JsonObject).line).toBe(88);
});

test('writeBack delegates to the GitHub review writeback pipeline', async () => {
  const { handler, provider } = createHandler();
  const result = await handler.writeBack(
    'workspace-1',
    '/github/repos/acme/widgets/pulls/12/reviews/agent-99.json',
    JSON.stringify({
      event: 'COMMENT',
      body: 'Adapter-level writeBack submission.',
      comments: [
        {
          path: 'src/types.ts',
          line: 21,
          body: 'The public adapter method should remain aligned with the spec.',
        },
      ],
    }),
  );

  expect(result.success).toBe(true);
  expect(result.externalId).toBe('991');
  expect(provider.requests).toHaveLength(1);
  expect(provider.requests[0]?.endpoint).toBe('/repos/acme/widgets/pulls/12/reviews');
});

test('handleWriteback returns a typed error for invalid JSON', async () => {
  const { handler } = createHandler();
  const result = await handler.handleWriteback(
    'workspace-1',
    '/github/repos/acme/widgets/pulls/7/reviews/agent-42.json',
    '{not valid json',
  );

  expect(result.success).toBe(false);
  expect(result.error ?? '').toMatch(/Invalid review JSON/);
});

test('parseReviewPayload rejects missing required fields', () => {
  const { handler } = createHandler();

  expect(() =>
    handler.parseReviewPayload(
      JSON.stringify({
        event: 'COMMENT',
        body: 'summary',
        comments: [{ path: 'src/file.ts', side: 'RIGHT', body: 'Missing line number' }],
      }),
    ),
  ).toThrow(/positive integer/);
});

test('handleWriteback surfaces provider-side API failures', async () => {
  const { handler } = createHandler(() => ({
    status: 422,
    headers: {},
    data: { message: 'Review comments are invalid because the diff is outdated.' } satisfies JsonObject,
  }));

  const result = await handler.handleWriteback(
    'workspace-1',
    '/github/repos/acme/widgets/pulls/7/reviews/agent-42.json',
    JSON.stringify({
      event: 'COMMENT',
      body: 'summary',
      comments: [{ path: 'src/file.ts', line: 4, side: 'RIGHT', body: 'Outdated diff' }],
    }),
  );

  expect(result.success).toBe(false);
  expect(result.error ?? '').toMatch(/422/);
  expect(result.error ?? '').toMatch(/outdated/);
});
