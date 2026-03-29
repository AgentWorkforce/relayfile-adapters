import { describe, expect, it } from 'vitest';

import {
  mapCommitProperties,
  mapIssueProperties,
  mapPRProperties,
  mapReviewProperties,
} from '../property-mapper.js';
import {
  mapCommitRelations,
  mapIssueRelations,
  mapPRRelations,
  mapReviewRelations,
} from '../relation-mapper.js';

const pullRequestFixture = {
  id: 101,
  number: 42,
  title: 'Add semantics mapping coverage',
  state: 'open',
  user: {
    login: 'octocat',
    id: 1,
  },
  base: {
    ref: 'main',
    sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  },
  head: {
    ref: 'feature/semantics-tests',
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  labels: [{ id: 11, name: 'bug' }, { id: 12, name: 'needs-review' }],
  created_at: '2026-03-27T10:15:30Z',
  updated_at: '2026-03-28T08:45:00Z',
  mergeable: true,
};

const commitFixture = {
  sha: '9fceb02c1f7e4f0f4b3f934c5b191d9d5b7f5e25',
  author: {
    login: 'hubot',
    id: 2,
  },
  commit: {
    message: 'Normalize semantic relation paths',
    author: {
      name: 'Hubot',
      email: 'hubot@example.com',
      date: '2026-03-27T12:00:00Z',
    },
  },
  additions: 18,
  deletions: 4,
  parents: [
    { sha: '1111111111111111111111111111111111111111' },
    '2222222222222222222222222222222222222222',
  ],
};

const reviewFixture = {
  id: 77,
  node_id: 'PRR_kwDOAAAB',
  user: {
    login: 'review-bot',
    id: 3,
  },
  body: 'Looks good overall.',
  state: 'APPROVED',
  submitted_at: '2026-03-28T07:30:00Z',
  pull_request_url: 'https://api.github.com/repos/acme/widgets/pulls/42',
};

const issueFixture = {
  id: 501,
  number: 9,
  title: 'Sync issue semantics',
  state: 'open',
  user: {
    login: 'triager',
    id: 4,
  },
  labels: [
    { id: 21, name: 'bug' },
    { id: 22, name: 'priority:high' },
    { id: 23, name: 'backend' },
  ],
  assignees: [
    { login: 'maintainer-1', id: 5 },
    { login: 'maintainer-2', id: 6 },
  ],
  created_at: '2026-03-20T09:00:00Z',
};

describe('property mappers', () => {
  it('mapPRProperties extracts all required fields', () => {
    expect(mapPRProperties(pullRequestFixture)).toEqual({
      title: 'Add semantics mapping coverage',
      state: 'open',
      'author.login': 'octocat',
      base_branch: 'main',
      head_branch: 'feature/semantics-tests',
      labels: 'bug,needs-review',
      created_at: '2026-03-27T10:15:30Z',
      updated_at: '2026-03-28T08:45:00Z',
      mergeable: 'true',
    });
  });

  it('mapPRProperties handles missing optional fields', () => {
    expect(
      mapPRProperties({
        title: 'Draft PR without metadata',
        state: 'draft',
        user: {
          login: 'ghost',
        },
        base: {},
        head: {},
      }),
    ).toEqual({
      title: 'Draft PR without metadata',
      state: 'draft',
      'author.login': 'ghost',
    });
  });

  it('mapCommitProperties formats author correctly', () => {
    expect(mapCommitProperties(commitFixture)).toEqual({
      sha: '9fceb02c1f7e4f0f4b3f934c5b191d9d5b7f5e25',
      message: 'Normalize semantic relation paths',
      'author.login': 'hubot',
      'author.email': 'hubot@example.com',
      date: '2026-03-27T12:00:00Z',
      additions: '18',
      deletions: '4',
    });
  });

  it('mapReviewProperties maps state enum', () => {
    expect(mapReviewProperties(reviewFixture)).toEqual({
      state: 'APPROVED',
      'author.login': 'review-bot',
      body: 'Looks good overall.',
      submitted_at: '2026-03-28T07:30:00Z',
    });
  });

  it('mapIssueProperties handles multiple labels', () => {
    expect(mapIssueProperties(issueFixture)).toEqual({
      title: 'Sync issue semantics',
      state: 'open',
      'author.login': 'triager',
      labels: 'bug,priority:high,backend',
      created_at: '2026-03-20T09:00:00Z',
      assignees: 'maintainer-1,maintainer-2',
    });
  });
});

describe('relation mappers', () => {
  it('mapPRRelations builds correct VFS paths', () => {
    expect(mapPRRelations('acme', 'widgets', 42)).toEqual([
      '/github/repos/acme/widgets/',
      '/github/repos/acme/widgets/pulls/42/commits/',
      '/github/repos/acme/widgets/pulls/42/reviews/',
      '/github/repos/acme/widgets/pulls/42/checks/',
    ]);
  });

  it('mapCommitRelations links to parent commits', () => {
    expect(
      mapCommitRelations('acme', 'widgets', 42, commitFixture.sha, [
        ...commitFixture.parents,
        { sha: '1111111111111111111111111111111111111111' },
        { sha: '   ' },
        null,
      ]),
    ).toEqual([
      '/github/repos/acme/widgets/pulls/42/meta.json',
      '/github/repos/acme/widgets/pulls/42/commits/1111111111111111111111111111111111111111.json',
      '/github/repos/acme/widgets/pulls/42/commits/2222222222222222222222222222222222222222.json',
    ]);
  });

  it('mapReviewRelations links to PR and comments', () => {
    expect(mapReviewRelations('acme', 'widgets', 42, reviewFixture.id)).toEqual([
      '/github/repos/acme/widgets/pulls/42/meta.json',
      '/github/repos/acme/widgets/pulls/42/reviews/77/comments/',
    ]);
  });

  it('All relations use absolute VFS paths', () => {
    const relations = [
      ...mapPRRelations('acme org', 'widgets/api', 42),
      ...mapCommitRelations('acme org', 'widgets/api', 42, commitFixture.sha, commitFixture.parents),
      ...mapReviewRelations('acme org', 'widgets/api', 42, reviewFixture.id),
      ...mapIssueRelations('acme org', 'widgets/api', issueFixture.number),
    ];

    expect(relations.length).toBeGreaterThan(0);

    for (const relation of relations) {
      expect(relation.startsWith('/')).toBe(true);
      expect(relation).toMatch(/^\/github\/repos\//);
      expect(relation).toContain('/acme%20org/widgets%2Fapi/');
    }
  });
});
