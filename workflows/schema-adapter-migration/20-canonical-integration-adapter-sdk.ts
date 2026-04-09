/**
 * Workflow 20: Canonical IntegrationAdapter + SchemaAdapter promoted to @relayfile/sdk.
 *
 * Phase:        1  Foundation
 * Depends on:   none — campaign entry point
 * Parallel with:none — every later workflow imports from the new SDK surface
 * Packages:     relayfile/packages/sdk, relayfile-adapters/packages/core,
 *               relayfile-adapters/packages/github, relayfile-adapters/packages/slack,
 *               relayfile-adapters/packages/linear, relayfile-adapters/packages/notion,
 *               relayfile-adapters/packages/gitlab
 *
 * Promotes the abstract `IntegrationAdapter` class (currently embedded inside
 * `relayfile-adapters/packages/core/src/runtime/schema-adapter.ts`) plus its
 * supporting interfaces to the published `@relayfile/sdk` TypeScript package,
 * so that every downstream adapter, the sage bridge, and the CLI can do
 * `import { IntegrationAdapter } from '@relayfile/sdk'`. The abstract-class
 * duplications scattered through each adapter package's `types.ts` /
 * `<provider>-adapter.ts` are removed in parallel and replaced with imports
 * from the SDK. `adapter-core` keeps a runtime back-compat re-export so sage's
 * lazy-loaded imports continue to resolve during the campaign. The concrete
 * `SchemaAdapter` class stays in adapter-core untouched — workflow 22 owns
 * that move. No behavior change. Gated by `tsc` builds in @relayfile/sdk,
 * @relayfile/adapter-core, and every touched adapter package.
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/20-canonical-integration-adapter-sdk.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels } from '@agent-relay/config';

const SCHEMA_ADAPTER_SRC =
  'relayfile-adapters/packages/core/src/runtime/schema-adapter.ts';
const ADAPTER_CORE_INDEX = 'relayfile-adapters/packages/core/src/index.ts';
const SDK_INTEGRATION_ADAPTER =
  'relayfile/packages/sdk/typescript/src/integration-adapter.ts';
const SDK_INDEX = 'relayfile/packages/sdk/typescript/src/index.ts';

const GITHUB_TYPES = 'relayfile-adapters/packages/github/src/types.ts';
const SLACK_ADAPTER = 'relayfile-adapters/packages/slack/src/slack-adapter.ts';
const LINEAR_ADAPTER =
  'relayfile-adapters/packages/linear/src/linear-adapter.ts';
const NOTION_ADAPTER = 'relayfile-adapters/packages/notion/src/adapter.ts';
const GITLAB_TYPES = 'relayfile-adapters/packages/gitlab/src/types.ts';

const PLAN_PATH =
  'relayfile-adapters/workflows/schema-adapter-migration/PLAN_20.md';
const REVIEW_PATH =
  'relayfile-adapters/workflows/schema-adapter-migration/REVIEW_20.md';

const STANDARD_DENY = [
  '.env',
  '.env.*',
  '**/*.secret',
  '**/node_modules/**',
];

// `git diff --quiet` exits 0 when nothing changed, 1 when modified. We invert
// it to fail-fast on unmodified target files. relayfile/ and relayfile-adapters/
// are independent git repos, so we scope `git -C` to the right subrepo and
// pass the path repo-relative from there.
const diffGate = (subrepo: string, repoRelativePath: string): string =>
  `if git -C ${subrepo} diff --quiet -- ${repoRelativePath}; then echo "NOT MODIFIED: ${subrepo}/${repoRelativePath}"; exit 1; fi`;

