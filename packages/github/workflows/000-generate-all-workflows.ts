/**
 * 000-generate-all-workflows.ts
 *
 * Meta-workflow: Uses Claude architects + Codex builders to generate
 * all 45 workflow files across the relayfile plugin ecosystem repos.
 *
 * Repos:
 *   @relayfile/sdk         → AgentWorkforce/relayfile (existing)
 *   @relayfile/provider-*  → AgentWorkforce/relayfile-provider-{nango,composio,apikey}
 *   @relayfile/adapter-*   → AgentWorkforce/relayfile-adapter-{github,slack,linear}
 *
 * Run: agent-relay run workflows/000-generate-all-workflows.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const REPOS = {
  SDK: '/Users/khaliqgant/Projects/AgentWorkforce-relayfile',
  CLOUD: '/Users/khaliqgant/Projects/AgentWorkforce/cloud/packages/relayfile',
  AUTH: '/Users/khaliqgant/Projects/AgentWorkforce/relayauth',
  GITHUB_ADAPTER: '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github',
  SLACK_ADAPTER: '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-slack',
  LINEAR_ADAPTER: '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-linear',
  NANGO_PROVIDER: '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango',
  COMPOSIO_PROVIDER: '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-composio',
  APIKEY_PROVIDER: '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-apikey',
};

const SPEC = `${REPOS.GITHUB_ADAPTER}/docs/adapter-spec.md`;

const RULES = `RULES for every workflow file:
1. import { workflow } from '@agent-relay/sdk/workflows';
2. Wrap in async function main() { ... } main().catch(console.error);
3. End with .run({ cwd: process.cwd() });
4. Max 6-8 steps, max concurrency 4-5
5. Task prompts under 20 lines, "Keep output under 50 lines" on planning/review
6. verification: { type: 'exit_code' } for code-editing, { type: 'output_contains', value: 'NAME_COMPLETE' } for planning
7. preset: 'worker' for codex, no preset for claude
8. Channel: 'wf-relayfile-{name}', pattern: 'dag', timeout: 3_600_000
9. Deterministic steps for git/file ops, file_exists after creation
10. Define repo path constants at top of each file`;

async function main() {
const result = await workflow('generate-all-workflows')
  .description('Generate 45 workflows across 8 relayfile plugin ecosystem repos')
  .pattern('dag')
  .channel('wf-generate-workflows')
  .maxConcurrency(5)
  .timeout(7_200_000)

  .agent('architect', { cli: 'claude', role: 'Designs workflow specs per phase' })
  .agent('sdk-builder', { cli: 'codex', preset: 'worker', role: 'Writes SDK plugin interface workflows (Phase 1)' })
  .agent('provider-builder', { cli: 'codex', preset: 'worker', role: 'Writes provider workflows (Phase 2)' })
  .agent('adapter-builder', { cli: 'codex', preset: 'worker', role: 'Writes GitHub adapter workflows (Phase 3)' })
  .agent('review-builder', { cli: 'codex', preset: 'worker', role: 'Writes review integration + ecosystem workflows (Phase 4-5)' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews all workflows for correctness' })

  // ── Design Phase ──

  .step('design-all', {
    agent: 'architect',
    task: `Read ${SPEC}.

Design all 45 workflow specs organized by phase and target repo.

Phase 1 (001-010): SDK Plugin Interface → write to ${REPOS.SDK}/workflows/
  001-adapter-plugin-types: ConnectionProvider + IntegrationAdapter interfaces
  002-adapter-registry: registerAdapter() + routeWebhook() on RelayFileClient
  003-webhook-normalization: NormalizedWebhook converter
  004-adapter-test-helpers: mock provider, mock adapter, fixtures
  005-adapter-cli-scaffold: create-relayfile-adapter CLI scaffolder
  006-plugin-loader: discover @relayfile/adapter-* from node_modules
  007-adapter-validation: runtime contract validation
  008-plugin-events: lifecycle events (registered, ingested, error)
  009-plugin-config-schema: JSON Schema for adapter/provider configs
  010-plugin-system-e2e: register mock adapter → route webhook → verify file

Phase 2 (011-018): Nango Provider → write to ${REPOS.NANGO_PROVIDER}/workflows/
  011-nango-scaffold: package setup + NangoProvider class
  012-nango-proxy: proxy() implementation via Nango proxy API
  013-nango-webhook: handleWebhook() normalization
  014-nango-health: healthCheck() + connection listing
  015-nango-token-refresh: automatic token refresh handling
  016-nango-connection-list: list active connections
  017-nango-test-fixtures: mock Nango responses for testing
  018-nango-provider-e2e: full provider E2E test

Phase 3 (019-030): GitHub Adapter → write to ${REPOS.GITHUB_ADAPTER}/workflows/
  019-github-scaffold: package + GitHubAdapter class
  020-github-pr-ingestion: ingest PR metadata + files + diff
  021-github-commit-mapping: commits → /pulls/{n}/commits/{sha}.json
  022-github-file-content: fetch file contents via provider.proxy()
  023-github-file-semantics: FileSemantics mapping (properties, relations)
  024-github-review-mapping: PR reviews + comments
  025-github-check-runs: CI check run mapping
  026-github-issue-mapping: issues + issue comments
  027-github-webhook-router: route events to correct ingest method
  028-github-diff-parser: parse unified diffs to per-file patches
  029-github-bulk-ingest: bulk write all PR files
  030-github-adapter-e2e: full adapter E2E test

Phase 4 (031-038): Review Integration → write to ${REPOS.GITHUB_ADAPTER}/workflows/
  031-review-workspace-lifecycle: create on PR open, update on push, archive on close
  032-review-scoped-tokens: mint read-only relayauth tokens per PR
  033-review-agent-dispatch: spawn review agents with tokens
  034-review-writeback: write comments back to GitHub
  035-review-orchestrator: full webhook → workspace → review → writeback flow
  036-review-concurrent-prs: workspace isolation for parallel reviews
  037-review-comment-threading: threaded review comments
  038-review-status-checks: update GitHub commit status from review results

Phase 5 (039-045): Ecosystem → write to respective repos
  039-composio-provider-scaffold: ${REPOS.COMPOSIO_PROVIDER}/workflows/
  040-apikey-provider-scaffold: ${REPOS.APIKEY_PROVIDER}/workflows/
  041-slack-adapter-scaffold: ${REPOS.SLACK_ADAPTER}/workflows/
  042-linear-adapter-scaffold: ${REPOS.LINEAR_ADAPTER}/workflows/
  043-adapter-publish-pipeline: ${REPOS.GITHUB_ADAPTER}/workflows/ (CI/CD for all adapters)
  044-adapter-telemetry: ${REPOS.GITHUB_ADAPTER}/workflows/ (OpenTelemetry)
  045-full-system-e2e: ${REPOS.GITHUB_ADAPTER}/workflows/ (complete flow test)

For each workflow, output: filename, target repo, 2-line description, agent names + CLI, step names + deps.
${RULES}

Keep output under 150 lines. End with DESIGN_ALL_COMPLETE.`,
    verification: { type: 'output_contains', value: 'DESIGN_ALL_COMPLETE' },
    timeout: 300_000,
  })

  // ── Build Phase (4 builders in parallel) ──

  .step('build-sdk-plugins', {
    agent: 'sdk-builder',
    dependsOn: ['design-all'],
    task: `Write 10 workflow files for Phase 1 (SDK Plugin Interface).
Target: ${REPOS.SDK}/workflows/ (create dir if needed)

Spec: {{steps.design-all.output}}

Files: 001-adapter-plugin-types.ts through 010-plugin-system-e2e.ts

These workflows will add ConnectionProvider, IntegrationAdapter, AdapterRegistry to the existing @relayfile/sdk.
Reference existing code at ${REPOS.SDK}/packages/relayfile-sdk/src/provider.ts for current IntegrationProvider class.
${RULES}

Write ALL 10 files to disk in ${REPOS.SDK}/workflows/.
End with BUILD_SDK_COMPLETE.`,
    verification: { type: 'output_contains', value: 'BUILD_SDK_COMPLETE' },
    timeout: 900_000,
  })

  .step('build-nango-provider', {
    agent: 'provider-builder',
    dependsOn: ['design-all'],
    task: `Write 8 workflow files for Phase 2 (Nango Provider).
Target: ${REPOS.NANGO_PROVIDER}/workflows/ (create dir if needed)

Spec: {{steps.design-all.output}}

Files: 011-nango-scaffold.ts through 018-nango-provider-e2e.ts

These workflows build @relayfile/provider-nango that implements ConnectionProvider interface.
Uses Nango's proxy API for authenticated requests, webhook normalization, health checks.
${RULES}

Write ALL 8 files to disk in ${REPOS.NANGO_PROVIDER}/workflows/.
End with BUILD_NANGO_COMPLETE.`,
    verification: { type: 'output_contains', value: 'BUILD_NANGO_COMPLETE' },
    timeout: 900_000,
  })

  .step('build-github-adapter', {
    agent: 'adapter-builder',
    dependsOn: ['design-all'],
    task: `Write 20 workflow files for Phase 3+4 (GitHub Adapter + Review Integration).
Target: ${REPOS.GITHUB_ADAPTER}/workflows/ (create dir if needed)

Spec: {{steps.design-all.output}}

Files: 019-github-scaffold.ts through 038-review-status-checks.ts

These workflows build @relayfile/adapter-github that extends IntegrationAdapter.
Maps GitHub PRs/issues/commits/reviews to relayfile VFS.
Review integration: workspace lifecycle, scoped tokens, agent dispatch, writeback.
${RULES}

Write ALL 20 files to disk in ${REPOS.GITHUB_ADAPTER}/workflows/.
End with BUILD_GITHUB_COMPLETE.`,
    verification: { type: 'output_contains', value: 'BUILD_GITHUB_COMPLETE' },
    timeout: 900_000,
  })

  .step('build-ecosystem', {
    agent: 'review-builder',
    dependsOn: ['design-all'],
    task: `Write 7 workflow files for Phase 5 (Ecosystem).

Spec: {{steps.design-all.output}}

Write each to its target repo:
039-composio-provider-scaffold.ts → ${REPOS.COMPOSIO_PROVIDER}/workflows/
040-apikey-provider-scaffold.ts → ${REPOS.APIKEY_PROVIDER}/workflows/
041-slack-adapter-scaffold.ts → ${REPOS.SLACK_ADAPTER}/workflows/
042-linear-adapter-scaffold.ts → ${REPOS.LINEAR_ADAPTER}/workflows/
043-adapter-publish-pipeline.ts → ${REPOS.GITHUB_ADAPTER}/workflows/
044-adapter-telemetry.ts → ${REPOS.GITHUB_ADAPTER}/workflows/
045-full-system-e2e.ts → ${REPOS.GITHUB_ADAPTER}/workflows/
${RULES}

Write ALL 7 files to disk in their respective repos.
End with BUILD_ECOSYSTEM_COMPLETE.`,
    verification: { type: 'output_contains', value: 'BUILD_ECOSYSTEM_COMPLETE' },
    timeout: 900_000,
  })

  // ── Review + Commit ──

  .step('review-all', {
    agent: 'reviewer',
    dependsOn: ['build-sdk-plugins', 'build-nango-provider', 'build-github-adapter', 'build-ecosystem'],
    task: `Review all 45 workflow files across repos:
- ${REPOS.SDK}/workflows/ (10 files)
- ${REPOS.NANGO_PROVIDER}/workflows/ (8 files)
- ${REPOS.GITHUB_ADAPTER}/workflows/ (20 files + spec)
- ${REPOS.COMPOSIO_PROVIDER}/workflows/ (1 file)
- ${REPOS.APIKEY_PROVIDER}/workflows/ (1 file)
- ${REPOS.SLACK_ADAPTER}/workflows/ (1 file)
- ${REPOS.LINEAR_ADAPTER}/workflows/ (1 file)

Verify: CJS require, async main, .run(), max 8 steps, proper verification, no deadlocks.
Count total files. Fix any issues.
Keep output under 60 lines. End with REVIEW_ALL_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_ALL_COMPLETE' },
    timeout: 600_000,
  })

  .step('commit-all', {
    agent: 'sdk-builder',
    dependsOn: ['review-all'],
    task: `Commit all workflow files across all repos:

for repo in "${REPOS.SDK}" "${REPOS.NANGO_PROVIDER}" "${REPOS.GITHUB_ADAPTER}" "${REPOS.COMPOSIO_PROVIDER}" "${REPOS.APIKEY_PROVIDER}" "${REPOS.SLACK_ADAPTER}" "${REPOS.LINEAR_ADAPTER}"; do
  cd "$repo"
  git add workflows/ docs/ 2>/dev/null
  git diff --cached --quiet || git commit -m "feat: add relayfile plugin ecosystem workflows"
done

Report total files committed per repo. End with COMMIT_ALL_COMPLETE.`,
    verification: { type: 'output_contains', value: 'COMMIT_ALL_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('All workflows generated:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
