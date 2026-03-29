import { describe, expect, it, vi } from 'vitest';

import { mockIssueComments, mockRepoContext } from '../__tests__/fixtures/index.js';
import { createMockProvider } from '../__tests__/fixtures/mock-provider.js';
import { ingestIssueComments, mapIssueComment } from './comment-mapper.js';

describe('issue comment mapper', () => {
  it('mapIssueComment produces the expected JSON document', () => {
    const mapped = mapIssueComment(
      { ...mockIssueComments[0] },
      mockRepoContext.owner,
      mockRepoContext.repo,
      10,
    );

    expect(mapped.vfsPath).toBe('issues/10/comments/7001.json');
    expect(JSON.parse(mapped.content)).toEqual({
      id: 7001,
      body: 'I can pick this up after the PR ingestion flow lands.',
      author: {
        login: 'monalisa',
        avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
      },
      created_at: '2026-03-26T09:15:00Z',
      updated_at: '2026-03-26T09:15:00Z',
      reactions: {
        total_count: 1,
        '+1': 1,
        '-1': 0,
        laugh: 0,
        confused: 0,
        eyes: 0,
        heart: 0,
        hooray: 0,
        rocket: 0,
      },
    });
  });

  it('ingestIssueComments fetches and writes all mapped comments', async () => {
    const provider = {
      ...createMockProvider(),
      connectionId: 'conn-fixture',
    };
    const writes = new Map<string, string>();
    const vfs = {
      writeFile: vi.fn(async (path: string, content: string) => {
        writes.set(path, content);
      }),
    };

    const result = await ingestIssueComments(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      10,
      vfs,
    );

    expect(result).toEqual({
      filesWritten: 2,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [
        '/github/repos/octocat/hello-world/issues/10/comments/7001.json',
        '/github/repos/octocat/hello-world/issues/10/comments/7002.json',
      ],
      errors: [],
    });
    expect(Array.from(writes.keys())).toEqual(result.paths);
    expect(JSON.parse(writes.get(result.paths[1]) ?? '')).toMatchObject({
      id: 7002,
      author: {
        login: 'octocat',
      },
      reactions: {
        total_count: 2,
        hooray: 1,
      },
    });
  });
});
