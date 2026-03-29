const MOCK_OWNER = 'octocat';
const MOCK_REPO = 'hello-world';
const BASE_SHA = '1111111111111111111111111111111111111111';
const COMMIT_ONE_SHA = '3333333333333333333333333333333333333333';
const HEAD_SHA = '2222222222222222222222222222222222222222';

const baseIndexContent = `export function greet(name) {
  return \`Hi, \${name}.\`;
}
`;

const headIndexContent = `export function greet(name) {
  return \`Hello, \${name}!\`;
}
`;

const baseMathContent = `export function sum(a, b) {
  return a - b;
}
`;

const headMathContent = `export function sum(a, b) {
  return a + b;
}
`;

const baseReadmeContent = `# Hello World

Simple example repository.
`;

const headReadmeContent = `# Hello World

This repository demonstrates the GitHub adapter test fixtures.
`;

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

export const mockPRPayload = {
  url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/pulls/42`,
  id: 90042,
  node_id: 'PR_kwDOAAABc84mKg',
  html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/pull/42`,
  diff_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/pull/42.diff`,
  patch_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/pull/42.patch`,
  issue_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/issues/42`,
  number: 42,
  state: 'open',
  locked: false,
  title: 'Add fixture-backed GitHub adapter coverage',
  user: {
    login: 'octocat',
    id: 1,
    node_id: 'MDQ6VXNlcjE=',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    html_url: 'https://github.com/octocat',
    type: 'User',
    site_admin: false,
  },
  body: 'This PR updates greeting logic, fixes math output, and refreshes the README.',
  created_at: '2026-03-27T14:15:22Z',
  updated_at: '2026-03-28T08:32:10Z',
  closed_at: null,
  merged_at: null,
  merge_commit_sha: null,
  assignees: [
    {
      login: 'monalisa',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      html_url: 'https://github.com/monalisa',
      type: 'User',
      site_admin: false,
    },
  ],
  requested_reviewers: [],
  labels: [
    {
      id: 101,
      node_id: 'LA_kwDOAAABc84mKg',
      url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/labels/enhancement`,
      name: 'enhancement',
      color: 'a2eeef',
      default: true,
      description: 'New feature or request',
    },
    {
      id: 102,
      node_id: 'LA_kwDOAAABc84mKw',
      url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/labels/adapter`,
      name: 'adapter',
      color: '1d76db',
      default: false,
      description: 'Adapter-specific work',
    },
  ],
  draft: false,
  commits: 2,
  additions: 11,
  deletions: 3,
  changed_files: 3,
  review_comments: 2,
  comments: 2,
  maintainer_can_modify: true,
  head: {
    label: `${MOCK_OWNER}:feature/fixture-e2e`,
    ref: 'feature/fixture-e2e',
    sha: HEAD_SHA,
    user: {
      login: 'octocat',
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
      site_admin: false,
    },
    repo: {
      id: 2001,
      node_id: 'R_kgDOAAABc8',
      name: MOCK_REPO,
      full_name: `${MOCK_OWNER}/${MOCK_REPO}`,
      private: false,
      owner: {
        login: MOCK_OWNER,
        id: 1,
        node_id: 'MDQ6VXNlcjE=',
        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        html_url: 'https://github.com/octocat',
        type: 'User',
        site_admin: false,
      },
      default_branch: 'main',
    },
  },
  base: {
    label: `${MOCK_OWNER}:main`,
    ref: 'main',
    sha: BASE_SHA,
    user: {
      login: MOCK_OWNER,
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
      site_admin: false,
    },
    repo: {
      id: 2001,
      node_id: 'R_kgDOAAABc8',
      name: MOCK_REPO,
      full_name: `${MOCK_OWNER}/${MOCK_REPO}`,
      private: false,
      owner: {
        login: MOCK_OWNER,
        id: 1,
        node_id: 'MDQ6VXNlcjE=',
        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        html_url: 'https://github.com/octocat',
        type: 'User',
        site_admin: false,
      },
      default_branch: 'main',
    },
  },
} as const;

export const mockPRFiles = [
  {
    sha: '5555555555555555555555555555555555555555',
    filename: 'src/index.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    blob_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/blob/${HEAD_SHA}/src/index.ts`,
    raw_url: `https://raw.githubusercontent.com/${MOCK_OWNER}/${MOCK_REPO}/${HEAD_SHA}/src/index.ts`,
    contents_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/contents/src/index.ts?ref=${HEAD_SHA}`,
    patch: '@@ -1,3 +1,3 @@\n export function greet(name) {\n-  return `Hi, ${name}.`;\n+  return `Hello, ${name}!`;\n }\n',
  },
  {
    sha: '6666666666666666666666666666666666666666',
    filename: 'src/utils/math.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    blob_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/blob/${HEAD_SHA}/src/utils/math.ts`,
    raw_url: `https://raw.githubusercontent.com/${MOCK_OWNER}/${MOCK_REPO}/${HEAD_SHA}/src/utils/math.ts`,
    contents_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/contents/src/utils/math.ts?ref=${HEAD_SHA}`,
    patch: '@@ -1,3 +1,3 @@\n export function sum(a, b) {\n-  return a - b;\n+  return a + b;\n }\n',
  },
  {
    sha: '7777777777777777777777777777777777777777',
    filename: 'README.md',
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    blob_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/blob/${HEAD_SHA}/README.md`,
    raw_url: `https://raw.githubusercontent.com/${MOCK_OWNER}/${MOCK_REPO}/${HEAD_SHA}/README.md`,
    contents_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/contents/README.md?ref=${HEAD_SHA}`,
    patch:
      '@@ -1,3 +1,3 @@\n # Hello World\n \n-Simple example repository.\n+This repository demonstrates the GitHub adapter test fixtures.\n',
  },
] as const;

export const mockIssuePayload = {
  url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/issues/10`,
  repository_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}`,
  labels_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/issues/10/labels{/name}`,
  comments_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/issues/10/comments`,
  html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/issues/10`,
  id: 8010,
  node_id: 'I_kwDOAAABc84mKg',
  number: 10,
  title: 'Track adapter issue ingestion coverage',
  user: {
    login: 'hubot',
    id: 3,
    node_id: 'MDQ6VXNlcjM=',
    avatar_url: 'https://avatars.githubusercontent.com/u/3?v=4',
    html_url: 'https://github.com/hubot',
    type: 'Bot',
    site_admin: false,
  },
  labels: [
    {
      id: 201,
      node_id: 'LA_kwDOAAABc84mLQ',
      url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/labels/bug`,
      name: 'bug',
      color: 'd73a4a',
      default: true,
      description: 'Something is not working',
    },
  ],
  state: 'open',
  locked: false,
  assignees: [
    {
      login: 'monalisa',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      html_url: 'https://github.com/monalisa',
      type: 'User',
      site_admin: false,
    },
  ],
  milestone: null,
  comments: 2,
  created_at: '2026-03-25T10:00:00Z',
  updated_at: '2026-03-28T07:45:00Z',
  closed_at: null,
  author_association: 'CONTRIBUTOR',
  body: 'We need E2E coverage for issue ingestion and webhook routing.',
  reactions: {
    url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/issues/10/reactions`,
    total_count: 3,
    '+1': 2,
    '-1': 0,
    laugh: 0,
    hooray: 1,
    confused: 0,
    heart: 0,
    rocket: 0,
    eyes: 0,
  },
} as const;