async function main() {
  const result = await workflow('20-canonical-integration-adapter-sdk')
    .description(
      'Promote the canonical IntegrationAdapter abstract class to @relayfile/sdk, migrate adapter-core to extend it, prove the SDK contract via a regression-build of the 5 untouched hand-coded adapter packages. Per-adapter migration is Phase 3 work.',
    )
    .pattern('dag')
    .channel('wf-20-canonical-integration-adapter-sdk')
    .maxConcurrency(6)
    .timeout(7_200_000) // 2h — code movement + 5 parallel dedup edits + tsc gates

    // Packages touched (load-bearing for wave planners — see JSDoc header):
    //   relayfile/packages/sdk, relayfile-adapters/packages/core,
    //   relayfile-adapters/packages/{github,slack,linear,notion,gitlab}

    // ─── Agents ─────────────────────────────────────────────

    .agent('claude-lead', {
      cli: 'claude',
      role: 'Planner and channel coordinator. Reads schema-adapter, drafts migration plan, supervises workers. Does not edit source files.',
      preset: 'lead',
      model: ClaudeModels.OPUS,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            'skills/skills/writing-agent-relay-workflows/**',
            'relayfile-adapters/workflows/schema-adapter-migration/**',
            'relayfile-adapters/packages/**',
            'relayfile/packages/sdk/**',
          ],
          write: [PLAN_PATH],
          deny: STANDARD_DENY,
        },
        exec: [],
      },
    })

    .agent('codex-impl-sdk', {
      cli: 'codex',
      role: 'Creates the canonical IntegrationAdapter file inside @relayfile/sdk and updates the SDK barrel export. Owns SDK source files only.',
      preset: 'worker',
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            'relayfile-adapters/packages/core/src/runtime/schema-adapter.ts',
            'relayfile-adapters/packages/core/src/spec/**',
            'relayfile/packages/sdk/typescript/src/**',
            'skills/skills/writing-agent-relay-workflows/**',
            PLAN_PATH,
          ],
          write: [SDK_INTEGRATION_ADAPTER, SDK_INDEX],
          deny: STANDARD_DENY,
        },
        exec: [],
      },
    })

    .agent('codex-impl-adapter-core', {
      cli: 'codex',
      role: 'Rewires relayfile-adapters/packages/core to re-export IntegrationAdapter (runtime value) from @relayfile/sdk. Owns adapter-core source only.',
      preset: 'worker',
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            'relayfile-adapters/packages/core/src/**',
            'relayfile/packages/sdk/typescript/src/**',
            'skills/skills/writing-agent-relay-workflows/**',
            PLAN_PATH,
          ],
          write: [SCHEMA_ADAPTER_SRC, ADAPTER_CORE_INDEX],
          deny: STANDARD_DENY,
        },
        exec: [],
      },
    })

    // No dedup workers for the 5 hand-coded adapter packages (github, slack,
    // linear, notion, gitlab) in this workflow. Earlier versions of workflow
    // 20 tried to delete the per-package `abstract class IntegrationAdapter`
    // and replace it with an import from @relayfile/sdk, but those classes
    // are NOT actually duplicates — they encode subtly different contracts
    // (different constructor signatures, different protected fields, different
    // SyncResult/WritebackResult return types). Forcing one canonical base
    // on all of them broke every concrete subclass. See DECISIONS_20.md for
    // full analysis. The narrower scope here: define the canonical base in
    // the SDK, migrate adapter-core (which IS aligned with the canonical
    // shape), and prove via a regression-build step that the 5 hand-coded
    // adapters still build untouched. Their per-adapter migration is Phase 3
    // work (workflows 30-35), where each adapter gets its own judgment call.

    // Reviewer is `restricted` (not `readonly` as TEMPLATE.md §7 suggests)
    // because it must persist its verdict to REVIEW_20.md so the downstream
    // deterministic gate can grep it without shell-injection risk from
    // chaining agent stdout through a `printf`. Write scope is exactly one
    // file. This is a documented deviation per the TEMPLATE.md preamble.
    //
    // Read scope is intentionally minimal: every file under review is
    // pre-read by `bundle-review-context` and injected via
    // `{{steps.bundle-review-context.output}}`, so the reviewer never opens
    // the source tree itself. PLAN_PATH is kept so the reviewer can sanity-
    // check the plan against the diff without re-reading the codebase.
    .agent('codex-reviewer', {
      cli: 'codex',
      role: 'Diff reviewer. Confirms SDK exports match the original abstract shape, no behavior drift, no stale relative imports remain. Writes a one-line verdict to REVIEW_20.md.',
      preset: 'reviewer',
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [PLAN_PATH],
          write: [REVIEW_PATH],
          deny: STANDARD_DENY,
        },
        exec: [],
      },
    })

    // ─── Phase A: Plan + read source ────────────────────────

    .step('plan-migration', {
      agent: 'claude-lead',
      task: `Read ${SCHEMA_ADAPTER_SRC} and the workflow-20 entry in
relayfile-adapters/workflows/schema-adapter-migration/BACKLOG.md.

Write a short migration plan to ${PLAN_PATH} (under 60 lines) covering:
1. Exact public surface ${SDK_INTEGRATION_ADAPTER} must export
   (abstract members + optional supportedEvents / writeBack / sync).
2. Symbols adapter-core re-exports for back-compat (runtime class included).
3. The five duplicate-class files to delete and one dedicated dedup worker
   per file (github, slack, linear, notion, gitlab).

IMPORTANT: Write the file to disk. Do NOT output to stdout.
Do NOT edit any source files. Planning only.`,
      verification: { type: 'file_exists', value: PLAN_PATH },
    })

    .step('read-schema-adapter', {
      type: 'deterministic',
      command: `cat ${SCHEMA_ADAPTER_SRC}`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── Phase B: Create the SDK file ───────────────────────

    .step('write-sdk-integration-adapter', {
      agent: 'codex-impl-sdk',
      dependsOn: ['plan-migration', 'read-schema-adapter'],
      task: `Create ${SDK_INTEGRATION_ADAPTER}. Source schema-adapter.ts:

{{steps.read-schema-adapter.output}}

Move the abstract class plus supporting interfaces verbatim — no behavior
changes. Export: \`abstract class IntegrationAdapter\` (ingestWebhook,
computePath, computeSemantics, optional supportedEvents?, optional
writeBack?, optional sync? with SyncOptions/SyncResult interfaces in this
same file), plus AdapterWebhook, AdapterWebhookMetadata, IngestError,
IngestResult. Use relative \`./connection.js\` / \`./types.js\` imports for
sibling SDK files. Do NOT include the concrete SchemaAdapter class — that
move belongs to a later workflow.

IMPORTANT: Write the file to disk. Do NOT output to stdout.
Only edit ${SDK_INTEGRATION_ADAPTER}.`,
      verification: { type: 'file_exists', value: SDK_INTEGRATION_ADAPTER },
    })

    // SDK_INDEX has no real data dependency on write-sdk-integration-adapter
    // — the file already exists and the read is just preparing context for
    // the update. Pull it forward so the read is off the critical path; the
    // update step still gates on the new file existing.
    .step('read-sdk-index', {
      type: 'deterministic',
      dependsOn: ['plan-migration'],
      command: `cat ${SDK_INDEX}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('update-sdk-index', {
      agent: 'codex-impl-sdk',
      dependsOn: ['read-sdk-index', 'write-sdk-integration-adapter'],
      task: `Update ${SDK_INDEX}. Current contents:
{{steps.read-sdk-index.output}}

Add \`export * from './integration-adapter.js';\` (preserve the .js
extension — package is "type": "module"). Do not remove or reorder existing
exports. Only edit ${SDK_INDEX}.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-sdk-index', {
      type: 'deterministic',
      dependsOn: ['update-sdk-index'],
      command: `${diffGate('relayfile', 'packages/sdk/typescript/src/index.ts')} && grep -q "integration-adapter" ${SDK_INDEX}`,
      failOnError: true,
    })

    // ─── Phase C: Rewire adapter-core ───────────────────────

    .step('read-adapter-core-schema', {
      type: 'deterministic',
      dependsOn: ['verify-sdk-index'],
      command: `cat ${SCHEMA_ADAPTER_SRC}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('update-adapter-core-schema', {
      agent: 'codex-impl-adapter-core',
      dependsOn: ['read-adapter-core-schema'],
      task: `Rewire ${SCHEMA_ADAPTER_SRC}. Current contents:
{{steps.read-adapter-core-schema.output}}

Delete the local \`abstract class IntegrationAdapter\` and the local
AdapterWebhook / AdapterWebhookMetadata / IngestError / IngestResult
interfaces. Add \`import { IntegrationAdapter } from '@relayfile/sdk';\`
plus \`import type { AdapterWebhook, AdapterWebhookMetadata, IngestError,
IngestResult } from '@relayfile/sdk';\`. Re-export the runtime class with
\`export { IntegrationAdapter } from '@relayfile/sdk';\` and the pure types
with \`export type { AdapterWebhook, AdapterWebhookMetadata, IngestError,
IngestResult } from '@relayfile/sdk';\`. KEEP the concrete SchemaAdapter
class and helpers exactly as-is. Only edit ${SCHEMA_ADAPTER_SRC}.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-adapter-core-schema', {
      type: 'deterministic',
      dependsOn: ['update-adapter-core-schema'],
      command: `${diffGate('relayfile-adapters', 'packages/core/src/runtime/schema-adapter.ts')} && grep -q "@relayfile/sdk" ${SCHEMA_ADAPTER_SRC} && ! grep -Eq "^(export )?abstract class IntegrationAdapter" ${SCHEMA_ADAPTER_SRC}`,
      failOnError: true,
    })

    // ADAPTER_CORE_INDEX read has no data dependency on the schema-adapter
    // edit — both files just happen to be owned by adapter-core. Pull the
    // read forward; the update step still waits on verify-adapter-core-schema
    // so the new SDK re-export lands after the schema rewire.
    .step('read-adapter-core-index', {
      type: 'deterministic',
      dependsOn: ['plan-migration'],
      command: `cat ${ADAPTER_CORE_INDEX}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('update-adapter-core-index', {
      agent: 'codex-impl-adapter-core',
      dependsOn: ['read-adapter-core-index', 'verify-adapter-core-schema'],
      task: `Update ${ADAPTER_CORE_INDEX}. Current contents:
{{steps.read-adapter-core-index.output}}

Add a runtime re-export of the abstract class:
  \`export { IntegrationAdapter } from '@relayfile/sdk';\`
And a type-only re-export of the supporting types:
  \`export type { AdapterWebhook, AdapterWebhookMetadata, IngestError,
  IngestResult } from '@relayfile/sdk';\`
Do not remove or reorder existing exports — additive only. Only edit
${ADAPTER_CORE_INDEX}.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-adapter-core-index', {
      type: 'deterministic',
      dependsOn: ['update-adapter-core-index'],
      command: `${diffGate('relayfile-adapters', 'packages/core/src/index.ts')} && grep -q "@relayfile/sdk" ${ADAPTER_CORE_INDEX}`,
      failOnError: true,
    })

    // ─── Phase D: Build gates after the foundation ──────────

    .step('build-sdk', {
      type: 'deterministic',
      dependsOn: ['verify-sdk-index'],
      command: '(cd relayfile/packages/sdk/typescript && npm run build)',
      failOnError: true,
    })

    .step('build-adapter-core', {
      type: 'deterministic',
      dependsOn: ['verify-adapter-core-index', 'build-sdk'],
      command: '(cd relayfile-adapters/packages/core && npm run build)',
      failOnError: true,
    })

    // ─── Phase E: Regression guard for untouched adapters ──
    // The 5 hand-coded adapter packages (github, slack, linear, notion,
    // gitlab) are NOT migrated in this workflow — their migration is Phase 3
    // work. This step builds all 5 against the migrated adapter-core and the
    // new SDK export to prove we haven't introduced a cross-package
    // regression. If any of them fails to build, the SDK contract or the
    // adapter-core migration has broken something the 5 adapters depend on,
    // and we need to widen the SDK shape before proceeding.

    .step('regression-build-adapters', {
      type: 'deterministic',
      dependsOn: ['build-adapter-core'],
      command: 'for pkg in github slack linear notion gitlab; do echo "=== building @relayfile/adapter-$pkg ==="; (cd relayfile-adapters/packages/$pkg && npm run build) || { echo "REGRESSION: $pkg failed to build"; exit 1; }; done && echo "REGRESSION_GUARD_PASS"',
      captureOutput: true,
      failOnError: true,
    })

    // ─── Phase G: Independent peer review (pre-injected) ────
    // Reviewer is non-interactive — every reviewed file is pre-read by a
    // deterministic step and injected, per TEMPLATE.md §8d / mistake #22.
    // Verdict is written to REVIEW_20.md and gated with file_exists, avoiding
    // the verification-token double-match gotcha (mistake #6).

    // Reviewer bundle: pre-injected diffs only, not full file contents.
    // The new SDK file is shown in full because `git diff` won't render an
    // untracked file without mutating the index; everything else is captured
    // as a focused unified diff against HEAD. This keeps the reviewer's
    // context tight enough to honour the skill's "one agent, one
    // deliverable" / bounded-prompt guidance.
    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: ['regression-build-adapters'],
      command: `printf '=== NEW FILE: %s ===\\n' ${SDK_INTEGRATION_ADAPTER} && cat ${SDK_INTEGRATION_ADAPTER} && printf '\\n=== relayfile (sdk) diff ===\\n' && git -C relayfile diff -- packages/sdk/typescript/src/index.ts && printf '\\n=== relayfile-adapters diff ===\\n' && git -C relayfile-adapters diff -- packages/core/src/runtime/schema-adapter.ts packages/core/src/index.ts`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-migration', {
      agent: 'codex-reviewer',
      dependsOn: ['bundle-review-context'],
      task: `Independent diff review of workflow 20 (narrow scope: SDK + adapter-core only).
Reviewed bundle (new SDK file in full + unified diffs of touched files):
{{steps.bundle-review-context.output}}

Confirm:
(1) The canonical IntegrationAdapter abstract class exists in the SDK file
    with the shape needed by SchemaAdapter (client + provider constructor,
    the ingestWebhook/computePath/computeSemantics abstract methods,
    optional supportedEvents/writeBack/sync).
(2) SDK index.ts re-exports it as a runtime value, not type-only.
(3) adapter-core schema-adapter.ts imports IntegrationAdapter from
    @relayfile/sdk and no longer defines its local abstract class.
(4) adapter-core index.ts re-exports the class for back-compat consumers.
(5) The 5 hand-coded adapter packages (github/slack/linear/notion/gitlab)
    are UNTOUCHED — no diff should appear for them in the bundle above.
    They keep their own local IntegrationAdapter classes; migration is
    Phase 3 work.
(6) regression-build-adapters succeeded (if we got this far, it did) —
    confirming the SDK contract is non-breaking for the untouched adapters.

IMPORTANT: Write the file to disk. Do NOT output to stdout.
Write your verdict to ${REVIEW_PATH}. The first line MUST be exactly
\`approved\` (lowercase, on its own), or a line starting with \`blocked:\`
followed by a short bullet list of issues. A deterministic grep on that
first line is the downstream gate.`,
      verification: { type: 'file_exists', value: REVIEW_PATH },
    })

    .step('gate-review-verdict', {
      type: 'deterministic',
      dependsOn: ['review-migration'],
      command: `test -s ${REVIEW_PATH} && head -n 1 ${REVIEW_PATH} | grep -Eq "^approved$"`,
      failOnError: true,
    })

    .onError('fail-fast')
    .run({ cwd: process.cwd() });

  console.log('Result:', result.status);
  console.log('WORKFLOW_20_COMPLETE');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
