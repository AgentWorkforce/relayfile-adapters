/**
 * Meta-workflow 00b: Draft Phase 1 workflows 21-24.
 *
 * Phase:        1 — Foundation
 * Depends on:   00 (TEMPLATE.md + BACKLOG.md must exist and reflect the
 *               revised Phase 3 strategy), 20 (canonical IntegrationAdapter
 *               must be shipped and committed so SchemaAdapter.sync can be
 *               implemented against it in workflow 22)
 * Parallel with:none (sequential with 00, 20, then the 4 target workflows)
 * Packages:     relayfile-adapters/workflows/schema-adapter-migration
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
import { CursorModels } from '@agent-relay/config';

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
- IMPORTANT: Write the file to disk. Do NOT output to stdout.

MANDATORY TEMPLATE RULES (every violation below caused a prior workflow to be
rejected at batch review — treat them as hard constraints):

1. EVERY agent definition MUST have a \`cli\` field set to one of
   'claude' | 'codex' | 'gemini' | 'aider' | 'goose' | 'opencode' | 'droid'.
   Missing \`cli\` causes the workflow to fail at load time with
   "each agent must have a string cli". Example:
     .agent('codex-impl', {
       cli: 'codex',            // <-- REQUIRED
       preset: 'worker',
       ...
     })

2. EVERY file-MUTATING step must be followed IMMEDIATELY by a separate
   deterministic verify step that runs:
     command: '! git -C <repo> diff --quiet -- <repo-relative-file>'
   The \`!\` is load-bearing — git diff --quiet exits 0 when the file is
   UNMODIFIED, so we need the negation. Downstream steps must depend on
   this verify step, not on the edit step directly.

3. EVERY file-CREATING step must use:
     verification: { type: 'file_exists', value: '<expected-path>' }
   on the creating agent step itself. Inline
   \`verification: { type: 'exit_code' }\` is NOT sufficient, and a follow-up
   shell \`test -f\` step is not the primary verification pattern for this
   campaign.

4. Permission scopes (\`permissions.files.read\` / \`write\`) must be
   specific paths, not wildcards. NEVER use \`tests/**\`, \`src/**\`, or
   similar broad scopes unless every file under that prefix is genuinely
   needed by the agent. Pre-inject specific files via deterministic
   \`cat\` steps instead of giving broad read permissions.

5. ESM footer must be exactly:
     async function main() {
       const result = await workflow('<slug>')
         ...
         .run({ cwd: process.cwd() });
       console.log('Result:', result.status);
     }
     main().catch((error) => {
       console.error(error);
       process.exitCode = 1;
     });
   No top-level await. No createWorkflowRenderer. No .build().

6. Import from package entry points only:
     import { workflow } from '@agent-relay/sdk/workflows';
     import { ClaudeModels, CodexModels } from '@agent-relay/config';
   Never relative imports into SDK internals.

7. Build commands use npm (never pnpm) wrapped in a subshell:
     command: '(cd <pkg-path> && npm run build)'
   Wherever the workflow touches relayfile/relayfile-adapters packages.

8. Agent presets:
   - preset: 'lead' ONLY for open-ended coordination needing a PTY + channel
   - preset: 'worker' for all bounded file-writing / file-editing steps
   - preset: 'reviewer' for verdict-producing steps
   When in doubt, use 'worker'. Lead agents sprawl into tool chains.
   - Any agent that writes a file, including an analysis brief, MUST use
     preset: 'worker' and permissions.access: 'restricted'.
   - Reviewer agents use preset: 'reviewer', access: 'readonly', write only
     the verdict file, and deny every implementation file they must not edit.

9. Task prompts for bounded worker/reviewer steps must stay within 10-20
   physical lines. Pre-inject content via deterministic \`cat\` steps and
   reference via \`{{steps.X.output}}\` — never ask a worker to read large
   files itself. If a checklist makes a prompt exceed 20 lines, collapse the
   checklist into a concise sentence or move it into a deterministic brief.

10. Channel must be \`wf-<workflow-slug>\` where <slug> matches the
    filename slug. Never use 'general'.

11. Keep header fields machine-readable. Examples:
    - \`Parallel with: none\`
    - \`Parallel with: 24\`
    Never append prose to the header line. Put explanations in the paragraph
    below. \`Packages:\` must list every repo-relative directory the workflow
    writes to, including the workflow directory for ANALYSIS/REVIEW files.
    If the workflow reads another repo only as context, mention that in the
    paragraph below the header instead of silently hiding the cross-repo read.
    Do NOT list read-only context packages or regression-build-only packages
    in \`Packages:\`; build-only packages are not write surfaces.

12. Every existing-file edit must follow the read-then-edit pattern from
    TEMPLATE.md §8a: add a fresh deterministic \`cat\` step immediately before
    the edit step and inject that exact output into the prompt.

13. Never gate on reviewer stdout. Reviewer verdicts must be written to a
    deterministic file and a follow-up deterministic step must grep line 1 of
    that file for \`^approved$\`.
    The reviewer step itself creates a file, so it must also be followed
    immediately by a deterministic changed-or-untracked verify step for the
    review file; the approval grep comes after that verify step.

14. If the target workflow file already exists from a prior failed run, revise
    it in place instead of redrafting from scratch. Preserve any structure that
    already complies with TEMPLATE.md and only fix the remaining violations.

15. Avoid unnecessary serialization. If multiple file-creation steps only
    consume the same shared read-context steps, fan them out in parallel from
    that shared context instead of chaining them behind sibling verify steps.
    Do not add \`dependsOn\` to a deterministic read step unless its command
    actually consumes predecessor output. Do not keep read steps whose output
    is unused downstream.

16. Every workflow file must contain exactly one top-level workflow
    definition: one JSDoc header, one import block, one constant block,
    one \`async function main()\`, and one trailing \`main().catch(...)\`.
    Never append a second full copy of the workflow after the footer.
    Before finishing, search your output for a second JSDoc header, second
    import block, or second \`async function main()\`; delete duplicates.

17. Plain \`git diff --quiet\` is NOT a valid verify gate for newly created or
    newly untracked files, including REVIEW / PLAN / ANALYSIS markdown files.
    Either rely on the creating step's \`file_exists\` verification or use an
    untracked-aware deterministic helper:
      \`git -C <repo> diff --quiet -- <repo-relative-path> || git -C <repo> ls-files --others --exclude-standard -- <repo-relative-path> | grep -q .\`
    Do not add a review-file diff gate unless it is untracked-aware and
    scoped to the touched repository with \`git -C\`.

18. If sibling file-creation steps can run in parallel, each step must use an
    agent whose \`permissions.files.write\` contains only the one file that
    step owns. Use separate agent definitions with explicit sibling-file
    denies instead of one broad worker that can write every sibling output.

19. Reviewer prompts may only ask reviewers to check material that is present
    in the injected bundle. If the reviewer must inspect workflow structure,
    verify-gate placement, npm command wrapping, or reference-package parity,
    pre-inject the workflow source or reference files into the review context.

20. Do not add no-op deterministic barriers such as \`command: 'true'\`.
    Aggregation/barrier steps must run a real deterministic check, or
    downstream validation must depend directly on the real verify steps.

21. Do not embed large or arbitrary captured outputs inside deterministic shell
    commands, for example \`printf "%s" "{{steps.some-step.output}}"\`.
    Deterministic commands should \`cat\` concrete files, grep concrete log
    files, or use direct file paths. If test output must be checked later,
    tee it to a log file under the workflow directory, add an immediate
    deterministic \`test -s <log-file>\` gate, then grep that file in a
    separate downstream content gate.

22. Every file-producing worker or reviewer prompt must include the exact line:
      \`IMPORTANT: Write the file to disk. Do NOT output to stdout.\`
    Do not use variants such as "Do NOT output code to stdout.".

23. Reviewer prompts must tell the reviewer where to write the verdict before
    the checklist and must forbid shell commands. Use:
      \`Write <review-file> first. The first line must be exactly approved or start with blocked:.\`
      \`Do NOT run npm, git, node, tsc, tsx, or agent-relay.\`

24. Shared adapter-core contract/runtime changes need sibling regression-build
    coverage after the adapter-core build/test gate. Add a deterministic step
    such as \`regression-build-adapters\` that runs subshell-wrapped npm builds
    for affected sibling adapter packages.

25. For multi-file fan-out, the merge/build step must list every relevant
    one-file verify gate directly in \`dependsOn\`; do not rely on transitive
    dependencies for sibling file outputs.

26. If a workflow creates or edits a package manifest with dependencies, run a
    deterministic \`npm install --package-lock-only\` in the owning repo and
    immediately verify the exact lockfile, or explicitly document why no lock
    state exists. Package-lock writes must be declared in \`Packages:\`.

When in doubt, model your new workflow after
\`relayfile-adapters/workflows/schema-adapter-migration/20-canonical-integration-adapter-sdk.ts\`
(the successful Phase 1 reference workflow). It has every pattern you need:
read-then-edit with verify gates, build gates, regression-build step,
pre-injected review bundle, deterministic verdict gate.`;

async function main() {
  const result = await workflow('schema-adapter-gen-00b')
    .description(
      'Meta-workflow: draft Phase 1 workflows 21-24 in parallel, dry-run each, batch-review with codex. Template-driven, no per-workflow revise loops.',
    )
    .pattern('dag')
    .channel('wf-schema-adapter-gen-00b')
    .maxConcurrency(6)
    .timeout(3_600_000) // 1h — 4 parallel drafts + 4 dry-runs + 1 batch review

    // ─── Agents ─────────────────────────────────────────────

    // Draft steps use cursor-author (Cursor CLI + Claude 4.6 Sonnet)
    // instead of codex-author.
    //
    // Lesson from run 2026-04-09: codex-author drafted all 4 Phase 1
    // workflows with structural omissions that the batch review caught
    // (missing git diff gates, missing file_exists after writes, inline
    // vs separate verification, permission scopes too wide). Workflow 21
    // additionally omitted the required `cli` field on every agent so it
    // failed to even load. Claude-class models produce a substantively
    // correct workflow on the first try with the same prompt style.
    //
    // For the narrow "translate BACKLOG entry + TEMPLATE into a working
    // workflow file from scratch" task, Sonnet's template fidelity
    // outperforms codex. Codex is still great for bounded code edits —
    // batch review and all subsequent phase workflow steps keep codex.
    //
    // This keeps the campaign "mostly codex" (batch-review + all other
    // future workflow steps use codex) while using Cursor+Sonnet for the
    // one step that genuinely needs its nuance.
    .agent('cursor-author', {
      cli: 'cursor',
      role: 'Bounded non-interactive author — drafts a single workflow file from pre-injected TEMPLATE.md + BACKLOG.md. Worker preset enforces one-shot bounded execution. Used only for initial workflow drafting where template fidelity matters most. Cursor CLI with Claude 4.6 Sonnet gives the template fidelity codex lacks.',
      preset: 'worker',
      model: CursorModels.GPT_5_4_MEDIUM,
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

    .step('read-current-draft-21', {
      type: 'deterministic',
      command: `if [ -f ${WF_21} ]; then cat ${WF_21}; else echo '__MISSING__'; fi`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-current-draft-22', {
      type: 'deterministic',
      command: `if [ -f ${WF_22} ]; then cat ${WF_22}; else echo '__MISSING__'; fi`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-current-draft-23', {
      type: 'deterministic',
      command: `if [ -f ${WF_23} ]; then cat ${WF_23}; else echo '__MISSING__'; fi`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-current-draft-24', {
      type: 'deterministic',
      command: `if [ -f ${WF_24} ]; then cat ${WF_24}; else echo '__MISSING__'; fi`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── Phase 2: Freeze current drafts ─────────────────────

    .step('draft-21', {
      type: 'deterministic',
      dependsOn: ['read-current-draft-21'],
      command: `test -s ${WF_21}`,
      failOnError: true,
    })

    .step('draft-22', {
      type: 'deterministic',
      dependsOn: ['read-current-draft-22'],
      command: `test -s ${WF_22}`,
      failOnError: true,
    })

    .step('draft-23', {
      type: 'deterministic',
      dependsOn: ['read-current-draft-23'],
      command: `test -s ${WF_23}`,
      failOnError: true,
    })

    .step('draft-24', {
      type: 'deterministic',
      dependsOn: ['read-current-draft-24'],
      command: `test -s ${WF_24}`,
      failOnError: true,
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
