import type {
  GitHubProxyProvider as ConnectionProvider,
  JsonObject,
  ProxyRequest,
  ProxyResponse,
} from '../../types.js';

import {
  mockBaseFileContents,
  mockCheckRuns,
  mockCommits,
  mockDiff,
  mockFileContents,
  mockIssueComments,
  mockIssuePayload,
  mockPRFiles,
  mockPRPayload,
  mockRepoContext,
  mockReviews,
  mockReviewComments,
} from './index.js';

export interface MockConnectionProvider extends ConnectionProvider {
  readonly requests: ProxyRequest[];
  reset(): void;
}

const GITHUB_API_BASE_URL = 'https://api.github.com';
const CONTENTS_PREFIX = `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/contents/`;

export function createMockProvider(): MockConnectionProvider {
  const requests: ProxyRequest[] = [];

  return {
    name: 'mock-github',
    requests,
    reset() {
      requests.length = 0;
    },
    async proxy(request: ProxyRequest): Promise<ProxyResponse> {
      requests.push(request);

      if (request.baseUrl !== GITHUB_API_BASE_URL) {
        throw new Error(`Unsupported base URL: ${request.baseUrl}`);
      }

      if (request.method !== 'GET') {
        throw new Error(`Unsupported mock method: ${request.method} ${request.endpoint}`);
      }

      if (
        request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/files`
      ) {
        return jsonResponse(mockPRFiles);
      }

      if (
        request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/commits`
      ) {
        return jsonResponse(mockCommits);
      }

      if (
        request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/reviews`
      ) {
        return jsonResponse(mockReviews);
      }

      if (
        request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/comments`
      ) {
        return jsonResponse(mockReviewComments);
      }

      if (
        request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/issues/10/comments` ||
        request.endpoint.startsWith(
          `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/issues/10/comments?`,
        )
      ) {
        return jsonResponse(mockIssueComments);
      }

      if (request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/issues/10`) {
        return jsonResponse(mockIssuePayload);
      }

      if (
        request.endpoint ===
        `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/commits/${mockRepoContext.headSha}/check-runs`
      ) {
        return jsonResponse({
          total_count: mockCheckRuns.length,
          check_runs: mockCheckRuns,
        });
      }

      if (request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42`) {
        if (request.headers?.Accept === 'application/vnd.github.diff') {
          return {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            data: mockDiff,
          };
        }

        return jsonResponse(mockPRPayload);
      }

      if (request.endpoint.startsWith(CONTENTS_PREFIX)) {
        return jsonResponse(resolveContentsResponse(request));
      }

      throw new Error(`No mock fixture for ${request.method} ${request.endpoint}`);
    },
  };
}

function resolveContentsResponse(request: ProxyRequest): JsonObject {
  const [rawPath, rawQuery = ''] = request.endpoint.slice(CONTENTS_PREFIX.length).split('?');
  const path = decodeURIComponent(rawPath);
  const params = new URLSearchParams(rawQuery);
  const ref = request.query?.ref ?? params.get('ref') ?? mockRepoContext.headSha;
  const contentMap = ref === mockRepoContext.baseSha ? mockBaseFileContents : mockFileContents;
  const content = contentMap[path];

  if (!content) {
    throw new Error(`No mock file content for ${path} at ref ${ref}`);
  }

  return {
    type: 'file',
    encoding: 'base64',
    name: path.split('/').at(-1) ?? path,
    path,
    size: Buffer.from(content, 'base64').byteLength,
    sha: ref === mockRepoContext.baseSha ? `${path}-base` : `${path}-head`,
    content,
  };
}

function jsonResponse(data: JsonObject | readonly unknown[] | unknown): ProxyResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data: data as ProxyResponse['data'],
  };
}
