/**
 * 033-review-agent-dispatch.ts
 *
 * Spawn review agents with scoped tokens and workspace access.
 * Agents receive token + workspace URL to read code via relayfile API.
 *
 * Run: agent-relay run workflows/033-review-agent-dispatch.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('review-agent-dispatch')
  .description('Spawn review agents with scoped tokens and workspace access')
  .pattern('dag')
  .channel('wf-relayfile-review-agent-dispatch')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans agent dispatch strategy' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements agent dispatch' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews agent dispatch code' })

  .step('plan-dispatch', {
    agent: 'architect',
    task: `Read ${SPEC} section 8 and ${GITHUB_ADAPTER_REPO}/src/review/token-minter.ts.

Plan review agent dispatch:
- On workspace ready, spawn review agents with scoped tokens
- Agent config: type (security, style, logic), model, timeout
- Each agent gets: workspaceId, token, workspace URL, PR metadata
- Agents read code via GET /v1/workspaces/:id/fs/file?path=...
- Support multiple concurrent agents per PR (max 4)
- Collect agent results, handle timeouts and failures
- Clean up tokens after all agents complete

Define agent-spawner and config-builder modules.
Keep output under 50 lines. End with PLAN_DISPATCH_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_DISPATCH_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-agent-spawner', {
    agent: 'builder',
    dependsOn: ['plan-dispatch'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/agent-spawner.ts.

Based on: {{steps.plan-dispatch.output}}

Export interface AgentHandle { id: string; type: string; token: ReviewToken; status: 'pending'|'running'|'done'|'failed' }

Export async function spawnReviewAgent(client, config, token, workspaceUrl):
- Create agent handle with unique ID
- Pass token and workspace URL to agent
- Agent reads files via GET /v1/workspaces/:id/fs/file?path=...
- Set timeout from config (default 300_000ms)
- Return AgentHandle

Export async function spawnReviewAgents(client, configs, tokens, workspaceUrl):
- Spawn multiple agents concurrently (Promise.allSettled)
- Cap concurrency at config.maxConcurrent (default 4)
- Return AgentHandle[]

Export async function awaitAgentResults(handles, timeoutMs):
- Poll or await all agent handles
- Collect results from completed agents
- Mark timed-out agents as 'failed'
- Return { results: AgentResult[], failures: AgentHandle[] }

Export async function cleanupAgents(client, handles):
- Revoke all tokens associated with handles`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-config-builder', {
    agent: 'builder',
    dependsOn: ['write-agent-spawner'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/config-builder.ts.

Export interface ReviewAgentConfig {
  type: 'security' | 'style' | 'logic' | 'performance' | 'general';
  model: string;
  timeout: number;
  maxConcurrent: number;
  instructions: string;
}

Export function buildDefaultConfigs():
- Return array of default agent configs for a standard review
- Include: security (focus on vulns), logic (focus on bugs), general (overall quality)

Export function buildConfigFromPR(prMetadata, userConfig?):
- Customize agents based on PR size, language, labels
- Large PRs get more agents, small PRs fewer
- Return ReviewAgentConfig[]

Export function buildAgentInstructions(config, prMetadata):
- Generate review instructions for an agent type
- Include workspace URL pattern and file reading instructions
- Return string`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-config-builder'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/__tests__/agent-dispatch.test.ts.

Tests using vitest:
- spawnReviewAgent creates handle with correct token
- spawnReviewAgents respects maxConcurrent limit
- awaitAgentResults collects successful results
- awaitAgentResults marks timed-out agents as failed
- cleanupAgents revokes all tokens
- buildDefaultConfigs returns security, logic, general agents
- buildConfigFromPR adjusts agents for large PRs
- buildAgentInstructions includes workspace URL pattern

Mock client and token minting.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/review/agent-spawner.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/config-builder.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/__tests__/agent-dispatch.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review agent dispatch at ${GITHUB_ADAPTER_REPO}/src/review/:
- agent-spawner.ts, config-builder.ts, __tests__/agent-dispatch.test.ts

Verify:
- Agents receive scoped tokens, not raw credentials
- Concurrency is properly capped
- Timeout handling prevents hanging agents
- Token cleanup happens even on failures
- Config builder adapts to PR characteristics
- Tests cover spawn, await, cleanup, and config flows

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Agent dispatch:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
