/**
 * 025-github-check-runs.ts
 *
 * CI check run mapping to checks/{check_id}.json in the relayfile VFS.
 * Fetches check runs for a PR's head SHA and maps to structured JSON.
 *
 * Run: agent-relay run workflows/025-github-check-runs.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-check-runs')
  .description('Map GitHub CI check runs to relayfile VFS check JSON files')
  .pattern('dag')
  .channel('wf-relayfile-github-check-runs')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans check run mapping' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements check run mapping' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews check run implementation' })

  .step('plan-checks', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/types.ts.

Plan check run mapping:
- Fetch check runs via GET /repos/{owner}/{repo}/commits/{sha}/check-runs
- Write each to /pulls/{number}/checks/{check_id}.json
- Check JSON: id, name, status, conclusion, started_at, completed_at, output { title, summary, text }, html_url, app { name, slug }
- Handle check_run.completed webhook event
- Aggregate check status (all passed, some failed, pending)

Define check fetcher and mapper modules.
Keep output under 50 lines. End with PLAN_CHECKS_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_CHECKS_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-check-fetcher', {
    agent: 'builder',
    dependsOn: ['plan-checks'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/checks/fetcher.ts.

Based on: {{steps.plan-checks.output}}

Export async function fetchCheckRuns(provider, owner, repo, sha):
- Call provider.proxy() GET /repos/{owner}/{repo}/commits/{sha}/check-runs
- Handle pagination (check_runs array in response)
- Return { total_count, check_runs[] }

Export async function fetchCheckRunDetail(provider, owner, repo, checkRunId):
- Call provider.proxy() GET /repos/{owner}/{repo}/check-runs/{checkRunId}
- Return full check run with output details

Export function getHeadSHA(prMeta):
- Extract head SHA from PR metadata for check run lookup`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-check-mapper', {
    agent: 'builder',
    dependsOn: ['write-check-fetcher'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/checks/mapper.ts.

Export function mapCheckRun(checkRun, owner, repo, prNumber):
- Transform to: { id, name, status, conclusion, started_at, completed_at, output: { title, summary }, html_url, app: { name, slug } }
- Return { vfsPath: 'checks/{check_id}.json', content: JSON }

Export function aggregateCheckStatus(checkRuns):
- Return { total, passed, failed, pending, conclusion: 'success' | 'failure' | 'pending' }

Export async function ingestCheckRuns(provider, owner, repo, number, headSha, vfs):
- Fetch all check runs for headSha
- Map each through mapCheckRun
- Write to VFS
- Write checks/_summary.json with aggregateCheckStatus
- Return IngestResult`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-check-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/checks/__tests__/check-runs.test.ts.

Tests using vitest:
- fetchCheckRuns returns check list
- mapCheckRun produces correct JSON shape
- mapCheckRun builds correct VFS path
- aggregateCheckStatus counts correctly
- aggregateCheckStatus returns 'failure' if any failed
- aggregateCheckStatus returns 'pending' if any in_progress
- ingestCheckRuns writes all check files
- ingestCheckRuns writes _summary.json

Mock provider.proxy() with fixture data.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/checks/fetcher.ts && test -f ${GITHUB_ADAPTER_REPO}/src/checks/mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/checks/__tests__/check-runs.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review check runs at ${GITHUB_ADAPTER_REPO}/src/checks/:
- fetcher.ts, mapper.ts, __tests__/check-runs.test.ts

Verify:
- Correct GitHub API endpoint for check runs
- VFS path: /pulls/{number}/checks/{check_id}.json
- Summary aggregation logic is correct
- Check output (title, summary) is preserved
- Tests cover all check states

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Check runs:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
