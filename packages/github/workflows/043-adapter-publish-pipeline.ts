/**
 * 043-adapter-publish-pipeline.ts
 *
 * Design the shared CI/CD workflow for publishing relayfile packages.
 * Covers reusable manifests, GitHub Actions, release scripts, and tests.
 *
 * Run: agent-relay run workflows/043-adapter-publish-pipeline.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const COMPOSIO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-composio';
const APIKEY_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-apikey';
const SLACK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-slack';
const LINEAR_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-linear';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('adapter-publish-pipeline')
  .description('Design shared CI/CD for SDK, providers, and adapters in dependency order')
  .pattern('dag')
  .channel('wf-relayfile-adapter-publish-pipeline')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans release order and pipeline structure' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Writes workflow, manifest, and script files' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews CI/CD correctness and safety' })

  .step('plan-pipeline', {
    agent: 'architect',
    task: `Read ${SPEC} package taxonomy and dependency flow.

Plan the shared publish pipeline from ${GITHUB_ADAPTER_REPO}:
- Publish order: sdk -> providers -> adapters
- Repos: ${SDK_REPO}, ${NANGO_REPO}, ${COMPOSIO_REPO}, ${APIKEY_REPO}, ${SLACK_REPO}, ${LINEAR_REPO}, ${GITHUB_ADAPTER_REPO}
- GitHub Actions: ci.yml and publish.yml
- Deterministic manifest of package names and repo paths
- Scripts for version bump and publish-all
- npm provenance and secret-driven publishing only

Keep output under 50 lines. End with PLAN_ADAPTER_PUBLISH_PIPELINE_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_ADAPTER_PUBLISH_PIPELINE_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-manifest', {
    agent: 'builder',
    dependsOn: ['plan-pipeline'],
    task: `Write deterministic release metadata in ${GITHUB_ADAPTER_REPO}/scripts/release-manifest.json.

Include:
- package name
- repo path
- dependency rank
- publish command
- test command

Verify file exists:
test -f ${GITHUB_ADAPTER_REPO}/scripts/release-manifest.json`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-github-actions', {
    agent: 'builder',
    dependsOn: ['write-manifest'],
    task: `Write ${GITHUB_ADAPTER_REPO}/.github/workflows/ci.yml and publish.yml.

Implement:
- PR CI with checkout, setup-node, install, build, lint, and test
- Publish on tags and manual dispatch
- Release order driven from release-manifest.json
- npm publish --provenance --access public
- NPM_TOKEN from secrets only

Verify files exist:
test -f ${GITHUB_ADAPTER_REPO}/.github/workflows/ci.yml
test -f ${GITHUB_ADAPTER_REPO}/.github/workflows/publish.yml`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-release-scripts', {
    agent: 'builder',
    dependsOn: ['write-github-actions'],
    task: `Write ${GITHUB_ADAPTER_REPO}/scripts/version-bump.sh and ${GITHUB_ADAPTER_REPO}/scripts/publish-all.sh.

Implement:
- Deterministic package lookup from release-manifest.json
- Argument validation and non-zero exits on misuse
- Dry-run support for publish-all.sh
- Ordered publishing with summary output
- File-exists checks before publish steps begin

Verify files exist:
test -f ${GITHUB_ADAPTER_REPO}/scripts/version-bump.sh
test -f ${GITHUB_ADAPTER_REPO}/scripts/publish-all.sh`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-release-scripts'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/publish-pipeline.test.ts.

Cover:
- release-manifest.json ordering and path completeness
- ci.yml required jobs and triggers
- publish.yml tag trigger and provenance usage
- version-bump.sh argument validation
- publish-all.sh dry-run and failure handling
- Secret-driven publish config without hardcoded tokens

Verify file exists:
test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/publish-pipeline.test.ts`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['write-tests'],
    task: `Review ${GITHUB_ADAPTER_REPO}/.github/workflows/, scripts/, and src/__tests__/publish-pipeline.test.ts.

Verify:
- Publish order matches the dependency graph
- Pipeline remains deterministic via manifest-driven ordering
- NPM_TOKEN is secret-only and provenance is enabled
- Dry-run and failure behavior are covered
- Tests validate both YAML and shell behavior

Keep output under 50 lines. End with REVIEW_ADAPTER_PUBLISH_PIPELINE_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_ADAPTER_PUBLISH_PIPELINE_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Adapter publish pipeline:', result.status);
}

main().catch(console.error);
