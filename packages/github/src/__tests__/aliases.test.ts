import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ingestIssue } from '../issues/issue-mapper.js';
import { githubByIdAliasPath, githubByTitleAliasPath } from '../path-mapper.js';
import { ingestPullRequest } from '../pr/diff-writer.js';
import {
  type GitHubRequestProvider,
  type JsonObject,
  type ProxyRequest,
  type ProxyResponse,
} from '../types.js';

function jsonResponse(data: ProxyResponse['data']): ProxyResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data,
  };
}

function createMemoryVfs() {
  const files = new Map<string, string>();
  return {
    files,
    vfs: {
      exists(path: string) {
        return files.has(path);
      },
      readFile(path: string) {
        const value = files.get(path);
        if (value === undefined) {
          throw new Error(`Missing path: ${path}`);
        }
        return value;
      },
      writeFile(path: string, content: string) {
        files.set(path, content);
      },
    },
  };
}

function createIssueProvider(issues: Record<number, JsonObject>): GitHubRequestProvider {
  return {
    name: 'fixture-github',
    connectionId: 'conn-fixture',
    async proxy(request: ProxyRequest): Promise<ProxyResponse> {
      const issueMatch = request.endpoint.match(/^\/repos\/octocat\/hello-world\/issues\/(\d+)$/);
      if (issueMatch) {
        return jsonResponse(issues[Number(issueMatch[1])]);
      }

      const issueCommentsMatch = request.endpoint.match(/^\/repos\/octocat\/hello-world\/issues\/(\d+)\/comments(?:\?per_page=100)?$/);
      if (issueCommentsMatch && issues[Number(issueCommentsMatch[1])]) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
    },
  };
}

function createPullRequestProvider(): GitHubRequestProvider {
  return {
    name: 'fixture-github',
    connectionId: 'conn-fixture',
    async proxy(request: ProxyRequest): Promise<ProxyResponse> {
      if (request.endpoint === '/repos/octocat/hello-world/pulls/42/files') {
        return jsonResponse([]);
      }

      if (request.endpoint === '/repos/octocat/hello-world/pulls/42') {
        if (request.headers?.Accept === 'application/vnd.github.diff') {
          return {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            data: 'diff --git a/src/index.ts b/src/index.ts\n',
          };
        }

        return jsonResponse({
          number: 42,
          title: 'Add fixture-backed GitHub adapter coverage',
          state: 'open',
          body: 'PR body',
          draft: false,
          merged: false,
          created_at: '2026-03-25T10:00:00Z',
          updated_at: '2026-03-28T07:45:00Z',
          closed_at: null,
          merged_at: null,
          html_url: 'https://github.com/octocat/hello-world/pull/42',
          diff_url: 'https://github.com/octocat/hello-world/pull/42.diff',
          patch_url: 'https://github.com/octocat/hello-world/pull/42.patch',
          user: {
            id: 1,
            login: 'octocat',
            type: 'User',
            avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
            html_url: 'https://github.com/octocat',
          },
          labels: [],
          head: {
            label: 'octocat:feature',
            ref: 'feature',
            sha: 'head-sha',
            repo: {
              id: 10,
              name: 'hello-world',
              full_name: 'octocat/hello-world',
              private: false,
              html_url: 'https://github.com/octocat/hello-world',
            },
          },
          base: {
            label: 'octocat:main',
            ref: 'main',
            sha: 'base-sha',
            repo: {
              id: 10,
              name: 'hello-world',
              full_name: 'octocat/hello-world',
              private: false,
              html_url: 'https://github.com/octocat/hello-world',
            },
          },
        });
      }

      throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
    },
  };
}

function createIssue(number: number, title: string): JsonObject {
  return {
    number,
    title,
    state: 'open',
    body: `${title} body`,
    created_at: '2026-03-25T10:00:00Z',
    updated_at: '2026-03-28T07:45:00Z',
    closed_at: null,
    html_url: `https://github.com/octocat/hello-world/issues/${number}`,
    labels: [],
    assignees: [],
    user: {
      login: 'octocat',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    },
  };
}

describe('github aliases', () => {
  it('writes issue aliases under the <owner>__<repo> root and disambiguates title collisions', async () => {
    const { vfs } = createMemoryVfs();
    const provider = createIssueProvider({
      7: createIssue(7, 'Shared title'),
      8: createIssue(8, 'Shared title'),
    });

    await ingestIssue(provider, 'octocat', 'hello-world', 7, vfs as never);
    await ingestIssue(provider, 'octocat', 'hello-world', 8, vfs as never);

    const firstCanonicalPath = '/github/repos/octocat/hello-world/issues/7__shared-title/meta.json';
    const secondCanonicalPath = '/github/repos/octocat/hello-world/issues/8__shared-title/meta.json';
    const byIdPath = githubByIdAliasPath('octocat', 'hello-world', 'issues', 7);
    const baseTitlePath = githubByTitleAliasPath('octocat', 'hello-world', 'issues', 'Shared title', 7);
    const collisionTitlePath = githubByTitleAliasPath('octocat', 'hello-world', 'issues', 'Shared title', 8, true);

    assert.strictEqual(vfs.readFile(byIdPath), vfs.readFile(firstCanonicalPath));
    assert.strictEqual(vfs.readFile(baseTitlePath), vfs.readFile(firstCanonicalPath));
    assert.strictEqual(vfs.readFile(collisionTitlePath), vfs.readFile(secondCanonicalPath));

    const index = JSON.parse(vfs.readFile('/github/repos/octocat__hello-world/issues/_index.json')) as {
      rows: Array<{ file: string }>;
    };
    assert.deepStrictEqual(index.rows.map((row) => row.file), ['by-id/', 'by-title/']);
  });

  it('writes an untitled by-title alias when the issue title slugs to nothing', async () => {
    const { vfs } = createMemoryVfs();
    const provider = createIssueProvider({
      9: createIssue(9, '🚀🔥'),
    });

    await ingestIssue(provider, 'octocat', 'hello-world', 9, vfs as never);

    const canonicalPath = '/github/repos/octocat/hello-world/issues/9/meta.json';
    const untitledAliasPath = githubByTitleAliasPath('octocat', 'hello-world', 'issues', '🚀🔥', 9);

    assert.strictEqual(vfs.readFile(untitledAliasPath), vfs.readFile(canonicalPath));
    assert.ok(untitledAliasPath.endsWith('/by-title/untitled.json'));
  });

  it('writes pull-request by-id aliases that resolve to the canonical metadata file', async () => {
    const { vfs } = createMemoryVfs();

    await ingestPullRequest(createPullRequestProvider(), 'octocat', 'hello-world', 42, vfs as never);

    const canonicalPath =
      '/github/repos/octocat/hello-world/pulls/42__add-fixture-backed-github-adapter-coverage/meta.json';
    const byIdPath = githubByIdAliasPath('octocat', 'hello-world', 'pulls', 42);

    assert.strictEqual(vfs.readFile(byIdPath), vfs.readFile(canonicalPath));
    assert.ok(byIdPath.includes('/github/repos/octocat__hello-world/pulls/by-id/42.json'));
  });
});
