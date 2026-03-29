/**
 * 044-adapter-telemetry.ts
 *
 * Design shared OpenTelemetry support for adapters and providers.
 * Covers tracer setup, instrumentation wrappers, metrics, and tests.
 *
 * Run: agent-relay run workflows/044-adapter-telemetry.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const COMPOSIO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-composio';
const APIKEY_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-apikey';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('adapter-telemetry')
  .description('Design shared OpenTelemetry support across the relayfile ecosystem')
  .pattern('dag')
  .channel('wf-relayfile-adapter-telemetry')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans shared telemetry boundaries and naming' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Writes telemetry modules and tests' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews telemetry coverage and conventions' })

  .step('plan-telemetry', {
    agent: 'architect',
    task: `Read ${SPEC} sections 4, 5, and 6.

Plan shared telemetry in ${SDK_REPO}/src/telemetry:
- tracer.ts and metrics.ts
- adapter-instrumentation.ts
- provider-instrumentation.ts
- index.ts barrel exports
- test coverage for adapters and providers across ${GITHUB_ADAPTER_REPO}, ${NANGO_REPO}, ${COMPOSIO_REPO}, and ${APIKEY_REPO}
- Span names under relayfile.adapter.* and relayfile.provider.*

Keep output under 50 lines. End with PLAN_ADAPTER_TELEMETRY_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_ADAPTER_TELEMETRY_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-core-telemetry', {
    agent: 'builder',
    dependsOn: ['plan-telemetry'],
    task: `Write ${SDK_REPO}/src/telemetry/tracer.ts and ${SDK_REPO}/src/telemetry/metrics.ts.

Implement:
- Tracer bootstrap with otlp, console, and noop exporters
- Shared meter bootstrap and named instruments
- Shutdown helpers
- Deterministic config parsing and sane defaults

Verify files exist:
test -f ${SDK_REPO}/src/telemetry/tracer.ts
test -f ${SDK_REPO}/src/telemetry/metrics.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-adapter-instrumentation', {
    agent: 'builder',
    dependsOn: ['write-core-telemetry'],
    task: `Write ${SDK_REPO}/src/telemetry/adapter-instrumentation.ts.

Implement wrappers for:
- ingestWebhook(workspaceId, event)
- computePath(objectType, objectId)
- computeSemantics(objectType, objectId, payload)
- webhook counters and latency histograms
- exception recording and baggage helpers

Verify file exists:
test -f ${SDK_REPO}/src/telemetry/adapter-instrumentation.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-provider-instrumentation', {
    agent: 'builder',
    dependsOn: ['write-core-telemetry'],
    task: `Write ${SDK_REPO}/src/telemetry/provider-instrumentation.ts and update ${SDK_REPO}/src/telemetry/index.ts.

Implement wrappers for:
- proxy(request)
- healthCheck(connectionId)
- handleWebhook(rawPayload) when provided
- proxy counters, latency histograms, and error counters
- Barrel exports for all telemetry modules

Verify files exist:
test -f ${SDK_REPO}/src/telemetry/provider-instrumentation.ts
test -f ${SDK_REPO}/src/telemetry/index.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-adapter-instrumentation', 'write-provider-instrumentation'],
    task: `Write ${SDK_REPO}/src/telemetry/__tests__/telemetry.test.ts.

Cover:
- tracer initialization and shutdown
- adapter spans, metrics, and exception recording
- provider spans, metrics, and exception recording
- baggage propagation for workspaceId and connectionId
- Barrel exports compile and import cleanly

Verify file exists:
test -f ${SDK_REPO}/src/telemetry/__tests__/telemetry.test.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['write-tests'],
    task: `Review ${SDK_REPO}/src/telemetry/ and ${SDK_REPO}/src/telemetry/__tests__/telemetry.test.ts.

Verify:
- Naming follows relayfile.adapter.* and relayfile.provider.* conventions
- Key adapter and provider operations are instrumented
- Metrics use sensible instrument types
- Error paths record exceptions and status
- Tests cover both success and failure paths

Keep output under 50 lines. End with REVIEW_ADAPTER_TELEMETRY_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_ADAPTER_TELEMETRY_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Adapter telemetry:', result.status);
}

main().catch(console.error);
