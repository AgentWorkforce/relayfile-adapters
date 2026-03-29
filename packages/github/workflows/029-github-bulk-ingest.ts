/**
 * 029-github-bulk-ingest.ts
 *
 * Bulk write all PR files in batch for efficient ingestion.
 * Fetches and writes files concurrently with rate limiting.
 *
 * Run: agent-relay run workflows/029-github-bulk-ingest.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-bulk-ingest')
  .description('Bulk fetch and write all PR files in batch with concurrency control')
  .pattern('dag')
  .channel('wf-relayfile-github-bulk-ingest')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans bulk ingestion strategy' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements bulk ingestion' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews bulk ingestion code' })

  .step('plan-bulk', {
    agent: 'architect',
    task: `Read ${SPEC} and existing modules:
- ${GITHUB_ADAPTER_REPO}/src/pr/file-mapper.ts
- ${GITHUB_ADAPTER_REPO}/src/files/content-fetcher.ts
- ${GITHUB_ADAPTER_REPO}/src/files/cache.ts

Plan bulk ingestion:
- Fetch PR file list, then batch-fetch all file contents
- Concurrency limit (configurable, default 5 parallel fetches)
- Rate limit awareness (GitHub 5000 req/hr, check X-RateLimit headers)
- Batch VFS writes (collect all, write in single transaction if possible)
- Progress tracking: files fetched, files written, errors
- Resume capability: skip already-cached files
- Memory management: stream large files instead of buffering

Define batch fetcher and bulk writer modules.
Keep output under 50 lines. End with PLAN_BULK_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_BULK_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-batch-fetcher', {
    agent: 'builder',
    dependsOn: ['plan-bulk'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/bulk/batch-fetcher.ts.

Based on: {{steps.plan-bulk.output}}

Export interface BatchOptions { concurrency: number, maxFileSize: number, skipCached: boolean }

Export async function batchFetchFiles(provider, files, headRef, baseRef, options):
- Takes array of file descriptors from PR file list
- Fetches content for each file (head + base) with concurrency limit
- Uses p-limit pattern (implement inline, no external dep)
- Checks cache before fetching if skipCached is true
- Tracks rate limit from response headers
- Returns { fetched: FileContent[], skipped: string[], errors: FetchError[] }

Export function checkRateLimit(headers):
- Parse X-RateLimit-Remaining, X-RateLimit-Reset
- Return { remaining, resetAt, shouldThrottle }

Export async function throttleIfNeeded(rateLimit):
- If remaining < 100, delay until reset time
- Log warning when throttling`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-bulk-writer', {
    agent: 'builder',
    dependsOn: ['write-batch-fetcher'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/bulk/bulk-writer.ts.

Export interface BulkWriteResult { filesWritten, filesUpdated, filesSkipped, errors, duration }

Export async function bulkWriteToVFS(files, vfs, owner, repo, prNumber):
- Write all fetched files to VFS in batch
- Head files → /pulls/{number}/files/{path}
- Base files → /pulls/{number}/base/{path}
- Track written vs updated (file existed before)
- Return BulkWriteResult

Export async function bulkIngestPR(provider, owner, repo, number, vfs, options?):
- Orchestrate full bulk ingestion:
  1. Fetch PR metadata + file list
  2. Batch fetch all file contents
  3. Fetch diff
  4. Bulk write everything to VFS
  5. Update cache
- Return IngestResult with complete stats

Export function mergeIngestResults(...results: IngestResult[]): IngestResult
- Combine multiple IngestResult objects into one`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-bulk-writer'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/bulk/__tests__/bulk-ingest.test.ts.

Tests using vitest:
- batchFetchFiles respects concurrency limit
- batchFetchFiles skips cached files
- batchFetchFiles handles fetch errors gracefully
- checkRateLimit parses headers correctly
- throttleIfNeeded delays when near limit
- bulkWriteToVFS writes head and base files
- bulkWriteToVFS tracks written vs updated counts
- bulkIngestPR orchestrates full flow
- mergeIngestResults combines stats correctly
- Large PR (100+ files) handles without memory issues

Mock provider.proxy() and VFS.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/bulk/batch-fetcher.ts && test -f ${GITHUB_ADAPTER_REPO}/src/bulk/bulk-writer.ts && test -f ${GITHUB_ADAPTER_REPO}/src/bulk/__tests__/bulk-ingest.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review bulk ingestion at ${GITHUB_ADAPTER_REPO}/src/bulk/:
- batch-fetcher.ts, bulk-writer.ts, __tests__/bulk-ingest.test.ts

Verify:
- Concurrency control is implemented correctly
- Rate limiting checks X-RateLimit headers
- Cache integration prevents redundant fetches
- VFS paths match spec
- Error handling doesn't fail entire batch on single error
- Tests cover concurrency and error scenarios

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Bulk ingest:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
