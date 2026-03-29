/**
 * 038-review-status-checks.ts
 *
 * Update GitHub commit status and check runs from review results.
 * Reports review progress and outcomes as GitHub status checks.
 *
 * Run: agent-relay run workflows/038-review-status-checks.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('review-status-checks')
  .description('Update GitHub commit status and check runs from review results')
  .pattern('dag')
  .channel('wf-relayfile-review-status-checks')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans status check reporting' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements status checks' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews status check code' })

  .step('plan-status', {
    agent: 'architect',
    task: `Read ${SPEC} sections 6 and 8, focusing on check runs mapping.

Plan GitHub status check reporting from review results:
- On review start: create check run with status 'in_progress'
- On review complete: update check run with conclusion (success/failure/neutral)
- Status reporter maps review findings to check run output
- Check run output includes: title, summary, annotations (line-level)
- Annotations map to findings: path, start_line, end_line, annotation_level, message
- Also update commit status API for simpler integrations
- Handle GitHub App vs OAuth token differences for check run creation

Define status-reporter and check-creator modules.
Keep output under 50 lines. End with PLAN_STATUS_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_STATUS_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-status-reporter', {
    agent: 'builder',
    dependsOn: ['plan-status'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/status-reporter.ts.

Based on: {{steps.plan-status.output}}

Export interface ReviewStatus { state: 'pending'|'success'|'failure'|'error'; description: string; targetUrl?: string }
Export interface CheckAnnotation { path: string; start_line: number; end_line: number; annotation_level: 'notice'|'warning'|'failure'; message: string; title: string }

Export function buildCommitStatus(pipelineState, findingsCount):
- Map pipeline state to GitHub commit status state
- pending/in_progress -> 'pending'
- cleanup_done with 0 critical -> 'success'
- cleanup_done with critical findings -> 'failure'
- failed -> 'error'
- Return ReviewStatus

Export function buildCheckAnnotations(agentResults):
- Convert agent findings to GitHub check run annotations
- Map severity: critical -> 'failure', warning -> 'warning', info -> 'notice'
- Return CheckAnnotation[] (max 50 per API call)

Export async function updateCommitStatus(provider, owner, repo, sha, status, connectionId):
- POST /repos/{owner}/{repo}/statuses/{sha}
- Body: { state, description, target_url, context: 'relayfile-review' }
- Return void`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-check-creator', {
    agent: 'builder',
    dependsOn: ['write-status-reporter'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/check-creator.ts.

Export interface CheckRunParams { name: string; head_sha: string; status: 'queued'|'in_progress'|'completed'; conclusion?: 'success'|'failure'|'neutral'|'action_required'; output?: CheckRunOutput }
Export interface CheckRunOutput { title: string; summary: string; annotations?: CheckAnnotation[] }

Export async function createCheckRun(provider, owner, repo, headSha, connectionId):
- POST /repos/{owner}/{repo}/check-runs
- Body: { name: 'Relayfile Review', head_sha, status: 'in_progress', started_at }
- Return checkRunId

Export async function completeCheckRun(provider, owner, repo, checkRunId, agentResults, connectionId):
- Build annotations from agent results (via status-reporter)
- Determine conclusion based on findings severity
- Build summary with findings count by severity
- PATCH /repos/{owner}/{repo}/check-runs/{checkRunId}
- Body: { status: 'completed', conclusion, completed_at, output }
- Batch annotations in groups of 50 (GitHub API limit)
- Return { checkRunId, conclusion, annotationCount }

Export async function cancelCheckRun(provider, owner, repo, checkRunId, reason, connectionId):
- PATCH check run to completed with conclusion 'cancelled'
- Include reason in output summary`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-check-creator'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/__tests__/status-checks.test.ts.

Tests using vitest:
- buildCommitStatus returns success for clean review
- buildCommitStatus returns failure for critical findings
- buildCheckAnnotations maps severity to annotation_level
- buildCheckAnnotations caps at 50 annotations
- updateCommitStatus calls correct GitHub status API
- createCheckRun posts to check-runs endpoint
- completeCheckRun sets conclusion based on findings
- cancelCheckRun marks check as cancelled with reason

Mock provider.proxy() responses.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/review/status-reporter.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/check-creator.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/__tests__/status-checks.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review status checks at ${GITHUB_ADAPTER_REPO}/src/review/:
- status-reporter.ts, check-creator.ts, __tests__/status-checks.test.ts

Verify:
- Commit status states map correctly from pipeline states
- Check run annotations follow GitHub API format
- Annotation batching respects 50-item limit
- Check run lifecycle: create -> in_progress -> completed
- Both commit status and check run APIs are supported
- Tests cover success, failure, cancellation, and annotation batching

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Status checks:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
