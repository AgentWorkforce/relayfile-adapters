/**
 * Meta-workflow 00b: Draft Phase 1 workflows 21-24.
 *
 * Phase:        1 — Foundation
 * Depends on:   00 (TEMPLATE.md + BACKLOG.md must exist and reflect the
 *               revised Phase 3 strategy), 20 (canonical IntegrationAdapter
 *               must be shipped and committed so SchemaAdapter.sync can be
 *               implemented against it in workflow 22)
 * Parallel with:none (sequential with 00, 20, then the 4 target workflows)
 * Packages:     relayfile-adapters/workflows/schema-adapter-migration/
 *
 * Produces four new workflow files:
 *   21-mapping-spec-pagination.ts       — extend MappingSpec with declarative
 *                                         pagination + sync resource config
 *   22-schema-adapter-sync.ts           — implement SchemaAdapter.sync() as a
 *                                         generic paginator over provider.proxy()
 *   23-round-trip-test-harness.ts       — OpenAPI -> mapping -> sync -> VFS
 *                                         round-trip test harness
 *   24-nango-unauth-provider.ts         — @relayfile/provider-nango-unauth
 *                                         package with metadata-based creds
 *
 * Design:
 * - Four parallel codex-author drafts (all share dependsOn on pre-inject steps)
 * - Four deterministic dry-run gates (parallel)
 * - One batch review by codex-reviewer with all 4 drafts pre-injected
 * - One deterministic gate on the verdict file
 *
 * No self-reflection / revise loops per target workflow. TEMPLATE.md is
 * mature enough after workflow 20 that the drafts should land close to
 * correct; the dry-run gates catch syntax/validation bugs, and the batch
 * review catches authoring mistakes. If any draft fails review, the
 * campaign halts and a human iterates on the draft directly.
 *
 * "Mostly done by codex" — only the existing meta-workflow (00) needed
 * claude-lead for the research step. This meta-workflow (00b) uses codex
 * for everything: drafting, validation, review. Research is already
 * captured in RESEARCH.md + BACKLOG.md from 00's successful run.
 *
 * Run from the AgentWorkforce root:
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/00b-generate-phase-1-rest.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const WF_DIR = 'relayfile-adapters/workflows/schema-adapter-migration';
const TEMPLATE_PATH = `${WF_DIR}/TEMPLATE.md`;
const BACKLOG_PATH = `${WF_DIR}/BACKLOG.md`;
const WF_21 = `${WF_DIR}/21-mapping-spec-pagination.ts`;
const WF_22 = `${WF_DIR}/22-schema-adapter-sync.ts`;
const WF_23 = `${WF_DIR}/23-round-trip-test-harness.ts`;
const WF_24 = `${WF_DIR}/24-nango-unauth-provider.ts`;
const BATCH_REVIEW_PATH = `${WF_DIR}/BATCH_REVIEW_21-24.md`;

const DRAFT_CONSTRAINTS = `
IMPORTANT — violations cause step failure:
- You may ONLY write the single target workflow file listed in your task.
- Do NOT run any shell command (no tsc, tsx, agent-relay, npm, git, node).
- Do NOT spawn nested workflows. Do NOT run agent-relay.
- Write the file FIRST, before any other action.
- Preserve the TEMPLATE.md conventions exactly (ESM imports, async main() footer, .run({cwd: process.cwd()}), preset selection, permission scoping, common mistakes checklist).
- Use codex as the primary implementer for bounded work; only use claude-lead when a step inherently needs wide file reads or channel coordination.
- IMPORTANT: Write the file to disk. Do NOT output to stdout.`;

async function main() {
  const result = await workflow('schema-adapter-gen-00b')
    .description(
      'Meta-workflow: draft Phase 1 workflows 21-24 in parallel, dry-run each, batch-review with codex. Template-driven, no per-workflow revise loops.',
    )
    .pattern('dag')
    .channel('wf-schema-adapter-gen-00b')
    .maxConcurrency(5)
    .timeout(3_600_000) // 1h — 4 parallel drafts + 4 dry-runs + 1 batch review

    // ─── Agents ─────────────────────────────────────────────

    .agent('codex-author', {
      cli: 'codex',
      role: 'Bounded non-interactive author — drafts a single workflow file from pre-injected TEMPLATE.md + BACKLOG.md. Worker preset enforces one-shot bounded execution.',
      preset: 'worker',
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            'relayfile-adapters/workflows/schema-adapter-migration/**',
            'skills/skills/writing-agent-relay-workflows/**',
            'sage/workflows/**',
          ],
          write: [
            'relayfile-adapters/workflows/schema-adapter-migration/21-*.ts',
            'relayfile-adapters/workflows/schema-adapter-migration/22-*.ts',
            'relayfile-adapters/workflows/schema-adapter-migration/23-*.ts',
            'relayfile-adapters/workflows/schema-adapter-migration/24-*.ts',
          ],
          deny: ['.env', '.env.*', '**/*.secret', '**/node_modules/**'],
        },
        exec: [],
      },
    })

    .agent('codex-reviewer', {
      cli: 'codex',
      role: 'Batch peer reviewer — receives all 4 drafted workflow files pre-injected, writes a single BATCH_REVIEW_21-24.md verdict.',
      preset: 'reviewer',
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            'relayfile-adapters/workflows/schema-adapter-migration/**',
          ],
          write: [
            'relayfile-adapters/workflows/schema-adapter-migration/BATCH_REVIEW_*.md',
          ],
          deny: [],
        },
        exec: [],
      },
    })

    // ─── Phase 1: Pre-inject template + backlog ─────────────

    .step('read-template', {
      type: 'deterministic',
      command: `cat ${TEMPLATE_PATH}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-backlog', {
      type: 'deterministic',
      command: `cat ${BACKLOG_PATH}`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── Phase 2: Draft 4 workflows in parallel ─────────────

    .step('draft-21', {
      agent: 'codex-author',
      dependsOn: ['read-template', 'read-backlog'],
      task: `Draft ${WF_21}. Single deliverable, nothing else.

Target: Workflow 21 (Phase 1) — "Extend MappingSpec with declarative pagination + sync resource config".

Goal: Add a \`pagination\` field and a \`sync\` sub-object to \`ResourceMapping\` in \`relayfile-adapters/packages/core/src/spec/types.ts\`. The pagination field must support the strategies enumerated in BACKLOG workflow 21's entry (cursor, offset, page, link-header, next-token). The sync sub-object gates a resource's availability to \`SchemaAdapter.sync()\` and carries \`modelName\`, \`cursorField\`, \`checkpointKey\`. Update the spec parser (\`relayfile-adapters/packages/core/src/spec/parser.ts\`) to accept the new fields and validate them. Add unit tests in \`relayfile-adapters/packages/core/tests/\`. Add the build gate for adapter-core.

Template compliance: read BACKLOG's workflow 21 entry for the detailed file list, agents, and verification gates. Follow TEMPLATE.md exactly for: ESM footer, .run({cwd: process.cwd()}), deterministic build gates with npm (not pnpm), permission scoping, preset selection (codex-author for bounded work).

${DRAFT_CONSTRAINTS}

=== TEMPLATE.md ===
{{steps.read-template.output}}

=== BACKLOG.md ===
{{steps.read-backlog.output}}`,
      verification: { type: 'file_exists', value: WF_21 },
    })

    .step('draft-22', {
      agent: 'codex-author',
      dependsOn: ['read-template', 'read-backlog'],
      task: `Draft ${WF_22}. Single deliverable, nothing else.

Target: Workflow 22 (Phase 1) — "Implement SchemaAdapter.sync(resourceName, options) as a generic paginator over provider.proxy()".

Goal: Add a \`sync\` method to the \`SchemaAdapter\` class in \`relayfile-adapters/packages/core/src/runtime/schema-adapter.ts\` that takes a \`resourceName\` + options, looks up the resource in the mapping spec (from workflow 21), executes the declared pagination strategy against \`this.provider.proxy()\`, and writes each record to the VFS via \`this.client.writeFile\` after \`computePath\`/\`computeSemantics\`. Checkpoint state is stored in the workspace at \`.sync-state/<adapterName>/<resourceName>.json\`. Implementation must match the canonical \`SyncOptions\`/\`SyncResult\` shape exported from @relayfile/sdk/integration-adapter.ts (already shipped by workflow 20).

Tests: round-trip a mock paginator, verify records land in a test workspace.

${DRAFT_CONSTRAINTS}

=== TEMPLATE.md ===
{{steps.read-template.output}}

=== BACKLOG.md ===
{{steps.read-backlog.output}}`,
      verification: { type: 'file_exists', value: WF_22 },
    })

    .step('draft-23', {
      agent: 'codex-author',
      dependsOn: ['read-template', 'read-backlog'],
      task: `Draft ${WF_23}. Single deliverable, nothing else.

Target: Workflow 23 (Phase 1) — "Round-trip test harness (OpenAPI -> mapping -> SchemaAdapter.sync -> VFS)".

Goal: Build a reusable Vitest harness in \`relayfile-adapters/packages/core/tests/round-trip/\` that takes a vendored OpenAPI spec or recorded HTTP fixture, pipes it through the existing ingestion tooling (\`src/ingest/openapi.ts\`) to produce a \`MappingSpec\`, instantiates a \`SchemaAdapter\` against a fake \`ConnectionProvider\` that replays the fixture HTTP responses deterministically, calls \`.sync()\`, and asserts the resulting VFS writes match a golden snapshot file (JSONL with \`{path, semantics, recordHash}\` per line, sorted). This is the parity contract every Phase 3 adapter must pass.

Fixtures live at \`relayfile-adapters/packages/core/fixtures/round-trip/<api-name>/\`. Include at least one complete example (GitHub PR listing — already has a mapping YAML, can use workflow 20's migrated SchemaAdapter as the runtime).

${DRAFT_CONSTRAINTS}

=== TEMPLATE.md ===
{{steps.read-template.output}}

=== BACKLOG.md ===
{{steps.read-backlog.output}}`,
      verification: { type: 'file_exists', value: WF_23 },
    })

    .step('draft-24', {
      agent: 'codex-author',
      dependsOn: ['read-template', 'read-backlog'],
      task: `Draft ${WF_24}. Single deliverable, nothing else.

Target: Workflow 24 (Phase 1) — "@relayfile/provider-nango-unauth package with metadata-based credentials".

Goal: Create a new package \`relayfile-providers/packages/nango-unauth/\` that wraps the existing \`@relayfile/provider-nango\` in a thin subclass (\`NangoUnauthProvider\`). The wrapper targets Nango's \`unauthenticated\` integration and on every \`.proxy()\` call reads auth headers from the Nango connection metadata (\`nango.getConnection(connectionId).metadata\`) and injects them. Exposes \`setConnectionCredentials(connectionId, credentials)\` and \`refreshConnectionCredentials(connectionId, refreshFn)\` helpers. Implements the same \`ConnectionProvider\` interface from @relayfile/sdk so \`SchemaAdapter\` consumes it identically to any other provider.

Package scaffolding: package.json, tsconfig.json, src/index.ts, src/nango-unauth-provider.ts, src/__tests__/nango-unauth-provider.test.ts. Mirror the structure of \`relayfile-providers/packages/nango/\`.

${DRAFT_CONSTRAINTS}

=== TEMPLATE.md ===
{{steps.read-template.output}}

=== BACKLOG.md ===
{{steps.read-backlog.output}}`,
      verification: { type: 'file_exists', value: WF_24 },
    })

    // ─── Phase 3: Dry-run each draft in parallel ────────────

    .step('dry-run-21', {
      type: 'deterministic',
      dependsOn: ['draft-21'],
      command: `agent-relay run --dry-run ${WF_21} 2>&1 | tail -20`,
      captureOutput: true,
      failOnError: true,
    })

    .step('dry-run-22', {
      type: 'deterministic',
      dependsOn: ['draft-22'],
      command: `agent-relay run --dry-run ${WF_22} 2>&1 | tail -20`,
      captureOutput: true,
      failOnError: true,
    })

    .step('dry-run-23', {
      type: 'deterministic',
      dependsOn: ['draft-23'],
      command: `agent-relay run --dry-run ${WF_23} 2>&1 | tail -20`,
      captureOutput: true,
      failOnError: true,
    })

    .step('dry-run-24', {
      type: 'deterministic',
      dependsOn: ['draft-24'],
      command: `agent-relay run --dry-run ${WF_24} 2>&1 | tail -20`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── Phase 4: Batch peer review ─────────────────────────

    .step('read-all-drafts', {
      type: 'deterministic',
      dependsOn: ['dry-run-21', 'dry-run-22', 'dry-run-23', 'dry-run-24'],
      command: `printf '=== %s ===\\n' ${WF_21} && cat ${WF_21} && printf '\\n=== %s ===\\n' ${WF_22} && cat ${WF_22} && printf '\\n=== %s ===\\n' ${WF_23} && cat ${WF_23} && printf '\\n=== %s ===\\n' ${WF_24} && cat ${WF_24}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-template-for-review', {
      type: 'deterministic',
      dependsOn: ['dry-run-21', 'dry-run-22', 'dry-run-23', 'dry-run-24'],
      command: `cat ${TEMPLATE_PATH}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('batch-review', {
      agent: 'codex-reviewer',
      dependsOn: ['read-all-drafts', 'read-template-for-review'],
      task: `Batch review all 4 Phase 1 drafts. Single deliverable: ${BATCH_REVIEW_PATH}.

For each of the 4 workflows below, audit against TEMPLATE.md and the common-mistakes checklist (#1-#43). Flag every deviation. Structure the review with one section per workflow (21, 22, 23, 24) plus an overall verdict at the end.

IMPORTANT constraints:
- You may ONLY write ${BATCH_REVIEW_PATH}. Do not edit any workflow file.
- Do NOT run shell commands.
- Write the verdict file FIRST, before any other action.

Each section must:
1. Quote the workflow line that violates a rule
2. Cite the TEMPLATE.md section or mistake number
3. Suggest a concrete fix

End with a single-line verdict: \`approved\` (lowercase, on its own) if ALL 4 drafts pass, or \`blocked: <comma-separated list of workflow numbers with CHANGES_REQUESTED>\`. The first line of the file must be exactly that verdict — a deterministic grep on line 1 is the downstream gate.

IMPORTANT: Write the file to disk. Do NOT output to stdout.

=== TEMPLATE.md ===
{{steps.read-template-for-review.output}}

=== ALL 4 DRAFTS ===
{{steps.read-all-drafts.output}}`,
      verification: { type: 'file_exists', value: BATCH_REVIEW_PATH },
    })

    // ─── Phase 5: Gate on verdict ───────────────────────────

    .step('gate-batch-verdict', {
      type: 'deterministic',
      dependsOn: ['batch-review'],
      command: `test -s ${BATCH_REVIEW_PATH} && head -n 1 ${BATCH_REVIEW_PATH} | grep -Eq "^approved$"`,
      failOnError: true,
    })

    .onError('fail-fast')
    .run({ cwd: process.cwd() });

  console.log('Result:', result.status);
  console.log('GENERATE_PHASE_1_REST_COMPLETE');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