export const mockIssueComments = [
  {
    id: 7001,
    node_id: 'IC_kwDOAAABc84mKg',
    body: 'I can pick this up after the PR ingestion flow lands.',
    user: {
      login: 'monalisa',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      html_url: 'https://github.com/monalisa',
      type: 'User',
      site_admin: false,
    },
    created_at: '2026-03-26T09:15:00Z',
    updated_at: '2026-03-26T09:15:00Z',
    author_association: 'MEMBER',
    reactions: {
      total_count: 1,
      '+1': 1,
      '-1': 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
  },
  {
    id: 7002,
    node_id: 'IC_kwDOAAABc84mKw',
    body: 'Issue ingest should keep labels and timestamps intact.',
    user: {
      login: 'octocat',
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
      site_admin: false,
    },
    created_at: '2026-03-27T11:20:00Z',
    updated_at: '2026-03-27T11:50:00Z',
    author_association: 'OWNER',
    reactions: {
      total_count: 2,
      '+1': 1,
      '-1': 0,
      laugh: 0,
      hooray: 1,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
  },
] as const;

export const mockCommits = [
  {
    sha: COMMIT_ONE_SHA,
    node_id: 'C_kwDOAAABc84mKg',
    html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/commit/${COMMIT_ONE_SHA}`,
    commit: {
      author: {
        name: 'Mona Lisa',
        email: 'monalisa@example.com',
        date: '2026-03-27T16:00:00Z',
      },
      committer: {
        name: 'Mona Lisa',
        email: 'monalisa@example.com',
        date: '2026-03-27T16:00:00Z',
      },
      message: 'refactor: normalize greeting output',
    },
    author: {
      login: 'monalisa',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      html_url: 'https://github.com/monalisa',
      type: 'User',
      site_admin: false,
    },
    committer: {
      login: 'monalisa',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      html_url: 'https://github.com/monalisa',
      type: 'User',
      site_admin: false,
    },
    parents: [{ sha: BASE_SHA }],
  },
  {
    sha: HEAD_SHA,
    node_id: 'C_kwDOAAABc84mKw',
    html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/commit/${HEAD_SHA}`,
    commit: {
      author: {
        name: 'The Octocat',
        email: 'octocat@example.com',
        date: '2026-03-28T07:30:00Z',
      },
      committer: {
        name: 'The Octocat',
        email: 'octocat@example.com',
        date: '2026-03-28T07:30:00Z',
      },
      message: 'test: add README and math fixture updates',
    },
    author: {
      login: 'octocat',
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
      site_admin: false,
    },
    committer: {
      login: 'octocat',
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
      site_admin: false,
    },
    parents: [{ sha: COMMIT_ONE_SHA }],
  },
] as const;

export const mockReviews = [
  {
    id: 9001,
    node_id: 'PRR_kwDOAAABc84mKg',
    user: {
      login: 'monalisa',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      html_url: 'https://github.com/monalisa',
      type: 'User',
      site_admin: false,
    },
    body: 'Looks good. The fixture coverage is focused and realistic.',
    state: 'APPROVED',
    html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/pull/42#pullrequestreview-9001`,
    pull_request_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/pulls/42`,
    submitted_at: '2026-03-28T08:10:00Z',
    commit_id: HEAD_SHA,
    author_association: 'MEMBER',
  },
] as const;

export const mockReviewComments = [
  {
    id: 9101,
    node_id: 'PRRC_kwDOAAABc84mKg',
    pull_request_review_id: 9001,
    diff_hunk: '@@ -1,3 +1,3 @@\n export function greet(name) {\n-  return `Hi, ${name}.`;\n+  return `Hello, ${name}!`;\n }\n',
    path: 'src/index.ts',
    position: 2,
    original_position: 2,
    line: 2,
    original_line: 2,
    side: 'RIGHT',
    commit_id: HEAD_SHA,
    original_commit_id: COMMIT_ONE_SHA,
    user: {
      login: 'monalisa',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      html_url: 'https://github.com/monalisa',
      type: 'User',
      site_admin: false,
    },
    body: 'Nice improvement. This wording is clearer.',
    created_at: '2026-03-28T08:11:00Z',
    updated_at: '2026-03-28T08:11:00Z',
    html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/pull/42#discussion_r9101`,
    pull_request_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/pulls/42`,
    author_association: 'MEMBER',
  },
  {
    id: 9102,
    node_id: 'PRRC_kwDOAAABc84mKw',
    pull_request_review_id: 9001,
    diff_hunk: '@@ -1,3 +1,3 @@\n export function sum(a, b) {\n-  return a - b;\n+  return a + b;\n }\n',
    path: 'src/utils/math.ts',
    position: 2,
    original_position: 2,
    line: 2,
    original_line: 2,
    side: 'RIGHT',
    commit_id: HEAD_SHA,
    original_commit_id: COMMIT_ONE_SHA,
    user: {
      login: 'monalisa',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      html_url: 'https://github.com/monalisa',
      type: 'User',
      site_admin: false,
    },
    body: 'Good catch. This now matches the intended behavior.',
    created_at: '2026-03-28T08:12:00Z',
    updated_at: '2026-03-28T08:12:00Z',
    html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/pull/42#discussion_r9102`,
    pull_request_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/pulls/42`,
    author_association: 'MEMBER',
  },
] as const;

export const mockCheckRuns = [
  {
    id: 9201,
    name: 'Typecheck',
    head_sha: HEAD_SHA,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-03-28T08:00:00Z',
    completed_at: '2026-03-28T08:04:30Z',
    html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/actions/runs/9201`,
    details_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/check-runs/9201`,
    output: {
      title: 'Typecheck passed',
      summary: 'No TypeScript errors were found.',
      text: '',
    },
  },
  {
    id: 9202,
    name: 'Unit Tests',
    head_sha: HEAD_SHA,
    status: 'completed',
    conclusion: 'failure',
    started_at: '2026-03-28T08:05:00Z',
    completed_at: '2026-03-28T08:09:45Z',
    html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}/actions/runs/9202`,
    details_url: `https://api.github.com/repos/${MOCK_OWNER}/${MOCK_REPO}/check-runs/9202`,
    output: {
      title: 'Unit tests failed',
      summary: 'Two assertions failed in the GitHub adapter fixture suite.',
      text: 'Expected diff.patch to be non-empty.',
    },
  },
] as const;

export const mockDiff = `diff --git a/src/index.ts b/src/index.ts
index 9daeafb..ab12cd3 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
 export function greet(name) {
-  return \`Hi, \${name}.\`;
+  return \`Hello, \${name}!\`;
 }
diff --git a/src/utils/math.ts b/src/utils/math.ts
index 7fd2abc..1bc34de 100644
--- a/src/utils/math.ts
+++ b/src/utils/math.ts
@@ -1,3 +1,3 @@
 export function sum(a, b) {
-  return a - b;
+  return a + b;
 }
diff --git a/README.md b/README.md
index 3ac45de..4bd56ef 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
 # Hello World
 
-Simple example repository.
+This repository demonstrates the GitHub adapter test fixtures.
`;

export const mockFileContents: Record<string, string> = {
  'src/index.ts': encode(headIndexContent),
  'src/utils/math.ts': encode(headMathContent),
  'README.md': encode(headReadmeContent),
};

export const mockBaseFileContents: Record<string, string> = {
  'src/index.ts': encode(baseIndexContent),
  'src/utils/math.ts': encode(baseMathContent),
  'README.md': encode(baseReadmeContent),
};

export const mockWebhookHeaders = {
  'x-github-event': 'pull_request',
} as const;

export const mockWebhookPayload = {
  action: 'opened',
  number: 42,
  pull_request: mockPRPayload,
  repository: {
    id: 2001,
    node_id: 'R_kgDOAAABc8',
    name: MOCK_REPO,
    full_name: `${MOCK_OWNER}/${MOCK_REPO}`,
    private: false,
    html_url: `https://github.com/${MOCK_OWNER}/${MOCK_REPO}`,
    owner: {
      login: MOCK_OWNER,
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      html_url: 'https://github.com/octocat',
      type: 'User',
      site_admin: false,
    },
    default_branch: 'main',
  },
  sender: {
    login: 'octocat',
    id: 1,
    node_id: 'MDQ6VXNlcjE=',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    html_url: 'https://github.com/octocat',
    type: 'User',
    site_admin: false,
  },
  installation: {
    id: 123456,
    node_id: 'MDQ6QXBwSW5zdGFsbGF0aW9uMTIzNDU2',
  },
} as const;

export const mockRepoContext = {
  owner: MOCK_OWNER,
  repo: MOCK_REPO,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
} as const;
