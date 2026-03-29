/**
 * 035-review-orchestrator.ts
 *
 * Full webhook -> workspace -> review -> writeback orchestration flow.
 * Coordinates the complete PR review pipeline as a state machine.
 *
 * Run: agent-relay run workflows/035-review-orchestrator.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('review-orchestrator')
  .description('Full webhook to workspace to review to writeback orchestration')
  .pattern('dag')
  .channel('wf-relayfile-review-orchestrator')
  .maxConcurrency(5)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans orchestration pipeline' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements orchestrator' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews orchestration code' })

  .step('plan-orchestrator', {
    agent: 'architect',
    task: `Read ${SPEC} section 8 and these files:
- ${GITHUB_ADAPTER_REPO}/src/review/workspace-create.ts
- ${GITHUB_ADAPTER_REPO}/src/review/token-minter.ts
- ${GITHUB_ADAPTER_REPO}/src/review/agent-spawner.ts
- ${GITHUB_ADAPTER_REPO}/src/review/api-writer.ts

Plan the full review orchestration pipeline:
- State machine: webhook_received -> workspace_ready -> tokens_minted -> agents_dispatched -> results_collected -> writeback_complete -> cleanup_done
- Pipeline ties together: workspace lifecycle, token minting, agent dispatch, writeback
- Each state transition has error handling and rollback
- Support re-entry (new push on existing PR restarts from workspace_ready)
- Emit events for observability at each state transition

Define pipeline and state-machine modules.
Keep output under 50 lines. End with PLAN_ORCHESTRATOR_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_ORCHESTRATOR_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-pipeline', {
    agent: 'builder',
    dependsOn: ['plan-orchestrator'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/pipeline.ts.

Based on: {{steps.plan-orchestrator.output}}

Export interface PipelineContext {
  workspaceId: string; owner: string; repo: string; prNumber: number;
  tokens: ReviewToken[]; agents: AgentHandle[]; state: PipelineState;
}
Export type PipelineState = 'webhook_received'|'workspace_ready'|'tokens_minted'|'agents_dispatched'|'results_collected'|'writeback_complete'|'cleanup_done'|'failed';

Export async function runReviewPipeline(client, adapter, provider, event):
- Create PipelineContext from webhook event
- Step 1: Create/update workspace (workspace-create or workspace-update)
- Step 2: Mint scoped tokens (token-minter)
- Step 3: Dispatch review agents (agent-spawner)
- Step 4: Await results (agent-spawner.awaitAgentResults)
- Step 5: Write back to GitHub (api-writer.writeBackResults)
- Step 6: Cleanup tokens and mark complete
- Each step updates context.state
- On error at any step, run cleanup and set state to 'failed'
- Return PipelineContext

Import from workspace-create, token-minter, agent-spawner, api-writer.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-state-machine', {
    agent: 'builder',
    dependsOn: ['write-pipeline'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/state-machine.ts.

Export interface StateTransition { from: PipelineState; to: PipelineState; timestamp: Date; error?: string }

Export class ReviewStateMachine {
  private state: PipelineState;
  private transitions: StateTransition[];
  private onTransition?: (t: StateTransition) => void;

  constructor(initialState, onTransition?)
  getState(): PipelineState
  getTransitions(): StateTransition[]

  async transition(to, executor: () => Promise<void>):
  - Validate transition is legal (define allowed transitions)
  - Execute the step function
  - Record transition with timestamp
  - On error: transition to 'failed', record error
  - Call onTransition callback for observability

  canTransitionTo(target): boolean
  - Check if target state is reachable from current state

  isTerminal(): boolean
  - Return true if state is 'cleanup_done' or 'failed'
}

Export const ALLOWED_TRANSITIONS: Record<PipelineState, PipelineState[]>`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-state-machine'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/__tests__/review-orchestrator.test.ts.

Tests using vitest:
- runReviewPipeline progresses through all states on success
- runReviewPipeline cleans up on agent failure
- runReviewPipeline handles workspace creation error
- ReviewStateMachine validates legal transitions
- ReviewStateMachine rejects illegal transitions
- ReviewStateMachine records transition history
- ReviewStateMachine calls onTransition callback
- isTerminal returns true for cleanup_done and failed

Mock all imported modules (workspace-create, token-minter, etc).`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/review/pipeline.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/state-machine.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/__tests__/review-orchestrator.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review orchestrator at ${GITHUB_ADAPTER_REPO}/src/review/:
- pipeline.ts, state-machine.ts, __tests__/review-orchestrator.test.ts

Verify:
- Pipeline ties all review modules together correctly
- State machine enforces valid transitions only
- Error at any step triggers cleanup (token revocation, etc)
- Re-entry for push events is handled
- Observability callbacks fire on transitions
- Tests cover success path, failure paths, and state validation

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Review orchestrator:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
