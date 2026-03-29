/**
 * 027-github-webhook-router.ts
 *
 * Route webhook events to the correct ingest method on GitHubAdapter.
 * Maps GitHub webhook event types to adapter ingestion functions.
 *
 * Run: agent-relay run workflows/027-github-webhook-router.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-webhook-router')
  .description('Route GitHub webhook events to correct adapter ingest methods')
  .pattern('dag')
  .channel('wf-relayfile-github-webhook-router')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans webhook routing strategy' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements webhook router' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews webhook router code' })

  .step('plan-router', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/index.ts.

Plan the webhook event router:
- Supported events from spec:
  - pull_request.opened → full PR ingest
  - pull_request.synchronize → update PR files/commits
  - pull_request.closed → update PR state, mark archived
  - pull_request_review.submitted → ingest review
  - pull_request_review_comment.created → ingest comment
  - push → update commits
  - issues.opened → full issue ingest
  - issues.closed → update issue state
  - check_run.completed → ingest check run
- Event map: { 'event.action': handlerFunction }
- Extract owner/repo/number from webhook payload
- Return IngestResult from handler

Define event map and router modules.
Keep output under 50 lines. End with PLAN_ROUTER_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_ROUTER_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-event-map', {
    agent: 'builder',
    dependsOn: ['plan-router'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/webhook/event-map.ts.

Based on: {{steps.plan-router.output}}

Export type WebhookHandler = (adapter, payload) => Promise<IngestResult>

Export const EVENT_MAP: Record<string, WebhookHandler> with entries:
- 'pull_request.opened': calls adapter.ingestPullRequest
- 'pull_request.synchronize': calls adapter.updatePullRequest
- 'pull_request.closed': calls adapter.closePullRequest
- 'pull_request_review.submitted': calls adapter.ingestReview
- 'pull_request_review_comment.created': calls adapter.ingestReviewComment
- 'push': calls adapter.ingestPushCommits
- 'issues.opened': calls adapter.ingestIssue
- 'issues.closed': calls adapter.closeIssue
- 'check_run.completed': calls adapter.ingestCheckRun

Export function extractEventKey(headers, payload): string
- Combine X-GitHub-Event header with payload.action
- Return 'event.action' string

Export function extractRepoInfo(payload): { owner, repo, number? }
- Parse from payload.repository and payload.pull_request or payload.issue`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-router', {
    agent: 'builder',
    dependsOn: ['write-event-map'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/webhook/router.ts.

Export class WebhookRouter:
- constructor(adapter: GitHubAdapter)
- async route(headers, payload): Promise<IngestResult>
  - Extract event key via extractEventKey
  - Look up handler in EVENT_MAP
  - If no handler, return { filesWritten: 0, errors: ['unsupported event'] }
  - Extract repo info
  - Call handler with adapter and payload
  - Return IngestResult
- isSupported(eventKey): boolean
- getSupportedEvents(): string[]

Export function createRouter(adapter): WebhookRouter

Wire this into GitHubAdapter.routeWebhook method.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-router'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/webhook/__tests__/webhook-router.test.ts.

Tests using vitest:
- extractEventKey combines event and action correctly
- extractRepoInfo parses PR payload
- extractRepoInfo parses issue payload
- WebhookRouter.route calls correct handler for PR opened
- WebhookRouter.route calls correct handler for issue opened
- WebhookRouter.route calls correct handler for check_run completed
- WebhookRouter.route returns error for unsupported event
- WebhookRouter.isSupported returns true for known events
- WebhookRouter.getSupportedEvents lists all 9 events

Mock adapter methods to verify correct routing.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/webhook/event-map.ts && test -f ${GITHUB_ADAPTER_REPO}/src/webhook/router.ts && test -f ${GITHUB_ADAPTER_REPO}/src/webhook/__tests__/webhook-router.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review webhook router at ${GITHUB_ADAPTER_REPO}/src/webhook/:
- event-map.ts, router.ts, __tests__/webhook-router.test.ts

Verify:
- All 9 supported events from spec are mapped
- Event key extraction handles edge cases
- Repo info extraction works for all payload types
- Unsupported events are handled gracefully
- Router is properly wired to GitHubAdapter
- Tests cover all event types

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Webhook router:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
