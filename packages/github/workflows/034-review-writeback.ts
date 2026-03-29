/**
 * 034-review-writeback.ts
 *
 * Write review comments back to GitHub via the adapter's writeBack() method.
 * Formats agent results into GitHub PR review comments.
 *
 * Run: agent-relay run workflows/034-review-writeback.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('review-writeback')
  .description('Write review comments back to GitHub via writeBack() method')
  .pattern('dag')
  .channel('wf-relayfile-review-writeback')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans writeback pipeline' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements writeback' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews writeback code' })

  .step('plan-writeback', {
    agent: 'architect',
    task: `Read ${SPEC} sections 5 and 8, focusing on writeBack() method.

Plan review writeback to GitHub:
- Agent results are written to workspace as review JSON files
- Comment formatter converts agent output to GitHub review format
- API writer calls writeBack() to post comments via provider.proxy()
- GitHub API: POST /repos/{owner}/{repo}/pulls/{number}/reviews
  with event: 'COMMENT', body, and comments array
- Each comment: { path, position/line, body }
- Batch comments into a single review submission
- Handle rate limits and API errors gracefully

Define comment-formatter and api-writer modules.
Keep output under 50 lines. End with PLAN_WRITEBACK_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_WRITEBACK_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-comment-formatter', {
    agent: 'builder',
    dependsOn: ['plan-writeback'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/comment-formatter.ts.

Based on: {{steps.plan-writeback.output}}

Export interface FormattedComment { path: string; line: number; side: 'RIGHT'|'LEFT'; body: string }
Export interface FormattedReview { event: 'COMMENT'|'APPROVE'|'REQUEST_CHANGES'; body: string; comments: FormattedComment[] }

Export function formatAgentResult(agentResult):
- Parse agent output into structured findings
- Each finding becomes a FormattedComment with file path, line, body
- Return FormattedComment[]

Export function buildReviewBody(agentResults, prMetadata):
- Aggregate all agent results into a summary body
- Group findings by severity (critical, warning, info)
- Return string

Export function buildReviewSubmission(agentResults, prMetadata):
- Combine formatted comments and review body
- Determine event type based on findings severity
- Return FormattedReview`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-api-writer', {
    agent: 'builder',
    dependsOn: ['write-comment-formatter'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/api-writer.ts.

Export async function submitReview(provider, owner, repo, prNumber, review, connectionId):
- Call provider.proxy() POST /repos/{owner}/{repo}/pulls/{prNumber}/reviews
- Body: { event: review.event, body: review.body, comments: review.comments }
- Handle 422 errors (stale diff) by retrying without line positions
- Return { submitted: boolean, reviewId: number, errors: string[] }

Export async function writeBackResults(adapter, workspaceId, agentResults, prMetadata):
- Format results using comment-formatter
- Write review JSON to workspace via adapter.writeBack()
- Submit to GitHub via submitReview
- Return { submitted: boolean, commentCount: number, errors: string[] }

Export async function submitSingleComment(provider, owner, repo, prNumber, comment, connectionId):
- POST /repos/{owner}/{repo}/pulls/{prNumber}/comments
- For individual inline comments outside a review
- Return comment ID`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-api-writer'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/__tests__/review-writeback.test.ts.

Tests using vitest:
- formatAgentResult extracts findings with path and line
- buildReviewBody groups findings by severity
- buildReviewSubmission sets event to REQUEST_CHANGES for critical findings
- submitReview calls correct GitHub API endpoint
- submitReview retries on 422 stale diff error
- writeBackResults formats and submits all agent results
- submitSingleComment posts inline comment
- writeBackResults handles empty agent results gracefully

Mock provider.proxy() and adapter.writeBack().`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/review/comment-formatter.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/api-writer.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/__tests__/review-writeback.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review writeback at ${GITHUB_ADAPTER_REPO}/src/review/:
- comment-formatter.ts, api-writer.ts, __tests__/review-writeback.test.ts

Verify:
- GitHub review API format is correct (event, body, comments)
- Comment positions map to correct diff lines
- 422 stale diff handling is robust
- Rate limit handling exists
- Review body aggregates findings clearly
- Tests cover formatting, submission, and error cases

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Review writeback:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
