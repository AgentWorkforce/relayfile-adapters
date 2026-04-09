# SELF_REFLECT_20.md

Self-reflection on `20-canonical-integration-adapter-sdk.ts` against the
`writing-agent-relay-workflows` skill. Peer review is excluded on purpose —
this is self-critique only.

---

## 1. Common Mistakes audit

Walking every row of the skill's **Common Mistakes** table and judging whether
workflow 20 exhibits it. Line numbers refer to the workflow file as injected
in the briefing.

| # | Mistake (quoted) | Status | Notes |
|---|---|---|---|
| 1 | "All workflows run sequentially" | N/A | Wave planning is a campaign-level concern; this is a single workflow. The JSDoc header does declare `Parallel with: none` correctly. |
| 2 | "Every step depends on the previous one" | ✅ Clean | Dedup fan-out is real — each `read-*` only depends on `build-adapter-core`, not on a neighbour. The in-line comment at the Phase E header explicitly calls this out. |
| 3 | "Self-review step with no timeout" → "Set `timeout: 300_000` (5 min) — Codex hangs in non-interactive review" | ⚠️ Partial | `review-migration` has no per-step timeout. The workflow relies on the global `.timeout(7_200_000)`. This is in tension with mistake #6 ("Use global `.timeout()` only") but the spirit of #3 is about bounding a non-interactive reviewer. Reviewer is `preset: 'reviewer'` (non-interactive) so hangs are less likely than an interactive Codex, but if Codex hangs mid-review the whole workflow waits 2h. Worth flagging. |
| 4 | "One giant workflow per feature" | ✅ Clean | Workflow 20 is scoped to promoting `IntegrationAdapter` only. `SchemaAdapter` move and `computePath` unification are explicitly deferred to workflows 21/22. |
| 5 | "Adding exit instructions to tasks" | ✅ Clean | No task says "then exit" / "exit when done". Every `task:` ends with a scope instruction, not a termination instruction. |
| 6 | "Setting `timeoutMs` on agents/steps" | ✅ Clean | Only `.timeout(7_200_000)` at the workflow level. No per-agent or per-step `timeoutMs`. |
| 7 | "Using `general` channel" | ✅ Clean | `.channel('wf-20-canonical-integration-adapter-sdk')` — dedicated and prefixed. |
| 8 | "`{{steps.X.output}}` without `dependsOn: ['X']`" | ✅ Clean | Every `{{steps.X.output}}` injection site lists `X` in `dependsOn` (verified for `read-schema-adapter`, `read-sdk-index`, all `read-adapter-core-*`, all dedup `read-*`, and `bundle-review-context`). |
| 9 | "Requiring exact sentinel as only completion gate" | ✅ Clean | Completion is gated via `file_exists` (plan, SDK file, review) and `exit_code` + deterministic `git diff --quiet` + `grep` for updates. No sentinel tokens. |
| 10 | "Writing 100-line task prompts" | ✅ Clean | Longest task is `write-sdk-integration-adapter` at ~12 lines. All are under the 10-20 line guideline. |
| 11 | "`maxConcurrency: 16` with many parallel steps" | ✅ Clean | `.maxConcurrency(6)` — at the top of the sanctioned range for 5+ parallel dedup workers. |
| 12 | "Non-interactive agent reading large files via tools" | ✅ Clean | Every worker edit is preceded by a deterministic `cat` step that captures output and injects via `{{steps.X.output}}`. Workers never reach for `Read` on the targets. |
| 13 | "Workers depending on lead step (deadlock)" | ✅ Clean | `plan-migration` (the lead step) has no downstream dependency on workers. It is a pure planning step that produces `PLAN_20.md`; workers depend on the plan file, not on a coordinator waiting for `WORKER_DONE`. See Section 2 DAG check below. |
| 14 | "`fan-out`/`hub-spoke` for simple parallel workers" | ✅ Clean | `.pattern('dag')`. |
| 15 | "`pipeline` but expecting auto-supervisor" | ✅ Clean | `dag`, and no auto-supervisor is expected. |
| 16 | "Workers without `preset: 'worker'` in lead+worker flows" | ✅ Clean | All five `codex-impl-*` agents use `preset: 'worker'`, reviewer uses `preset: 'reviewer'`, lead uses `preset: 'lead'`. |
| 17 | "Using `_` in YAML numbers" | ✅ Clean | TypeScript file, not YAML. `7_200_000` is valid TS numeric separator syntax. |
| 18 | "Workflow timeout under 30 min for complex workflows" | ✅ Clean | `7_200_000` = 2 hours. Sits above the 1-hour skill default for a workflow with 5 parallel build gates. |
| 19 | "Using `require()` in ESM projects" | ✅ Clean | `import { workflow } from '@agent-relay/sdk/workflows'` + `import { ClaudeModels } from '@agent-relay/config'`. No `require()`. |
| 20 | "Wrapping in `async function main()` in ESM — ESM supports top-level `await` — no wrapper needed" | ❌ **Violates** | The workflow footer is `async function main() { ... } main().catch((error) => { ... })`. Per the skill, ESM projects should use top-level `await` with a `try`/`catch`, not a `main()` wrapper. This does not break functionality (the `.catch()` handler is equivalent) but it directly matches the mistake row. See Section 2 ESM footer analysis. |
| 21 | "Using `createWorkflowRenderer`" | ✅ Clean | Uses `.run({ cwd: process.cwd() })`. |
| 22 | "`export default workflow(...)...build()`" | ✅ Clean | No `.build()`. The file actually invokes `.run()` inside `main()`, so `agent-relay run` will execute steps. |
| 23 | "Relative import `'../workflows/builder.js'`" | ✅ Clean | Package import `@agent-relay/sdk/workflows`. |
| 24 | "Hardcoded model strings (`model: 'opus'`)" | ✅ Clean | `ClaudeModels.OPUS`. Only `claude-lead` sets a model; other agents use CLI defaults, which is acceptable per the skill (it says "always use constants" only when a model is set). |
| 25 | "Thinking `agent-relay run` inspects exports" | ✅ Clean | No `export default`. `main()` is invoked at module load. |
| 26 | "`pattern('single')` on cloud runner" | ✅ Clean | `dag`. |
| 27 | "`pattern('supervisor')` with one agent" | ✅ Clean | Seven agents under a `dag` pattern — neither condition applies. |
| 28 | "Invalid verification type (`type: 'deterministic'`)" | ✅ Clean | All `verification:` blocks use `exit_code` or `file_exists`. The deterministic *steps* use `type: 'deterministic'` which is a step type, not a verification type — no confusion. |
| 29 | "Chaining `{{steps.X.output}}` from interactive agents" | ✅ Clean | Every `{{steps.X.output}}` source is either (a) a `type: 'deterministic'` shell step or (b) a `preset: 'worker'` non-interactive Codex step. Never from `claude-lead` or another interactive agent. |
| 30 | "Single step editing 4+ files" | ✅ Clean | One-file-per-step discipline throughout. Even the two SDK edits (`write-sdk-integration-adapter` + `update-sdk-index`) are split with a verify gate between. |
| 31 | "Relying on agents to `git commit`" | ✅ Clean | No commit step at all. The workflow is intended to leave staged diffs for a downstream campaign commit. If a commit is expected, that is a campaign-level omission, not a mistake #31 violation. |
| 32 | "File-writing steps without `file_exists` verification" | ✅ Clean (with nuance) | File *creation* steps use `file_exists` (plan-migration, write-sdk-integration-adapter, review-migration). File *update* steps use `exit_code` plus a deterministic `git diff --quiet` gate — the skill's multi-file-edit pattern explicitly endorses this approach. |
| 33 | "Manual peer fanout in `handleChannelMessage()`" | ✅ Clean | No custom relay plumbing. |
| 34 | "Client-side `personaNames.has(from)` filtering" | ✅ Clean | Uses `access: 'restricted'` permission scoping, not client-side filtering. |
| 35 | "Agents receiving noisy cross-channel messages" | ✅ Clean | Single dedicated channel. |
| 36 | "Hardcoding all channels at spawn time" | ✅ Clean | Only one channel exists; dynamic subscribe/mute is unnecessary. |

