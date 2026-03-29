/**
 * 026-github-issue-mapping.ts
 *
 * Issues + issue comments mapping to relayfile VFS.
 * Maps to /github/repos/{owner}/{repo}/issues/{number}/ layout.
 *
 * Run: agent-relay run workflows/026-github-issue-mapping.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-issue-mapping')
  .description('Map GitHub issues and issue comments to relayfile VFS')
  .pattern('dag')
  .channel('wf-relayfile-github-issue-mapping')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans issue mapping pipeline' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements issue mapping' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews issue mapping code' })

  .step('plan-issues', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/types.ts.

Plan issue mapping:
- Fetch issue via GET /repos/{owner}/{repo}/issues/{number}
- Write meta.json to /github/repos/{owner}/{repo}/issues/{number}/meta.json
- Issue JSON: number, title, state, body, author, labels, assignees, milestone, created_at, updated_at, closed_at
- Fetch comments via GET /repos/{owner}/{repo}/issues/{number}/comments
- Write each to /issues/{number}/comments/{comment_id}.json
- Comment JSON: id, body, author, created_at, updated_at, reactions
- Handle issues.opened and issues.closed events

Define issue fetcher, mapper, and comment mapper modules.
Keep output under 50 lines. End with PLAN_ISSUES_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_ISSUES_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-issue-fetcher', {
    agent: 'builder',
    dependsOn: ['plan-issues'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/issues/fetcher.ts.

Based on: {{steps.plan-issues.output}}

Export async function fetchIssue(provider, owner, repo, number):
- Call provider.proxy() GET /repos/{owner}/{repo}/issues/{number}
- Return raw issue object

Export async function fetchIssueComments(provider, owner, repo, number):
- Call provider.proxy() GET /repos/{owner}/{repo}/issues/{number}/comments
- Handle pagination (per_page=100, follow Link header)
- Return array of raw comment objects

Export function isActualIssue(issue):
- GitHub returns PRs in issue endpoints; filter by !issue.pull_request`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-issue-mapper', {
    agent: 'builder',
    dependsOn: ['write-issue-fetcher'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/issues/issue-mapper.ts.

Export function mapIssue(issue, owner, repo):
- Transform to: { number, title, state, body, author: { login, avatarUrl }, labels: string[], assignees: string[], milestone, created_at, updated_at, closed_at, html_url }
- Return { vfsPath: 'issues/{number}/meta.json', content: JSON }

Export async function ingestIssue(provider, owner, repo, number, vfs):
- Fetch issue and verify it's not a PR
- Map through mapIssue
- Write meta.json to VFS
- Ingest comments via ingestIssueComments
- Return IngestResult with all written files`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-comment-mapper', {
    agent: 'builder',
    dependsOn: ['write-issue-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/issues/comment-mapper.ts.

Export function mapIssueComment(comment, owner, repo, issueNumber):
- Transform to: { id, body, author: { login, avatarUrl }, created_at, updated_at, reactions: { total_count, '+1', '-1', laugh, etc } }
- Return { vfsPath: 'issues/{number}/comments/{comment_id}.json', content: JSON }

Export async function ingestIssueComments(provider, owner, repo, number, vfs):
- Fetch all comments with pagination
- Map each through mapIssueComment
- Write to VFS
- Return IngestResult`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-comment-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/issues/__tests__/issue-mapping.test.ts.

Tests using vitest:
- fetchIssue returns issue data
- isActualIssue filters out PRs
- mapIssue produces correct JSON shape
- mapIssue handles missing optional fields (milestone, closed_at)
- fetchIssueComments handles pagination
- mapIssueComment preserves reactions
- ingestIssue writes meta.json and comments
- ingestIssueComments writes all comment files
- VFS paths are correct

Mock provider.proxy() with fixture data.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/issues/fetcher.ts && test -f ${GITHUB_ADAPTER_REPO}/src/issues/issue-mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/issues/comment-mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/issues/__tests__/issue-mapping.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review issue mapping at ${GITHUB_ADAPTER_REPO}/src/issues/:
- fetcher.ts, issue-mapper.ts, comment-mapper.ts, __tests__/issue-mapping.test.ts

Verify:
- Correct GitHub API endpoints for issues
- PR filtering via pull_request field
- VFS paths: /issues/{number}/meta.json, /issues/{number}/comments/{id}.json
- Pagination handling
- Tests cover happy path and edge cases

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Issue mapping:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
