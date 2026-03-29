/**
 * 032-review-scoped-tokens.ts
 *
 * Mint read-only relayauth tokens scoped per PR for review agents.
 * Tokens grant fs:read on /github/repos/{owner}/{repo}/pulls/{number}/**
 *
 * Run: agent-relay run workflows/032-review-scoped-tokens.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('review-scoped-tokens')
  .description('Mint read-only relayauth tokens scoped per PR for review agents')
  .pattern('dag')
  .channel('wf-relayfile-review-scoped-tokens')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans token minting and scoping' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements token minting' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews token security' })

  .step('plan-tokens', {
    agent: 'architect',
    task: `Read ${SPEC} section 8 (Scoped Access for Review Agents).

Plan scoped token minting:
- Orchestrator mints relayauth token on PR webhook arrival
- Token scope: fs:read on /github/repos/{owner}/{repo}/pulls/{number}/**
- Token has TTL matching review timeout (default 1 hour)
- Token includes metadata: workspaceId, prNumber, owner, repo
- Token revocation on review completion or PR close
- Scope builder constructs permission strings from PR context

Define token-minter and scope-builder modules.
Keep output under 50 lines. End with PLAN_TOKENS_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_TOKENS_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-token-minter', {
    agent: 'builder',
    dependsOn: ['plan-tokens'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/token-minter.ts.

Based on: {{steps.plan-tokens.output}}

Export interface ReviewToken { token: string; expiresAt: Date; scope: string[]; metadata: TokenMetadata }
Export interface TokenMetadata { workspaceId: string; owner: string; repo: string; prNumber: number }

Export async function mintReviewToken(client, workspaceId, scope, metadata, ttlMs?):
- Default ttlMs to 3_600_000 (1 hour)
- Call client.auth.createToken() with scope and ttl
- Attach metadata for audit trail
- Return ReviewToken

Export async function revokeReviewToken(client, tokenId):
- Call client.auth.revokeToken(tokenId)
- Return void

Export async function getTokenStatus(client, tokenId):
- Return { active: boolean, expiresAt: Date, scope: string[] }

Import types from ${SDK_REPO}/src/types if needed.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-scope-builder', {
    agent: 'builder',
    dependsOn: ['write-token-minter'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/scope-builder.ts.

Export function buildReviewScope(owner, repo, prNumber):
- Return ['fs:read:/github/repos/{owner}/{repo}/pulls/{prNumber}/**']
- Interpolate actual values into the path

Export function buildWritebackScope(owner, repo, prNumber):
- Return scope for writing review results back
- ['fs:write:/github/repos/{owner}/{repo}/pulls/{prNumber}/reviews/**',
   'fs:write:/github/repos/{owner}/{repo}/pulls/{prNumber}/comments/**']

Export function validateScope(scope, requestedPath):
- Check if requestedPath is covered by any scope pattern
- Support ** glob matching
- Return boolean

Export function parseScope(scopeString):
- Parse 'fs:read:/path/**' into { permission: 'read', pathPattern: '/path/**' }`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-scope-builder'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/__tests__/scoped-tokens.test.ts.

Tests using vitest:
- mintReviewToken returns token with correct scope
- mintReviewToken uses default TTL of 1 hour
- revokeReviewToken calls client.auth.revokeToken
- buildReviewScope produces correct fs:read path
- buildWritebackScope includes reviews and comments paths
- validateScope allows matching paths
- validateScope rejects paths outside scope
- parseScope extracts permission and path pattern

Mock client.auth methods.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/review/token-minter.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/scope-builder.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/__tests__/scoped-tokens.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review scoped tokens at ${GITHUB_ADAPTER_REPO}/src/review/:
- token-minter.ts, scope-builder.ts, __tests__/scoped-tokens.test.ts

Verify:
- Tokens are scoped to exact PR path with fs:read permission
- TTL defaults to 1 hour, is configurable
- Scope validation prevents path traversal outside PR directory
- Token revocation is clean
- No token leakage or overly broad permissions
- Tests cover minting, revocation, scope building, and validation

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Scoped tokens:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
