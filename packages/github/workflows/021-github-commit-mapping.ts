/**
 * 021-github-commit-mapping.ts
 *
 * Map commits to /pulls/{n}/commits/{sha}.json in the relayfile VFS.
 * Fetches commit data via provider.proxy() and writes structured JSON.
 *
 * Run: agent-relay run workflows/021-github-commit-mapping.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-commit-mapping')
  .description('Map GitHub PR commits to relayfile VFS commit JSON files')
  .pattern('dag')
  .channel('wf-relayfile-github-commit-mapping')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans commit mapping strategy' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements commit mapping code' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews commit mapping implementation' })

  .step('plan-mapping', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/types.ts.

Plan commit mapping for PR commits:
- Fetch commits via GET /repos/{owner}/{repo}/pulls/{number}/commits
- For each commit, write /pulls/{number}/commits/{sha}.json
- Commit JSON includes: sha, message, author, date, parents, stats, files changed
- Handle pagination for PRs with many commits (>100)
- Track which commits are new vs already ingested

Define the commit fetcher and mapper modules.
Keep output under 50 lines. End with PLAN_MAPPING_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_MAPPING_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-commit-fetcher', {
    agent: 'builder',
    dependsOn: ['plan-mapping'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/commits/fetcher.ts.

Based on: {{steps.plan-mapping.output}}

Export async function fetchPRCommits(provider, owner, repo, number):
- Call provider.proxy() GET /repos/{owner}/{repo}/pulls/{number}/commits
- Handle pagination via Link header (per_page=100)
- Return array of raw commit objects
- Throw typed error on API failure

Export async function fetchCommitDetail(provider, owner, repo, sha):
- Call provider.proxy() GET /repos/{owner}/{repo}/commits/{sha}
- Returns full commit with stats and file changes`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-commit-mapper', {
    agent: 'builder',
    dependsOn: ['write-commit-fetcher'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/commits/mapper.ts.

Export function mapCommitToVFS(commit, owner, repo, prNumber):
- Transform raw GitHub commit to structured JSON
- Fields: sha, message, author { login, email, date }, committer, parents[], stats { additions, deletions, total }, filesChanged[]
- Return { vfsPath: '/pulls/{number}/commits/{sha}.json', content: JSON }

Export async function ingestCommits(provider, owner, repo, number, vfs):
- Fetch all commits via fetcher
- Map each through mapCommitToVFS
- Write each to VFS
- Return IngestResult with filesWritten count and paths`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-commit-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/commits/__tests__/commit-mapping.test.ts.

Tests using vitest with mock provider:
- fetchPRCommits returns paginated commits
- fetchCommitDetail returns full commit data
- mapCommitToVFS produces correct JSON structure
- mapCommitToVFS builds correct VFS path
- ingestCommits writes all commit files
- ingestCommits handles empty commit list
- Pagination fetches all pages

Mock provider.proxy() with fixture commit data.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/commits/fetcher.ts && test -f ${GITHUB_ADAPTER_REPO}/src/commits/mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/commits/__tests__/commit-mapping.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review commit mapping at ${GITHUB_ADAPTER_REPO}/src/commits/:
- fetcher.ts, mapper.ts, __tests__/commit-mapping.test.ts

Verify:
- Correct API endpoints for PR commits
- VFS path: /pulls/{number}/commits/{sha}.json
- Pagination handling is correct
- Commit JSON has all required fields
- Tests cover edge cases

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Commit mapping:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
