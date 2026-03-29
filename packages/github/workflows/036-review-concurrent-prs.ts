/**
 * 036-review-concurrent-prs.ts
 *
 * Workspace isolation for parallel PR reviews.
 * Ensures multiple PRs can be reviewed concurrently without interference.
 *
 * Run: agent-relay run workflows/036-review-concurrent-prs.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('review-concurrent-prs')
  .description('Workspace isolation for parallel PR reviews')
  .pattern('dag')
  .channel('wf-relayfile-review-concurrent-prs')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans workspace isolation strategy' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements workspace isolation' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews isolation code' })

  .step('plan-isolation', {
    agent: 'architect',
    task: `Read ${SPEC} sections 6 and 8.

Plan workspace isolation for concurrent PR reviews:
- Each PR gets its own workspace namespace: /github/repos/{owner}/{repo}/pulls/{number}
- Workspace manager tracks active reviews with a registry
- Lock handler prevents duplicate reviews for same PR
- Support concurrent reviews across different PRs (no global lock)
- Handle race conditions: two pushes to same PR in quick succession
- Resource limits: max concurrent reviews per repo (configurable)
- Graceful degradation: queue excess reviews

Define workspace-manager and lock-handler modules.
Keep output under 50 lines. End with PLAN_ISOLATION_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_ISOLATION_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-workspace-manager', {
    agent: 'builder',
    dependsOn: ['plan-isolation'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/workspace-manager.ts.

Based on: {{steps.plan-isolation.output}}

Export interface ActiveReview { workspaceId: string; owner: string; repo: string; prNumber: number; startedAt: Date; state: PipelineState }

Export class WorkspaceManager {
  private activeReviews: Map<string, ActiveReview>;
  private maxConcurrentPerRepo: number;
  private queue: Array<{ key: string; resolve: Function }>;

  constructor(maxConcurrentPerRepo?: number) // default 5

  getWorkspaceKey(owner, repo, prNumber): string
  - Return '{owner}/{repo}#{prNumber}'

  async acquireWorkspace(owner, repo, prNumber): Promise<ActiveReview | null>
  - Check if review already active for this PR
  - If active, return null (caller should cancel previous or queue)
  - Check repo concurrency limit
  - If at limit, add to queue, return promise that resolves when slot opens
  - Register and return ActiveReview

  async releaseWorkspace(owner, repo, prNumber): void
  - Remove from activeReviews map
  - Process next item in queue if any

  getActiveReviews(): ActiveReview[]
  getActiveReviewsForRepo(owner, repo): ActiveReview[]
  getQueueLength(): number
}`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-lock-handler', {
    agent: 'builder',
    dependsOn: ['write-workspace-manager'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/lock-handler.ts.

Export interface ReviewLock { key: string; acquiredAt: Date; expiresAt: Date; holder: string }

Export class LockHandler {
  private locks: Map<string, ReviewLock>;
  private lockTtlMs: number;

  constructor(lockTtlMs?: number) // default 3_600_000

  async acquireLock(owner, repo, prNumber, holder): Promise<ReviewLock | null>
  - Key: '{owner}/{repo}#{prNumber}'
  - If lock exists and not expired, return null
  - If lock exists and expired, release it first
  - Create new lock with TTL
  - Return ReviewLock

  async releaseLock(owner, repo, prNumber, holder): boolean
  - Only release if holder matches
  - Return true if released

  async forceReleaseLock(owner, repo, prNumber): void
  - Release regardless of holder (admin operation)

  isLocked(owner, repo, prNumber): boolean
  getLock(owner, repo, prNumber): ReviewLock | null

  async withLock(owner, repo, prNumber, holder, fn):
  - Acquire lock, run fn, release lock in finally block
  - Throw if lock cannot be acquired
}`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-lock-handler'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/__tests__/concurrent-prs.test.ts.

Tests using vitest:
- WorkspaceManager.acquireWorkspace creates active review
- WorkspaceManager.acquireWorkspace returns null for duplicate PR
- WorkspaceManager.acquireWorkspace queues when at repo limit
- WorkspaceManager.releaseWorkspace processes queue
- LockHandler.acquireLock creates lock with TTL
- LockHandler.acquireLock rejects if already locked
- LockHandler.acquireLock reclaims expired locks
- LockHandler.withLock releases lock even on error

Test concurrent scenarios with Promise.all.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/review/workspace-manager.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/lock-handler.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/__tests__/concurrent-prs.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review concurrent PR handling at ${GITHUB_ADAPTER_REPO}/src/review/:
- workspace-manager.ts, lock-handler.ts, __tests__/concurrent-prs.test.ts

Verify:
- Each PR gets isolated workspace namespace
- No global lock blocks unrelated PRs
- Duplicate reviews for same PR are prevented
- Repo concurrency limit is enforced with queueing
- Lock TTL prevents stuck locks
- withLock pattern ensures cleanup on errors
- Tests cover concurrency and race condition scenarios

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Concurrent PRs:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
