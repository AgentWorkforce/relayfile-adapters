/**
 * 022-github-file-content.ts
 *
 * Fetch file contents via provider.proxy() and write to VFS.
 * Includes caching layer to avoid re-fetching unchanged files.
 *
 * Run: agent-relay run workflows/022-github-file-content.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-file-content')
  .description('Fetch GitHub file contents via provider.proxy() with caching')
  .pattern('dag')
  .channel('wf-relayfile-github-file-content')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans file content fetching strategy' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements file content fetching' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews file content implementation' })

  .step('plan-content', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/pr/file-mapper.ts.

Plan file content fetching:
- Fetch file content via GET /repos/{owner}/{repo}/contents/{path}?ref={sha}
- Write to VFS at /pulls/{number}/files/{path} (head version)
- Write to VFS at /pulls/{number}/base/{path} (base version)
- Respect maxFileSizeBytes config limit
- Skip binary files (detect via content-type or GitHub API response)
- Cache layer: check etag/sha before re-fetching
- Handle base64-encoded content from GitHub API

Keep output under 50 lines. End with PLAN_CONTENT_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_CONTENT_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-content-fetcher', {
    agent: 'builder',
    dependsOn: ['plan-content'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/files/content-fetcher.ts.

Based on: {{steps.plan-content.output}}

Export async function fetchFileContent(provider, owner, repo, path, ref):
- Call provider.proxy() GET /repos/{owner}/{repo}/contents/{path}?ref={ref}
- Decode base64 content from response
- Check file size against limit, skip if too large
- Detect binary files and skip with marker
- Return { content, sha, size, encoding, isBinary }

Export async function fetchHeadAndBase(provider, owner, repo, prNumber, file, headRef, baseRef):
- Fetch both head and base versions of a file
- Return { head: content, base: content, path }

Export async function writeFileContents(files, vfs, owner, repo, prNumber):
- Write head files to /pulls/{number}/files/{path}
- Write base files to /pulls/{number}/base/{path}
- Return IngestResult`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-cache-layer', {
    agent: 'builder',
    dependsOn: ['write-content-fetcher'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/files/cache.ts.

Export class FileContentCache:
- constructor(vfs) - takes VFS reference
- async has(owner, repo, path, sha): boolean - check if file already cached
- async get(owner, repo, path, sha): string | null - get cached content
- async set(owner, repo, path, sha, content): void - cache content
- Uses file sha as cache key
- Stores cache metadata in .cache/files.json in VFS

Export async function fetchWithCache(cache, provider, owner, repo, path, ref):
- Check cache first, fetch only if miss
- Update cache on fetch
- Return content with cacheHit boolean`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-cache-layer'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/files/__tests__/file-content.test.ts.

Tests using vitest:
- fetchFileContent decodes base64 content
- fetchFileContent skips binary files
- fetchFileContent respects size limit
- fetchHeadAndBase fetches both versions
- FileContentCache.has returns false on miss
- FileContentCache.set then has returns true
- fetchWithCache returns cached content on hit
- fetchWithCache calls provider on miss
- writeFileContents writes to correct VFS paths

Mock provider.proxy() with fixture responses.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/files/content-fetcher.ts && test -f ${GITHUB_ADAPTER_REPO}/src/files/cache.ts && test -f ${GITHUB_ADAPTER_REPO}/src/files/__tests__/file-content.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review file content code at ${GITHUB_ADAPTER_REPO}/src/files/:
- content-fetcher.ts, cache.ts, __tests__/file-content.test.ts

Verify:
- Correct GitHub API for file contents
- Base64 decoding is handled
- Binary detection works
- Cache prevents redundant fetches
- VFS paths: /pulls/{n}/files/{path} and /pulls/{n}/base/{path}
- Tests are comprehensive

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('File content:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
