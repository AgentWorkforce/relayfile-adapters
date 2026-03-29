/**
 * 024-github-review-mapping.ts
 *
 * PR reviews + review comments mapping to relayfile VFS.
 * Maps to /pulls/{n}/reviews/{review_id}.json and comments/{comment_id}.json.
 *
 * Run: agent-relay run workflows/024-github-review-mapping.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-review-mapping')
  .description('Map GitHub PR reviews and review comments to relayfile VFS')
  .pattern('dag')
  .channel('wf-relayfile-github-review-mapping')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans review mapping pipeline' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements review mapping' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews the review mapping code' })

  .step('plan-reviews', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/types.ts.

Plan review mapping:
- Fetch reviews via GET /repos/{owner}/{repo}/pulls/{number}/reviews
- Write each to /pulls/{number}/reviews/{review_id}.json
- Review JSON: id, state, body, author, submitted_at, commit_id
- Fetch review comments via GET /repos/{owner}/{repo}/pulls/{number}/comments
- Write each to /pulls/{number}/comments/{comment_id}.json
- Comment JSON: id, body, path, line, side, author, created_at, in_reply_to_id
- Link comments to their parent review

Define fetcher, review mapper, and comment mapper modules.
Keep output under 50 lines. End with PLAN_REVIEWS_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_REVIEWS_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-review-fetcher', {
    agent: 'builder',
    dependsOn: ['plan-reviews'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/reviews/fetcher.ts.

Based on: {{steps.plan-reviews.output}}

Export async function fetchReviews(provider, owner, repo, number):
- Call provider.proxy() GET /repos/{owner}/{repo}/pulls/{number}/reviews
- Handle pagination
- Return array of raw review objects

Export async function fetchReviewComments(provider, owner, repo, number):
- Call provider.proxy() GET /repos/{owner}/{repo}/pulls/{number}/comments
- Handle pagination
- Return array of raw comment objects

Export async function fetchSingleReviewComments(provider, owner, repo, number, reviewId):
- GET /repos/{owner}/{repo}/pulls/{number}/reviews/{reviewId}/comments
- Return comments for a specific review`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-review-mapper', {
    agent: 'builder',
    dependsOn: ['write-review-fetcher'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/reviews/review-mapper.ts.

Export function mapReview(review, owner, repo, prNumber):
- Transform to: { id, state, body, author: { login, avatarUrl }, submitted_at, commit_id, htmlUrl }
- Return { vfsPath: 'reviews/{review_id}.json', content: JSON }

Export async function ingestReviews(provider, owner, repo, number, vfs):
- Fetch all reviews
- Map each through mapReview
- Write to VFS
- Return IngestResult with filesWritten and paths`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-comment-mapper', {
    agent: 'builder',
    dependsOn: ['write-review-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/reviews/comment-mapper.ts.

Export function mapReviewComment(comment, owner, repo, prNumber):
- Transform to: { id, body, path, line, side, original_line, author: { login }, created_at, updated_at, in_reply_to_id, review_id, diff_hunk }
- Return { vfsPath: 'comments/{comment_id}.json', content: JSON }

Export async function ingestReviewComments(provider, owner, repo, number, vfs):
- Fetch all review comments
- Map each through mapReviewComment
- Write to VFS
- Return IngestResult`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-comment-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/reviews/__tests__/review-mapping.test.ts.

Tests using vitest:
- fetchReviews returns review list
- mapReview produces correct JSON shape
- mapReview builds correct VFS path
- fetchReviewComments returns comment list
- mapReviewComment includes diff_hunk and line info
- mapReviewComment links to parent review
- ingestReviews writes all review files
- ingestReviewComments writes all comment files

Mock provider.proxy() with fixture data.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/reviews/fetcher.ts && test -f ${GITHUB_ADAPTER_REPO}/src/reviews/review-mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/reviews/comment-mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/reviews/__tests__/review-mapping.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review review mapping at ${GITHUB_ADAPTER_REPO}/src/reviews/:
- fetcher.ts, review-mapper.ts, comment-mapper.ts, __tests__/review-mapping.test.ts

Verify:
- Correct GitHub API endpoints for reviews and comments
- VFS paths: reviews/{review_id}.json, comments/{comment_id}.json
- Comment-to-review linking is preserved
- Line-level comment data (path, line, side) is mapped
- Tests cover all mappers

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Review mapping:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
