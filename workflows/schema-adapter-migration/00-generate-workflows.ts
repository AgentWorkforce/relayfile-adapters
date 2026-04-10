/**
 * Meta-workflow 00: Generate the schema-adapter migration workflow suite.
 *
 * This workflow produces three artifacts that seed the entire cross-repo
 * refactor campaign:
 *
 *   1. TEMPLATE.md  — authoring conventions every migration workflow must follow
 *   2. BACKLOG.md   — detailed specs for workflows 20-49 (6 phases, ~30 workflows)
 *   3. 20-canonical-integration-adapter-sdk.ts — the reference workflow,
 *      fully reviewed (self-reflection + peer review loop) so later phases
 *      have a known-good pattern to copy from
 *
 * Pattern: Claude writes, Codex peer-reviews, Claude self-reflects, both
 * sides discuss on the channel, Claude revises, final dry-run + sign-off.
 *
 * Direction being encoded (see previous conversation for full design):
 * Packages:     relayfile-adapters/workflows/schema-adapter-migration
 *
 * Future meta-workflows (00b, 00c, ...) will use TEMPLATE.md + BACKLOG.md
 * as input to generate workflows 21-49 in phased batches.
 *
 * Direction being encoded (see previous conversation for full design):
 *   - Promote SchemaAdapter (relayfile-adapters/packages/core) to the
 *     canonical IntegrationAdapter in @relayfile/sdk. Mapping YAML becomes
 *     the single source of truth for an integration.
 *   - Three viable sync paths, all sharing the same YAML spec:
 *       (a) Nango-native   — Nango runtime owns auth + scheduling
 *       (b) Nango-unauth   — Nango runtime, consumer owns auth via
 *                            connection metadata (uses Nango's
 *                            `unauthenticated` integration)
 *       (c) Direct proxy   — no Nango, consumer drives sync via
 *                            SchemaAdapter.sync() + a cron
 *   - Hand-coded adapters (notion/github/gitlab/slack/linear/teams) become
 *     thin extensions of SchemaAdapter, inheriting the 80% that's
 *     declarative and overriding only the genuinely custom methods.
 *   - Adding a new REST integration = write a YAML (ideally scaffolded
 *     from an OpenAPI URL via `relayfile adapter new --from-openapi=...`).
 *
 * Run from the AgentWorkforce root (the workflow reads files across sibling
 * repos, so cwd must be the parent directory containing sage/, relayfile/,
 * relayfile-adapters/, skills/):
 *
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/00-generate-workflows.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { CursorModels } from '@agent-relay/config';

const SKILL_PATH =
  'skills/skills/writing-agent-relay-workflows/SKILL.md';
const EXAMPLE_WORKFLOW_PATH =
  'sage/workflows/v2/02e-nango-sync-scripts.ts';
const WF_DIR = 'relayfile-adapters/workflows/schema-adapter-migration';
const REFERENCE_WF = `${WF_DIR}/20-canonical-integration-adapter-sdk.ts`;

async function main() {
  const result = await workflow('schema-adapter-gen-00')
    .description(
      'Meta-workflow: generate TEMPLATE.md + BACKLOG.md + reference workflow 20 for the schema-adapter migration campaign, with self-reflection and peer review.',
    )
    .pattern('dag')
    .channel('wf-schema-adapter-gen')
    .maxConcurrency(4)
    .timeout(7_200_000) // 2h — lots of writing + review rounds

    // ─── Agents ─────────────────────────────────────────────

    .agent('cursor-lead', {
      cli: 'cursor',
      role: 'Architect and author — reads the skill, designs the template, drafts the backlog, writes the reference workflow, and revises based on peer review findings. Uses Cursor CLI with Claude 4.6 Sonnet for nuance on wide-file reads and template fidelity.',
      preset: 'lead',
      model: CursorModels.GPT_5_4_MEDIUM,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            'skills/skills/writing-agent-relay-workflows/**',
            'sage/workflows/**',
            'sage/src/**',
            'relayfile-adapters/**',
            'relayfile/**',
            'relayfile-adapters/workflows/schema-adapter-migration/**',
          ],
          write: [
            'relayfile-adapters/workflows/schema-adapter-migration/**',
          ],
          deny: ['.env', '.env.*', '**/*.secret', '**/node_modules/**'],
        },
        exec: [],
      },
    })

    // Codex workers handle every bounded writing and critique step. Cursor
    // (with Claude 4.6 Sonnet) is kept ONLY for the `research` step (wide
    // repo reads + architectural synthesis where template fidelity matters).
    // Everything downstream of research — template authoring, backlog
    // drafting, reference workflow writing, self-reflection, revision —
    // uses codex via `preset: 'worker'` or `preset: 'reviewer'`, which runs
    // one-shot via `codex exec`. This matches the user's "mostly done by
    // codex" directive while using Sonnet for the one step that benefits
    // from its stronger template fidelity.

    .agent('codex-author', {
      cli: 'codex',
      role: 'Bounded non-interactive author — produces a single file from pre-injected inputs. Used for template authoring, backlog drafting, reference workflow writing, and self-critique. Cannot edit anything except its assigned deliverable and cannot run shell commands.',
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
            'relayfile-adapters/workflows/schema-adapter-migration/TEMPLATE.md',
            'relayfile-adapters/workflows/schema-adapter-migration/BACKLOG.md',
            'relayfile-adapters/workflows/schema-adapter-migration/SELF_REFLECT_*.md',
            'relayfile-adapters/workflows/schema-adapter-migration/20-*.ts',
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

    .agent('codex-revisor', {
      cli: 'codex',
      role: 'Bounded revisor — applies accepted review findings to a target workflow file and writes the decisions log. Worker preset enforces no-shell, no-sprawl behavior. Two deliverables: DECISIONS_*.md and the target workflow file.',
      preset: 'worker',
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            'relayfile-adapters/workflows/schema-adapter-migration/**',
          ],
          write: [
            'relayfile-adapters/workflows/schema-adapter-migration/DECISIONS_*.md',
            'relayfile-adapters/workflows/schema-adapter-migration/20-*.ts',
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
      role: 'Peer reviewer — receives pre-injected workflow and skill content, writes PEER_REVIEW_*.md or SIGN_OFF_*.md with quoted violations and a verdict. Read-only on code, writes only its own review artifacts.',
      preset: 'reviewer',
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            'relayfile-adapters/workflows/schema-adapter-migration/**',
          ],
          write: [
            'relayfile-adapters/workflows/schema-adapter-migration/PEER_REVIEW_*.md',
            'relayfile-adapters/workflows/schema-adapter-migration/SIGN_OFF_*.md',
          ],
          deny: [],
        },
        exec: [],
      },
    })

    // ─── Phase 1: Research + template + backlog ─────────────

    .step('research', {
      agent: 'cursor-lead',
      task: `You are authoring a multi-workflow campaign to refactor the relayfile adapter architecture.

Read these first:
1. ${SKILL_PATH} — the authoring skill
2. ${EXAMPLE_WORKFLOW_PATH} — a real example of a sage workflow
3. relayfile-adapters/packages/core/src/runtime/schema-adapter.ts — the SchemaAdapter we are promoting to SDK
4. relayfile-adapters/packages/core/src/spec/types.ts — the mapping spec shape
5. relayfile-adapters/packages/github/github.mapping.yaml — a real mapping YAML
6. relayfile-adapters/packages/notion/src/adapter.ts — a hand-coded adapter we will migrate
7. relayfile/packages/sdk/typescript/src/connection.ts — current ConnectionProvider interface
8. relayfile/packages/sdk/typescript/src/integration-adapter.ts — the canonical IntegrationAdapter already shipped by workflow 20
9. sage/src/integrations/relayfile-bridge.ts (lines 1-100 + 560-710) — how sage consumes Nango sync data today

CRITICAL: also read the LOCAL abstract IntegrationAdapter class in EACH of the following files and compare them SEMANTICALLY (constructor signature, protected fields, SyncResult / WritebackResult shape):
- relayfile-adapters/packages/github/src/types.ts
- relayfile-adapters/packages/slack/src/slack-adapter.ts
- relayfile-adapters/packages/linear/src/linear-adapter.ts
- relayfile-adapters/packages/notion/src/adapter.ts
- relayfile-adapters/packages/gitlab/src/types.ts

These 5 classes have the SAME NAME but encode DIFFERENT CONTRACTS. A class with the same name in a sibling package is not a "duplicate" — it may have different constructor args, different protected fields, different return types. Workflow 20's failed dedup run (2026-04-09) hit 17 compile errors because this wasn't checked. Document every divergence in RESEARCH.md so future workflows know each adapter needs a per-package migration decision, not a blanket dedup.

Write ${WF_DIR}/RESEARCH.md summarizing:
- Authoring conventions distilled from SKILL.md (ESM, preset usage, verification gates, step sizing, permission scoping, common mistakes list)
- The current architectural split (hand-coded adapter vs SchemaAdapter)
- Which adapters already have mapping YAMLs vs which need them written
- **Per-adapter semantic divergence table** — for each of the 5 hand-coded adapters, what the local IntegrationAdapter constructor, protected fields, and abstract method signatures look like, and where they diverge from the canonical SDK version
- The three sync paths (nango-native / nango-unauth / direct-proxy) and where each lives
- Build tooling: npm (not pnpm), and the npm link requirement between relayfile and relayfile-adapters

Keep RESEARCH.md under 300 lines. Output RESEARCH_COMPLETE when done.`,
      verification: { type: 'file_exists', value: `${WF_DIR}/RESEARCH.md` },
    })

    .step('write-template', {
      agent: 'codex-author',
      dependsOn: ['research'],
      task: `Read ${WF_DIR}/RESEARCH.md. Write ${WF_DIR}/TEMPLATE.md — the authoring template every schema-adapter migration workflow (20-49) must follow.

TEMPLATE.md must specify:
1. File naming: NN-kebab-case-name.ts where NN is 20-49
2. File header JSDoc shape (description, phase, depends-on, packages touched)
3. ESM imports (import from '@agent-relay/sdk/workflows' + '@agent-relay/config')
4. async main() + main().catch(console.error) footer
5. .run({ cwd: process.cwd() }) convention
6. Required workflow fields (description, pattern, channel, maxConcurrency, timeout)
7. Agent conventions: use ClaudeModels / CodexModels constants, scope file permissions per agent, prefer preset: worker for non-interactive implementation steps
8. **Preset selection rule**: preset 'lead' only for open-ended coordination on a channel; everything bounded is preset 'worker'. Interactive lead agents ignore "single deliverable" constraints and sprawl into tool chains (tsc/tsx/nested workflows). This is the hard lesson from run bcn1d1sqc; document it as a hard rule with a decision rubric.
9. Step patterns: read-then-edit, multi-file split (one file per step), deterministic verify gates (file_exists / exit_code), pre-injection for non-interactive agents
10. Channel naming: wf-<workflow-slug>
11. Cross-repo workflows: cwd must be AgentWorkforce root; permission paths are repo-relative
12. **Build tool: npm, not pnpm.** Both relayfile/ and relayfile-adapters/ use npm (package-lock.json present, no pnpm-workspace.yaml). Build commands must be (cd <pkg-path> && npm run build), never pnpm --filter. Document this as a §10a section with concrete examples.
13. **One-time npm link setup.** relayfile-adapters/node_modules/@relayfile/sdk is a registry install; the local SDK source is invisible to adapter-core without 'npm link @relayfile/sdk'. Document the link setup as a §10b section with verification command (readlink). Workflows assume the link is in place.
14. The "common mistakes" checklist lifted from SKILL.md, concrete to this campaign, INCLUDING:
    - #40: Assuming class duplication across packages means duplicate contracts (compare semantically, not syntactically — different constructors, different protected fields, different return types are not a dedup)
    - #41: Using pnpm --filter (see §10a)
    - #42: Assuming cross-repo source imports work without npm link (see §10b)
    - #43: Blanket-migrating all adapter packages in one workflow (per-package migration with per-adapter Mode A/B/C decision; see BACKLOG Phase 3 prelude)

Keep TEMPLATE.md focused — it is reference material, not tutorial. Output TEMPLATE_COMPLETE when done.`,
      verification: { type: 'file_exists', value: `${WF_DIR}/TEMPLATE.md` },
    })

    .step('write-backlog', {
      agent: 'codex-author',
      dependsOn: ['research'],
      task: `Write ${WF_DIR}/BACKLOG.md — detailed specs for workflows 20-49 grouped into 6 phases. This is the plan the rest of the campaign executes against.

Phase 1 — Foundation (20-24, sequential):
  20. Canonical IntegrationAdapter + SchemaAdapter moved to @relayfile/sdk
  21. Extend MappingSpec with declarative pagination + sync resource config
  22. Implement SchemaAdapter.sync(resourceName, options) as generic paginator
  23. Round-trip test harness (OpenAPI → mapping → SchemaAdapter.sync → VFS)
  24. @relayfile/provider-nango-unauth package (metadata-based credentials)

Phase 2 — Mapping toolchain (25-29, parallelizable):
  25. NangoSyncGenerator in adapter-core (YAML → createSync script)
  26. CLI: relayfile adapter new <name> --from-openapi=<url>
  27. CLI: relayfile adapter gen-nango-sync <mapping.yaml>
  28. Mapping YAML validator/linter
  29. Docs: "adding a new integration in 10 minutes"

Phase 3 — Adapter migrations (30-36, parallelizable):
  30. GitHub   (github.mapping.yaml already exists — expand + refactor)
  31. Slack    (write slack.mapping.yaml + refactor)
  32. Linear   (write linear.mapping.yaml — GraphQL resource type)
  33. Notion   (write notion.mapping.yaml — block walking stays custom)
  34. GitLab   (write gitlab.mapping.yaml)
  35. Teams    (write teams.mapping.yaml)
  36. Parity test suite (recorded fixtures, byte-identical VFS writes)

Phase 4 — Sage consumer (37-41):
  37. RelayFileBridge.runSync(provider, adapter, resource, options)
  38. First real Nango-unauth connection (Composio→Gmail as reference)
  39. Credential-refresh background job
  40. .sync-state/ workspace convention for direct-proxy path
  41. e2e test: new provider via YAML → all three paths → identical VFS

Phase 5 — Ingestion hardening (42-45, parallelizable):
  42. OpenAPI ingestion improvements
  43. Postman ingestion improvements
  44. Sample-based spec ingestion
  45. Golden test suite (10+ real public APIs)

Phase 6 — Catalog + polish (46-49, parallelizable, low priority):
  46. Community mapping YAML catalog
  47. VS Code extension for mapping YAMLs
  48. Mapping YAML version migration tool
  49. Perf benchmarks

For EACH workflow, BACKLOG.md must list:
- Number, title, phase, slug
- Depends-on (workflow numbers)
- Parallel-with (workflow numbers safe to run concurrently)
- One-paragraph summary
- Files touched (repo-relative paths)
- Agents (roles, count)
- Key verification gates
- Risks / notes

Target ~40-60 lines per workflow entry. Output BACKLOG_COMPLETE when done.`,
      verification: { type: 'file_exists', value: `${WF_DIR}/BACKLOG.md` },
    })

    // ─── Phase 2: Reference workflow 20 ─────────────────────

    .step('write-workflow-20', {
      agent: 'codex-author',
      dependsOn: ['write-template', 'write-backlog'],
      task: `Write the reference workflow: ${REFERENCE_WF}.

Read ${WF_DIR}/TEMPLATE.md and the entry for workflow 20 in ${WF_DIR}/BACKLOG.md. Follow TEMPLATE.md exactly.

Workflow 20 goal: promote IntegrationAdapter + SchemaAdapter to @relayfile/sdk. Concretely:
- Create relayfile/packages/sdk/typescript/src/integration-adapter.ts — canonical abstract class (ingestWebhook, computePath, computeSemantics, writeBack?, supportedEvents?, sync? with unified SyncOptions/SyncResult shape)
- Move SchemaAdapter from relayfile-adapters/packages/core/src/runtime/schema-adapter.ts to the SDK (re-export from adapter-core for back-compat)
- Export from relayfile/packages/sdk/typescript/src/index.ts
- Delete the abstract class duplications in each adapter package (github/types.ts, slack/slack-adapter.ts, linear/linear-adapter.ts, notion/adapter.ts, gitlab/types.ts) — replace with imports from @relayfile/sdk. Do NOT refactor the concrete adapter classes yet — those are Phase 3.
- tsc build gate in both relayfile/packages/sdk and relayfile-adapters/packages/core

Agents: claude-lead (planner), codex-impl-sdk (SDK writer), codex-impl-adapter-core (adapter-core migration), codex-impl-dedup-a / -b / -c (parallel duplicate-class removal, one per pair of adapter packages), codex-reviewer.

Use DAG with parallel fan-out after the SDK + adapter-core writes land. Gate each implementation step with file_exists + exit_code. Final build step runs tsc across relayfile/packages/sdk and relayfile-adapters/packages/core.

Keep individual task prompts 10-20 lines. Scope file permissions tightly (each codex worker writes only to its assigned files).

Output WORKFLOW_20_COMPLETE when done.`,
      verification: { type: 'file_exists', value: REFERENCE_WF },
    })

    .step('dry-run-20', {
      type: 'deterministic',
      dependsOn: ['write-workflow-20'],
      command: `agent-relay run --dry-run ${REFERENCE_WF} 2>&1 | tail -40`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── Phase 3: Pre-inject content for reviewers ──────────
    //
    // Per the skill: "Pre-inject content into non-interactive agents. Don't
    // ask them to read large files — pre-read in a deterministic step and
    // inject via {{steps.X.output}}". Deterministic steps are clean sources
    // for chaining. Both review agents receive the same frozen snapshot so
    // findings are comparable and reproducible.

    .step('read-skill-file', {
      type: 'deterministic',
      command: `cat ${SKILL_PATH}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-workflow-20-file', {
      type: 'deterministic',
      dependsOn: ['dry-run-20'],
      command: `cat ${REFERENCE_WF}`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── Phase 4: Bounded self-reflection + peer review ─────

    .step('self-reflect-20', {
      agent: 'codex-author',
      dependsOn: ['read-skill-file', 'read-workflow-20-file'],
      task: `Produce a critique document. Single deliverable: ${WF_DIR}/SELF_REFLECT_20.md.

IMPORTANT — read carefully, violations cause step failure:
- You may ONLY write ${WF_DIR}/SELF_REFLECT_20.md. Do not edit any other file.
- Do NOT run any shell command (no tsc, tsx, pgrep, ps, git, npm, node -e).
- Do NOT read PEER_REVIEW_20.md — this is SELF reflection, not synthesis.
- Write the file FIRST, before any other action.

Inputs (pre-injected below):
- SKILL_CONTENT is the authoring skill. Focus on its "Common Mistakes" table.
- WORKFLOW_20_CONTENT is the workflow file under review.

Produce SELF_REFLECT_20.md with three sections:
1. Common Mistakes audit — for each row in the Common Mistakes table, state whether workflow 20 exhibits the mistake (quote the row text, cite workflow line if it does)
2. Campaign-specific audit — file_exists coverage on file-creation steps, per-step permission scoping tightness, build-gate presence, DAG deadlock check, ESM footer
3. Verdict — PASS or CHANGES_SUGGESTED with a one-paragraph rationale

=== SKILL_CONTENT ===
{{steps.read-skill-file.output}}

=== WORKFLOW_20_CONTENT ===
{{steps.read-workflow-20-file.output}}`,
      verification: { type: 'file_exists', value: `${WF_DIR}/SELF_REFLECT_20.md` },
    })

    .step('peer-review-20', {
      agent: 'codex-reviewer',
      dependsOn: ['read-skill-file', 'read-workflow-20-file'],
      task: `Peer review workflow 20. Single deliverable: ${WF_DIR}/PEER_REVIEW_20.md.

IMPORTANT — read carefully, violations cause step failure:
- You may ONLY write ${WF_DIR}/PEER_REVIEW_20.md. Do not edit any other file.
- Do NOT run shell commands.
- Do NOT read SELF_REFLECT_20.md — you are an independent voice.
- Write the file FIRST, before any other action.

Inputs (pre-injected below):
- SKILL_CONTENT is the authoring skill.
- WORKFLOW_20_CONTENT is the workflow file under review.

For each deviation you find, quote the workflow line, cite the skill rule, and suggest the fix. Focus areas:
- Task prompts over 20 lines
- Single steps editing 4+ files
- Missing file_exists verification on file-creation steps
- Missing build gates after code edits
- Hardcoded model strings instead of ClaudeModels/CodexModels constants
- Interactive-agent output chained via {{steps.X.output}} (garbled PTY)
- Permission scopes that are too wide
- DAG deadlock (worker step depending on lead step that waits for workers)
- Value-export correctness (e.g. exporting abstract classes via export type, which erases runtime)

End PEER_REVIEW_20.md with a single-line verdict: APPROVED or CHANGES_REQUESTED.

=== SKILL_CONTENT ===
{{steps.read-skill-file.output}}

=== WORKFLOW_20_CONTENT ===
{{steps.read-workflow-20-file.output}}`,
      verification: { type: 'file_exists', value: `${WF_DIR}/PEER_REVIEW_20.md` },
    })

    // ─── Phase 4: Synthesize + revise ───────────────────────
    //
    // LESSONS FROM RUN bcn1d1sqc:
    // The original revise step used claude-lead (interactive preset) and went
    // into autonomous validation mode — running tsc, tsx, and even spawning
    // a nested agent-relay workflow from inside the step. It applied the
    // fixes but failed to write DECISIONS_20.md, killing the workflow.
    //
    // The fix: use a bounded worker (claude-revisor, preset: worker) with
    // pre-injected inputs, explicit shell prohibition, and a "write
    // DECISIONS FIRST" instruction. The worker preset runs one-shot via
    // `claude -p`, which cannot sprawl into long tool chains.

    .step('read-reviews', {
      type: 'deterministic',
      dependsOn: ['self-reflect-20', 'peer-review-20'],
      command: `echo '=== SELF_REFLECT_20.md ===' && cat ${WF_DIR}/SELF_REFLECT_20.md && echo && echo '=== PEER_REVIEW_20.md ===' && cat ${WF_DIR}/PEER_REVIEW_20.md`,
      captureOutput: true,
      failOnError: true,
    })

    .step('revise-workflow-20', {
      agent: 'codex-revisor',
      dependsOn: ['read-reviews', 'read-workflow-20-file'],
      task: `Two deliverables, in order:
1. FIRST write ${WF_DIR}/DECISIONS_20.md with one section per finding and its disposition (ACCEPTED / REJECTED / DEFERRED with reasoning)
2. THEN edit ${REFERENCE_WF} in place, applying every ACCEPTED fix

IMPORTANT — violations cause step failure:
- You may ONLY write DECISIONS_20.md and the workflow file. Nothing else.
- Do NOT run any shell command (no tsc, tsx, agent-relay, npm, git, node, diff).
- Do NOT spawn nested workflows or validate by running anything.
- Write DECISIONS_20.md FIRST, before touching the workflow file.
- Do NOT introduce new design decisions beyond what the reviews flagged.
- Preserve the JSDoc header on the workflow file. Preserve unchanged sections.

IMPORTANT: Write both files to disk. Do NOT output to stdout.

=== REVIEWS (SELF_REFLECT + PEER_REVIEW) ===
{{steps.read-reviews.output}}

=== CURRENT WORKFLOW 20 CONTENT ===
{{steps.read-workflow-20-file.output}}`,
      verification: { type: 'file_exists', value: `${WF_DIR}/DECISIONS_20.md` },
    })

    .step('final-dry-run-20', {
      type: 'deterministic',
      dependsOn: ['revise-workflow-20'],
      command: `agent-relay run --dry-run ${REFERENCE_WF} 2>&1 | tail -40`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── Phase 5: Final sign-off ────────────────────────────

    .step('sign-off-20', {
      agent: 'codex-reviewer',
      dependsOn: ['final-dry-run-20'],
      task: `Final sign-off on ${REFERENCE_WF}.

Read:
1. ${WF_DIR}/DECISIONS_20.md — what was accepted
2. ${REFERENCE_WF} — the revised workflow
3. ${WF_DIR}/PEER_REVIEW_20.md — your original review

Verify that every CHANGES_REQUESTED item from your original review either:
(a) was applied to the workflow file, OR
(b) is explicitly rejected in DECISIONS_20.md with reasoning you accept

If any item is silently dropped, flag it and output SIGN_OFF_BLOCKED with the list.
If every item is addressed, output SIGN_OFF_APPROVED.

Write a one-paragraph verdict to ${WF_DIR}/SIGN_OFF_20.md.`,
      verification: { type: 'output_contains', value: 'SIGN_OFF_APPROVED' },
    })

    .onError('fail-fast')
    .run({ cwd: process.cwd() });

  console.log('Result:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
