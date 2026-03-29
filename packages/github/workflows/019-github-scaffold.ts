/**
 * 019-github-scaffold.ts
 *
 * Package setup + GitHubAdapter class skeleton extending IntegrationAdapter.
 * Creates the foundational package structure, adapter class, config, and tests.
 *
 * Run: agent-relay run workflows/019-github-scaffold.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-scaffold')
  .description('Scaffold @relayfile/adapter-github package with GitHubAdapter class')
  .pattern('dag')
  .channel('wf-relayfile-github-scaffold')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans scaffold structure' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Writes adapter scaffold code' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews scaffold for correctness' })

  .step('plan-scaffold', {
    agent: 'architect',
    task: `Read ${SPEC} and the SDK IntegrationAdapter at ${SDK_REPO}/packages/relayfile-sdk/src/provider.ts.

Plan the scaffold for @relayfile/adapter-github:
- package.json with dependencies (@relayfile/sdk, typescript, vitest)
- src/index.ts: GitHubAdapter extends IntegrationAdapter
- src/types.ts: GitHub-specific types (PR, Issue, Review, CheckRun)
- src/config.ts: adapter config schema
- tsconfig.json
- vitest.config.ts

List every file, its exports, and key types.
Keep output under 50 lines. End with PLAN_SCAFFOLD_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_SCAFFOLD_COMPLETE' },
    timeout: 120_000,
  })

  .step('init-package', {
    agent: 'builder',
    dependsOn: ['plan-scaffold'],
    task: `Create the package structure for @relayfile/adapter-github at ${GITHUB_ADAPTER_REPO}.

Based on: {{steps.plan-scaffold.output}}

Create package.json with:
- name: "@relayfile/adapter-github"
- main: "dist/index.js", types: "dist/index.d.ts"
- scripts: build, test, lint
- peerDependencies: @relayfile/sdk
- devDependencies: typescript, vitest, @types/node

Create tsconfig.json extending typical node16 settings.
Create vitest.config.ts with src as root.
Create src/ directory structure.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-adapter-class', {
    agent: 'builder',
    dependsOn: ['init-package'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/index.ts and ${GITHUB_ADAPTER_REPO}/src/types.ts.

Based on: {{steps.plan-scaffold.output}}

src/index.ts must:
- Import IntegrationAdapter, ConnectionProvider, IngestResult from @relayfile/sdk
- Export class GitHubAdapter extends IntegrationAdapter
- Constructor takes ConnectionProvider + config
- Stub methods: ingestPullRequest, ingestIssue, ingestCheckRun, routeWebhook
- Each returns Promise<IngestResult>
- Export adapter name as 'github'

src/types.ts must:
- Export interfaces: GitHubPR, GitHubIssue, GitHubReview, GitHubCheckRun, GitHubCommit
- Export type GitHubWebhookEvent with action discriminator
- Export GitHubAdapterConfig interface`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-config', {
    agent: 'builder',
    dependsOn: ['write-adapter-class'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/config.ts.

Export GitHubAdapterConfig with:
- baseUrl: string (default 'https://api.github.com')
- defaultBranch: string (default 'main')
- fetchFileContents: boolean (default true)
- maxFileSizeBytes: number (default 1MB)
- supportedEvents: string[] (PR, issue, check_run events)

Export a validateConfig function that validates and applies defaults.
Export a JSON Schema object for the config.`,
    verification: { type: 'exit_code' },
    timeout: 120_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-config'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/__tests__/scaffold.test.ts.

Tests:
- GitHubAdapter can be instantiated with mock provider
- GitHubAdapter extends IntegrationAdapter
- adapter.name returns 'github'
- validateConfig applies defaults correctly
- validateConfig rejects invalid config
- All stub methods return IngestResult shape

Use vitest. Import from '../index' and '../config'.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/package.json && test -f ${GITHUB_ADAPTER_REPO}/tsconfig.json && test -f ${GITHUB_ADAPTER_REPO}/vitest.config.ts && test -f ${GITHUB_ADAPTER_REPO}/src/index.ts && test -f ${GITHUB_ADAPTER_REPO}/src/types.ts && test -f ${GITHUB_ADAPTER_REPO}/src/config.ts && test -f ${GITHUB_ADAPTER_REPO}/src/__tests__/scaffold.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review all scaffold files at ${GITHUB_ADAPTER_REPO}/src/:
- index.ts, types.ts, config.ts, __tests__/scaffold.test.ts
- Also check package.json, tsconfig.json, vitest.config.ts

Verify:
- GitHubAdapter properly extends IntegrationAdapter
- All types are exported
- Tests cover the basic contract
- No circular imports
- Package config is correct

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('GitHub scaffold:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
