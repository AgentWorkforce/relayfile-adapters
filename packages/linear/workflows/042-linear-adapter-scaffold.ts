/**
 * 042-linear-adapter-scaffold.ts
 *
 * Scaffold @relayfile/adapter-linear and the LinearAdapter contract.
 * Covers package bootstrap, path mapping, webhook normalization, and tests.
 *
 * Run: agent-relay run workflows/042-linear-adapter-scaffold.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const LINEAR_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-linear';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('linear-adapter-scaffold')
  .description('Scaffold @relayfile/adapter-linear around the IntegrationAdapter contract')
  .pattern('dag')
  .channel('wf-relayfile-linear-adapter-scaffold')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans the Linear adapter scaffold' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Writes the adapter scaffold files' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews scaffold quality and spec fit' })

  .step('plan-scaffold', {
    agent: 'architect',
    task: `Read ${SPEC} sections 2, 5, and the GitHub layout example in section 6.

Plan the adapter scaffold in ${LINEAR_REPO}:
- package.json, tsconfig.json, src/index.ts
- src/linear-adapter.ts extending IntegrationAdapter
- src/path-mapper.ts for deterministic Linear VFS paths
- src/webhook-normalizer.ts for raw Linear callbacks -> NormalizedWebhook
- src/types.ts for Linear config and payload shapes
- src/__tests__/linear-adapter.test.ts

Keep output under 50 lines. End with PLAN_LINEAR_ADAPTER_SCAFFOLD_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_LINEAR_ADAPTER_SCAFFOLD_COMPLETE' },
    timeout: 120_000,
  })

  .step('init-package', {
    agent: 'builder',
    dependsOn: ['plan-scaffold'],
    task: `Bootstrap ${LINEAR_REPO}.

Create or update:
- package.json for @relayfile/adapter-linear
- tsconfig.json with strict TypeScript settings
- src/index.ts barrel exports
- src/types.ts with LinearAdapterConfig and Linear payload types
- src/__tests__/ directory

Verify files exist:
test -f ${LINEAR_REPO}/package.json
test -f ${LINEAR_REPO}/tsconfig.json
test -f ${LINEAR_REPO}/src/index.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-adapter', {
    agent: 'builder',
    dependsOn: ['init-package'],
    task: `Write ${LINEAR_REPO}/src/linear-adapter.ts and ${LINEAR_REPO}/src/path-mapper.ts.

Implement:
- LinearAdapter extends IntegrationAdapter
- ingestWebhook(workspaceId, event) for issue, comment, project, and cycle events
- computePath(objectType, objectId) using deterministic Linear paths
- computeSemantics(objectType, objectId, payload) for priority, state, assignee, labels, relations
- Path helpers for issues, comments, projects, and cycles

Verify files exist:
test -f ${LINEAR_REPO}/src/linear-adapter.ts
test -f ${LINEAR_REPO}/src/path-mapper.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-webhook-normalizer', {
    agent: 'builder',
    dependsOn: ['write-adapter'],
    task: `Write ${LINEAR_REPO}/src/webhook-normalizer.ts and update ${LINEAR_REPO}/src/index.ts.

Implement:
- normalizeLinearWebhook(rawPayload, headers) -> NormalizedWebhook
- signature validation helpers
- eventType, objectType, objectId, and connection metadata extraction
- Barrel exports for LinearAdapter, mapper helpers, normalizer, and types

Verify files exist:
test -f ${LINEAR_REPO}/src/webhook-normalizer.ts
test -f ${LINEAR_REPO}/src/index.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-webhook-normalizer'],
    task: `Write ${LINEAR_REPO}/src/__tests__/linear-adapter.test.ts.

Cover:
- LinearAdapter.name and supported events
- normalizeLinearWebhook for issue and comment callbacks
- Signature rejection handling
- Deterministic issue, comment, project, and cycle path mapping
- computeSemantics extracting priority, state, labels, and relations
- Barrel exports compile and import cleanly

Verify file exists:
test -f ${LINEAR_REPO}/src/__tests__/linear-adapter.test.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['write-tests'],
    task: `Review ${LINEAR_REPO}/src/ and ${LINEAR_REPO}/src/__tests__/linear-adapter.test.ts.

Verify:
- IntegrationAdapter contract matches the spec
- Raw Linear callbacks are normalized before ingest
- Path mapping is deterministic across issues, comments, projects, and cycles
- Semantics capture Linear-specific fields cleanly
- Tests cover happy path and signature failure cases

Keep output under 50 lines. End with REVIEW_LINEAR_ADAPTER_SCAFFOLD_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_LINEAR_ADAPTER_SCAFFOLD_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Linear adapter scaffold:', result.status);
}

main().catch(console.error);
