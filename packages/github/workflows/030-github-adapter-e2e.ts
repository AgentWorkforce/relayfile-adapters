/**
 * 030-github-adapter-e2e.ts
 *
 * Full adapter E2E test covering PR ingestion, issue ingestion,
 * and webhook routing with mock provider fixtures.
 *
 * Run: agent-relay run workflows/030-github-adapter-e2e.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-adapter-e2e')
  .description('Full GitHubAdapter E2E test: PR ingest, issue ingest, webhook routing')
  .pattern('dag')
  .channel('wf-relayfile-github-adapter-e2e')
  .maxConcurrency(5)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans E2E test scenarios' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements E2E tests' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews E2E test coverage' })

  .step('plan-e2e', {
    agent: 'architect',
    task: `Read ${SPEC} and all adapter modules at ${GITHUB_ADAPTER_REPO}/src/.

Plan E2E test scenarios:
1. PR Ingest E2E: mock provider → ingestPullRequest → verify VFS has meta.json, diff.patch, files/, base/, commits/, reviews/, comments/, checks/
2. Issue Ingest E2E: mock provider → ingestIssue → verify VFS has issues/{n}/meta.json, comments/
3. Webhook Route E2E: simulate each of the 9 webhook events → verify correct handler called and VFS updated
4. Bulk Ingest E2E: mock PR with 20 files → bulk ingest → verify all files written
5. Error Handling E2E: simulate API failures → verify graceful degradation

Define fixture data structure and test file organization.
Keep output under 50 lines. End with PLAN_E2E_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_E2E_COMPLETE' },
    timeout: 120_000,
  })

  .step('setup-fixtures', {
    agent: 'builder',
    dependsOn: ['plan-e2e'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/fixtures/ files.

Based on: {{steps.plan-e2e.output}}

Create ${GITHUB_ADAPTER_REPO}/src/__tests__/fixtures/index.ts exporting:
- mockPRPayload: realistic GitHub PR API response (PR #42, 3 files changed)
- mockIssuePayload: realistic GitHub issue API response (issue #10)
- mockCommits: array of 2 commit objects
- mockReviews: array with 1 approved review
- mockReviewComments: array with 2 line comments
- mockCheckRuns: array with 2 check runs (1 success, 1 failure)
- mockDiff: unified diff string for 3 files
- mockFileContents: map of path → base64 content
- mockWebhookHeaders: { 'x-github-event': 'pull_request' }
- mockWebhookPayload: PR opened webhook payload

Create ${GITHUB_ADAPTER_REPO}/src/__tests__/fixtures/mock-provider.ts:
- Export createMockProvider() returning a mock ConnectionProvider
- Mock proxy() to return fixture data based on endpoint pattern matching`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('test-pr-ingest', {
    agent: 'builder',
    dependsOn: ['setup-fixtures'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e-pr-ingest.test.ts.

Full E2E test for PR ingestion:
- Create GitHubAdapter with mock provider
- Call adapter.ingestPullRequest('octocat', 'hello-world', 42)
- Verify IngestResult: filesWritten > 0, no errors
- Verify VFS contains:
  - /github/repos/octocat/hello-world/pulls/42/meta.json (valid JSON with title, state)
  - /github/repos/octocat/hello-world/pulls/42/diff.patch (non-empty)
  - /github/repos/octocat/hello-world/pulls/42/files/ (3 files)
  - /github/repos/octocat/hello-world/pulls/42/base/ (base versions)
  - /github/repos/octocat/hello-world/pulls/42/commits/ (2 commit JSONs)
  - /github/repos/octocat/hello-world/pulls/42/reviews/ (1 review JSON)
  - /github/repos/octocat/hello-world/pulls/42/comments/ (2 comment JSONs)
  - /github/repos/octocat/hello-world/pulls/42/checks/ (2 check JSONs + _summary.json)
- Verify all JSON files parse without error
- Verify FileSemantics are attached to meta.json`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('test-issue-ingest', {
    agent: 'builder',
    dependsOn: ['setup-fixtures'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e-issue-ingest.test.ts.

Full E2E test for issue ingestion:
- Create GitHubAdapter with mock provider
- Call adapter.ingestIssue('octocat', 'hello-world', 10)
- Verify IngestResult: filesWritten > 0, no errors
- Verify VFS contains:
  - /github/repos/octocat/hello-world/issues/10/meta.json (title, state, body, labels)
  - /github/repos/octocat/hello-world/issues/10/comments/ (comment JSONs)
- Verify issue is not confused with a PR
- Test with issues.opened webhook payload
- Test with issues.closed webhook payload (state updated)`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('test-webhook-route', {
    agent: 'builder',
    dependsOn: ['setup-fixtures'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e-webhook-route.test.ts.

Full E2E test for webhook routing:
- Create GitHubAdapter with mock provider + WebhookRouter
- Test each supported event:
  - pull_request.opened → calls ingestPullRequest
  - pull_request.synchronize → calls updatePullRequest
  - pull_request.closed → calls closePullRequest
  - pull_request_review.submitted → calls ingestReview
  - pull_request_review_comment.created → calls ingestReviewComment
  - push → calls ingestPushCommits
  - issues.opened → calls ingestIssue
  - issues.closed → calls closeIssue
  - check_run.completed → calls ingestCheckRun
- Test unsupported event returns error IngestResult
- Test malformed payload handling
- Verify each handler receives correct owner/repo/number`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['test-pr-ingest', 'test-issue-ingest', 'test-webhook-route'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/fixtures/index.ts && test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/fixtures/mock-provider.ts && test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e-pr-ingest.test.ts && test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e-issue-ingest.test.ts && test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e-webhook-route.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review E2E tests at ${GITHUB_ADAPTER_REPO}/src/__tests__/:
- fixtures/index.ts, fixtures/mock-provider.ts
- e2e-pr-ingest.test.ts, e2e-issue-ingest.test.ts, e2e-webhook-route.test.ts

Verify:
- Fixtures are realistic GitHub API responses
- Mock provider covers all needed endpoints
- PR E2E verifies complete VFS layout from spec
- Issue E2E covers open and close flows
- Webhook E2E covers all 9 supported events
- Error cases are tested
- Tests are independent and don't share state

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Adapter E2E:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
