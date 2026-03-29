/**
 * 041-slack-adapter-scaffold.ts
 *
 * Scaffold @relayfile/adapter-slack and the SlackAdapter contract.
 * Covers package bootstrap, path mapping, webhook normalization, and tests.
 *
 * Run: agent-relay run workflows/041-slack-adapter-scaffold.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const SLACK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-slack';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('slack-adapter-scaffold')
  .description('Scaffold @relayfile/adapter-slack around the IntegrationAdapter contract')
  .pattern('dag')
  .channel('wf-relayfile-slack-adapter-scaffold')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans the Slack adapter scaffold' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Writes the adapter scaffold files' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews scaffold quality and spec fit' })

  .step('plan-scaffold', {
    agent: 'architect',
    task: `Read ${SPEC} sections 2, 5, and the GitHub layout example in section 6.

Plan the adapter scaffold in ${SLACK_REPO}:
- package.json, tsconfig.json, src/index.ts
- src/slack-adapter.ts extending IntegrationAdapter
- src/path-mapper.ts for deterministic Slack VFS paths
- src/webhook-normalizer.ts for raw Slack callbacks -> NormalizedWebhook
- src/types.ts for Slack config and payload shapes
- src/__tests__/slack-adapter.test.ts

Keep output under 50 lines. End with PLAN_SLACK_ADAPTER_SCAFFOLD_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_SLACK_ADAPTER_SCAFFOLD_COMPLETE' },
    timeout: 120_000,
  })

  .step('init-package', {
    agent: 'builder',
    dependsOn: ['plan-scaffold'],
    task: `Bootstrap ${SLACK_REPO}.

Create or update:
- package.json for @relayfile/adapter-slack
- tsconfig.json with strict TypeScript settings
- src/index.ts barrel exports
- src/types.ts with SlackAdapterConfig and Slack event types
- src/__tests__/ directory

Verify files exist:
test -f ${SLACK_REPO}/package.json
test -f ${SLACK_REPO}/tsconfig.json
test -f ${SLACK_REPO}/src/index.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-adapter', {
    agent: 'builder',
    dependsOn: ['init-package'],
    task: `Write ${SLACK_REPO}/src/slack-adapter.ts and ${SLACK_REPO}/src/path-mapper.ts.

Implement:
- SlackAdapter extends IntegrationAdapter
- ingestWebhook(workspaceId, event) for message, reaction, and channel events
- computePath(objectType, objectId) using deterministic Slack paths
- computeSemantics(objectType, objectId, payload) for mentions, links, reactions, threads
- Path helpers for channels, messages, threads, and user metadata

Verify files exist:
test -f ${SLACK_REPO}/src/slack-adapter.ts
test -f ${SLACK_REPO}/src/path-mapper.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-webhook-normalizer', {
    agent: 'builder',
    dependsOn: ['write-adapter'],
    task: `Write ${SLACK_REPO}/src/webhook-normalizer.ts and update ${SLACK_REPO}/src/index.ts.

Implement:
- normalizeSlackWebhook(rawPayload, headers) -> NormalizedWebhook
- url_verification handling and signature validation helpers
- eventType and object metadata extraction for Slack envelopes
- Barrel exports for SlackAdapter, mapper helpers, normalizer, and types

Verify files exist:
test -f ${SLACK_REPO}/src/webhook-normalizer.ts
test -f ${SLACK_REPO}/src/index.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-webhook-normalizer'],
    task: `Write ${SLACK_REPO}/src/__tests__/slack-adapter.test.ts.

Cover:
- SlackAdapter.name and supported events
- normalizeSlackWebhook for message and reaction envelopes
- Signature rejection and url_verification handling
- Deterministic message and thread path mapping
- computeSemantics extracting mentions, links, reactions, and thread depth
- Barrel exports compile and import cleanly

Verify file exists:
test -f ${SLACK_REPO}/src/__tests__/slack-adapter.test.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['write-tests'],
    task: `Review ${SLACK_REPO}/src/ and ${SLACK_REPO}/src/__tests__/slack-adapter.test.ts.

Verify:
- IntegrationAdapter contract matches the spec
- Raw Slack callbacks are normalized before ingest
- Path mapping is deterministic and filesystem-safe
- Semantics capture message/thread details cleanly
- Tests cover happy path and signature failure cases

Keep output under 50 lines. End with REVIEW_SLACK_ADAPTER_SCAFFOLD_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_SLACK_ADAPTER_SCAFFOLD_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Slack adapter scaffold:', result.status);
}

main().catch(console.error);
