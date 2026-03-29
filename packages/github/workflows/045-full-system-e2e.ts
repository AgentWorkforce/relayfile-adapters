/**
 * 045-full-system-e2e.ts
 *
 * Design the complete ecosystem E2E workflow across SDK, providers, and adapters.
 * Covers registration, webhook ingest, VFS verification, writeback, and tests.
 *
 * Run: agent-relay run workflows/045-full-system-e2e.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const COMPOSIO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-composio';
const APIKEY_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-apikey';
const SLACK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-slack';
const LINEAR_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-linear';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('full-system-e2e')
  .description('Design end-to-end tests for registry, providers, adapters, ingest, and writeback')
  .pattern('dag')
  .channel('wf-relayfile-full-system-e2e')
  .maxConcurrency(5)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans the end-to-end test matrix' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Writes fixtures and end-to-end tests' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews E2E coverage and determinism' })

  .step('plan-e2e', {
    agent: 'architect',
    task: `Read ${SPEC} sections 2 through 6.

Plan the ecosystem E2E suite in ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e:
- Registry setup from ${SDK_REPO}
- Provider coverage from ${NANGO_REPO}, ${COMPOSIO_REPO}, and ${APIKEY_REPO}
- Adapter coverage from ${GITHUB_ADAPTER_REPO}, ${SLACK_REPO}, and ${LINEAR_REPO}
- Flows for registration, webhook ingest, VFS assertions, semantics, and writeback
- Deterministic fixtures for GitHub, Slack, and Linear

Keep output under 50 lines. End with PLAN_FULL_SYSTEM_E2E_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_FULL_SYSTEM_E2E_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-fixtures', {
    agent: 'builder',
    dependsOn: ['plan-e2e'],
    task: `Write fixture files under ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/fixtures and ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/helpers.ts.

Create:
- github webhook fixtures
- slack webhook fixtures
- linear webhook fixtures
- provider response mocks
- registry and VFS helper utilities

Verify files exist:
test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/helpers.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-registry-tests', {
    agent: 'builder',
    dependsOn: ['write-fixtures'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/register-configure.test.ts.

Cover:
- Adapter registration in the SDK registry
- Provider configuration and health checks
- Binding GitHub, Slack, and Linear adapters to providers
- Duplicate registration rejection
- Deterministic registry listing and lookup

Verify file exists:
test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/register-configure.test.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-ingest-tests', {
    agent: 'builder',
    dependsOn: ['write-registry-tests'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/webhook-ingest.test.ts and verify-ingest.test.ts.

Cover:
- GitHub, Slack, and Linear webhook ingest flows
- Signature or auth failure handling
- Deterministic VFS paths and file contents
- Semantics attached to ingested files
- Stable assertions for repeated events

Verify files exist:
test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/webhook-ingest.test.ts
test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/verify-ingest.test.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-roundtrip-tests', {
    agent: 'builder',
    dependsOn: ['write-ingest-tests'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/writeback.test.ts.

Cover:
- GitHub ingest -> modify -> writeback
- Slack ingest -> modify -> writeback
- Linear ingest -> modify -> writeback
- Provider proxy assertions for path, method, headers, and body
- Round-trip tests using only mocked external calls

Verify file exists:
test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/writeback.test.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['write-roundtrip-tests'],
    task: `Review ${GITHUB_ADAPTER_REPO}/src/__tests__/e2e/.

Verify:
- Registry, provider, adapter, ingest, and writeback coverage is complete
- Fixtures are realistic and deterministic
- All external calls are mocked
- Cross-adapter assertions use a consistent contract
- Round-trip tests prove ingest and writeback together

Keep output under 50 lines. End with REVIEW_FULL_SYSTEM_E2E_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_FULL_SYSTEM_E2E_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Full system E2E:', result.status);
}

main().catch(console.error);