**Violations found:** 1 hard (#20), 1 soft (#3).

---

## 2. Campaign-specific audit

### 2a. `file_exists` coverage on file-creation steps

| Step | Creates | Verification | Verdict |
|---|---|---|---|
| `plan-migration` | `PLAN_20.md` (new) | `file_exists: PLAN_20.md` | ✅ Correct |
| `write-sdk-integration-adapter` | `integration-adapter.ts` (new) | `file_exists: SDK_INTEGRATION_ADAPTER` | ✅ Correct |
| `update-sdk-index` | edits existing `index.ts` | `exit_code` + downstream `git diff --quiet` gate + `grep -q "integration-adapter"` | ✅ Correct — file already exists; `file_exists` would be a no-op. |
| `update-adapter-core-schema` | edits existing file | `exit_code` + downstream `git diff --quiet` + `grep -q "from '@relayfile/sdk'"` + negative `grep` for the old abstract class | ✅ Correct and particularly rigorous (negative grep proves removal). |
| `update-adapter-core-index` | edits existing file | same pattern as above | ✅ Correct |
| Five `dedup-*` steps | edit existing files | `exit_code` + downstream diff gate + positive import grep + negative class grep | ✅ Correct |
| `review-migration` | `REVIEW_20.md` (new) | `file_exists: REVIEW_20.md` | ✅ Correct |
| `gate-review-verdict` | deterministic check | `test -s` + `head -n 1 \| grep -Eq "^approved$"` | ✅ Correct — sidesteps the verification-token double-match gotcha by reading from disk rather than using `output_contains`. |

**Coverage verdict:** tight. Every step that materialises a *new* file has a `file_exists` check; every step that *mutates* a file has both an exit-code verification and a deterministic `git diff --quiet` + content-grep gate. No file-producing step is gated only on `exit_code`.

### 2b. Per-step permission scoping tightness

| Agent | Write scope | Tightness |
|---|---|---|
| `claude-lead` | `[PLAN_PATH]` only | ✅ Tight |
| `codex-impl-sdk` | `[SDK_INTEGRATION_ADAPTER, SDK_INDEX]` | ✅ Tight — limited to the two files it owns |
| `codex-impl-adapter-core` | `[SCHEMA_ADAPTER_SRC, ADAPTER_CORE_INDEX]` | ✅ Tight |
| `codex-impl-dedup-a` | `[GITHUB_TYPES, SLACK_ADAPTER]` + explicit `deny` on the other dedup targets | ✅ Tight + belt-and-braces deny list |
| `codex-impl-dedup-b` | `[LINEAR_ADAPTER, NOTION_ADAPTER]` + deny on the other targets | ✅ Tight |
| `codex-impl-dedup-c` | `[GITLAB_TYPES]` + deny on the other targets | ✅ Tight |
| `codex-reviewer` | `[REVIEW_PATH]` only | ✅ Tight — and the inline comment explicitly justifies why the reviewer is `restricted` rather than `readonly`, which is the kind of documented deviation the campaign TEMPLATE expects. |

All agents carry the `STANDARD_DENY` env/secret block. Read scopes are scoped to the packages each agent must reason about; no agent has blanket read across the repo.

**Scoping verdict:** best-in-class. The redundant deny lists on the dedup agents are a correct defensive choice given that `codex-impl-dedup-a` and `-b` each own two files — if the agent hallucinates the wrong file name, the deny catches it.

### 2c. Build-gate presence

Build gates fire at three checkpoints:

1. **Foundation built before fan-out** — `build-sdk` → `build-adapter-core` run after the SDK and adapter-core edits and *before* any dedup step can start (`build-adapter-core` is the dependency root for every `read-*-types`/`read-*-adapter` step).
2. **Per-package build after each dedup** — `build-github`, `build-slack`, `build-linear`, `build-notion`, `build-gitlab` each run immediately after their respective verify step. This isolates compile failures to the specific package that broke.
3. **Final cross-package rebuild** — `final-build-sdk` → `final-build-adapter-core` run after all five adapter builds converge, catching any symbol resolution issue that only surfaces when the whole graph is rebuilt together.

**Build-gate verdict:** excellent. Foundation → per-package → final is a three-layer net. A dedup step that breaks compilation will fail-fast on its own package build, not leak into the other four parallel branches.

### 2d. DAG deadlock check

The deadlock anti-pattern from the skill is: a "lead/coordinate" step depends on a context step, and workers depend on coordinate, causing mutual wait. Walking the DAG:

- `plan-migration` (lead) → no downstream dependency on any worker; it is a pure producer of `PLAN_20.md`.
- `read-schema-adapter` (deterministic) → independent; no dependency on the lead.
- `write-sdk-integration-adapter` depends on `[plan-migration, read-schema-adapter]` — fine, both are producers with no cycle.
- The adapter-core and dedup branches all chain off `build-adapter-core` → `build-sdk` → `verify-sdk-index` → `update-sdk-index` → `read-sdk-index` → `write-sdk-integration-adapter` → `plan-migration`. Linear chain, no cycle.
- Five dedup branches fan out from `build-adapter-core` and converge at `final-build-sdk`. No cross-dependencies between branches.
- `review-migration` depends on `bundle-review-context`, which depends on `final-build-adapter-core`. Pure terminal chain.

**Deadlock verdict:** no cycle. No coordinator step waits on a worker token while the worker waits on the coordinator. The lead is a write-once planner, not a runtime supervisor. ✅

### 2e. ESM footer

The file ends with:

```ts
async function main() {
  const result = await workflow(...)
    ...
    .run({ cwd: process.cwd() });
  console.log('Result:', result.status);
  console.log('WORKFLOW_20_COMPLETE');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

The skill's Quick Reference and Common Mistakes table both state that ESM projects should use top-level `await`, not a `main()` wrapper. The idiomatic ESM form would be:

```ts
try {
  const result = await workflow(...)
    ...
    .run({ cwd: process.cwd() });
  console.log('Result:', result.status);
  console.log('WORKFLOW_20_COMPLETE');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
```

This is a **direct match for mistake #20**. Functionally the two forms are equivalent — both await the workflow, log the result, and set a non-zero exit code on failure — but the skill specifically flags the wrapper as a mistake in ESM projects. It is not a blocker (the workflow will run) but it is a citeable deviation from the authoring skill. Whether `relayfile-adapters/` is ESM should be confirmed; the workflow's own instructions to preserve `.js` extensions on SDK imports strongly imply the SDK is ESM, but the workflow *file itself* may be CJS or ESM depending on `relayfile-adapters/package.json`. If `relayfile-adapters` is CJS, the current wrapper is actually correct and mistake #20 does not apply.

**ESM footer verdict:** conditional flag. If `relayfile-adapters/` is `"type": "module"`, refactor to top-level `await`. If CJS, the current form is correct (though then `import` should be `require`, which the file doesn't do — so one of the two must be wrong).

---

## 3. Verdict

**CHANGES_SUGGESTED** (minor).

Workflow 20 is a well-constructed foundation step: the plan/SDK/adapter-core/dedup/build/review layering is clean, permission scoping is tight with defensive deny lists on the dedup agents, every file-creating step uses `file_exists`, every file-updating step uses `exit_code` + deterministic diff gates, the DAG has no deadlock, and the build-gate strategy (foundation → per-package → final) is exactly right for a fan-out of five parallel edits against a shared type surface. The review step avoids the verification-token double-match gotcha by writing to disk and grepping deterministically. The only real frictions are two soft ones: (1) the `async function main()` wrapper directly matches Common Mistakes #20 if the project is ESM — the `import` statements suggest ESM so this should be refactored to top-level `await` with a `try`/`catch`, and (2) the `review-migration` step has no explicit bounding timeout and inherits the 2-hour global, which is a long tail if Codex hangs during non-interactive review. Neither is a blocker; both are one-line fixes. Everything else is PASS.
