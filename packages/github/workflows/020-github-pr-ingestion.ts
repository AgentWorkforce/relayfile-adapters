/**
 * 020-github-pr-ingestion.ts
 *
 * Ingest PR metadata + files + diff into relayfile VFS.
 * Maps GitHub PR data to /github/repos/{owner}/{repo}/pulls/{number}/ layout.
 *
 * Run: agent-relay run workflows/020-github-pr-ingestion.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-pr-ingestion')
  .description('Ingest GitHub PR metadata, files, and diffs into relayfile VFS')
  .pattern('dag')
  .channel('wf-relayfile-github-pr-ingestion')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans PR ingestion pipeline' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements PR ingestion code' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews PR ingestion implementation' })

  .step('plan-ingestion', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/index.ts.

Plan the PR ingestion pipeline:
- Fetch PR metadata via provider.proxy() GET /repos/{owner}/{repo}/pulls/{number}
- Write meta.json to /github/repos/{owner}/{repo}/pulls/{number}/meta.json
- Fetch PR files list via GET /repos/{owner}/{repo}/pulls/{number}/files
- Write each file to files/{path}
- Fetch diff via Accept: application/vnd.github.diff
- Write diff.patch
- Return IngestResult with filesWritten, paths

Define the PR parser, file mapper, and diff writer modules.
Keep output under 50 lines. End with PLAN_INGESTION_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_INGESTION_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-pr-parser', {
    agent: 'builder',
    dependsOn: ['plan-ingestion'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/pr/parser.ts.

Based on: {{steps.plan-ingestion.output}}

Export async function parsePullRequest(provider, owner, repo, number):
- Call provider.proxy({ method: 'GET', endpoint: '/repos/{owner}/{repo}/pulls/{number}' })
- Parse response into GitHubPR type
- Extract: title, body, state, head/base refs, author, labels, created/updated dates
- Return structured PR metadata object
- Handle API errors gracefully, throw typed errors

Import types from '../types'.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-file-mapper', {
    agent: 'builder',
    dependsOn: ['write-pr-parser'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/pr/file-mapper.ts.

Export async function mapPRFiles(provider, owner, repo, number):
- Call provider.proxy() to GET /repos/{owner}/{repo}/pulls/{number}/files
- Map each file to VFS path: files/{filename}
- Track status (added, removed, modified, renamed)
- Return array of { vfsPath, githubPath, status, additions, deletions }

Export function buildVFSPath(owner, repo, number, subpath):
- Returns /github/repos/{owner}/{repo}/pulls/{number}/{subpath}`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-diff-writer', {
    agent: 'builder',
    dependsOn: ['write-file-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/pr/diff-writer.ts.

Export async function fetchAndWriteDiff(provider, owner, repo, number, vfs):
- Call provider.proxy() with Accept: 'application/vnd.github.diff' header
- Write raw diff to vfs at pulls/{number}/diff.patch
- Return { path, size } of written diff

Export async function ingestPullRequest(provider, owner, repo, number, vfs):
- Orchestrate: parsePullRequest → mapPRFiles → fetchAndWriteDiff
- Write meta.json from parsed PR data
- Write file entries from mapper
- Write diff.patch
- Return IngestResult { filesWritten, filesUpdated, filesDeleted, paths, errors }`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-diff-writer'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/pr/__tests__/ingestion.test.ts.

Tests using vitest with mock provider:
- parsePullRequest extracts correct metadata
- mapPRFiles maps file paths correctly
- mapPRFiles handles renamed files
- fetchAndWriteDiff writes diff.patch
- ingestPullRequest returns complete IngestResult
- ingestPullRequest handles API errors gracefully
- buildVFSPath constructs correct paths

Mock provider.proxy() to return fixture data.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/pr/parser.ts && test -f ${GITHUB_ADAPTER_REPO}/src/pr/file-mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/pr/diff-writer.ts && test -f ${GITHUB_ADAPTER_REPO}/src/pr/__tests__/ingestion.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review PR ingestion at ${GITHUB_ADAPTER_REPO}/src/pr/:
- parser.ts, file-mapper.ts, diff-writer.ts, __tests__/ingestion.test.ts

Verify:
- Correct GitHub API endpoints used
- VFS paths match spec: /github/repos/{owner}/{repo}/pulls/{number}/
- IngestResult shape is correct
- Error handling is present
- Tests cover happy path and error cases

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('PR ingestion:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
