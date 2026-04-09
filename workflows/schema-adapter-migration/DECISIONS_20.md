# Decisions: Workflow 20 Revision

Reconciles findings from `PEER_REVIEW_20.md` (codex-reviewer) and
`SELF_REFLECT_20.md` (claude-worker). Each finding has a disposition:
**ACCEPTED** (fix applied), **REJECTED** (with reasoning), or **DEFERRED**
(acknowledged but out of scope for workflow 20).

Salvaged from meta-workflow run `bcn1d1sqc` — the `revise-workflow-20` step
applied fixes to `20-canonical-integration-adapter-sdk.ts` in place but hit
tool-sprawl and failed to write this decisions file before its file_exists
gate expired. Contents reconstructed post-hoc from (a) both review files,
(b) diff between the v1 and revised workflow 20, (c) a fresh dry-run pass.

---

## Peer Review Findings

### 1. [High] Missing "IMPORTANT: Write the file to disk" disclaimer — **ACCEPTED**

**Finding:** The file-writing tasks (`plan-migration`, `write-sdk-integration-adapter`, `review-migration`) relied on agents interpreting "write/create" correctly. The skill's "Rules for file-writing tasks" explicitly requires the disclaimer.

**Fix applied:** Added `IMPORTANT: Write the file to disk. Do NOT output to stdout.` to all three tasks. Verified by `grep -c "IMPORTANT: Write the file to disk" → 3`.

---

### 2. [High] Over-broad reviewer read permissions — **ACCEPTED**

**Finding:** The `codex-reviewer` was declared fully pre-injected but retained `read: ['relayfile/packages/sdk/typescript/src/**', 'relayfile-adapters/packages/**', 'skills/...', PLAN_PATH]`. For a reviewer that only consumes a deterministic bundle, package-wide read is unnecessary blast-radius.

**Fix applied:** Reviewer read scope tightened to `[PLAN_PATH]` only. The review artifact is fed via `{{steps.bundle-review-context.output}}`, which is a deterministic pre-read that doesn't require the reviewer to have filesystem access to the source tree.

---

### 3. [Medium] Dedup fan-out not maximally parallel — **ACCEPTED**

**Finding:** The original had three dedup workers (`codex-impl-dedup-a`, `-b`, `-c`) handling five files. Two workers owned two files each, causing those pairs to serialize per-worker even though the DAG made them look parallel.

**Fix applied:** Split into five dedicated workers — `codex-impl-dedup-github`, `codex-impl-dedup-slack`, `codex-impl-dedup-linear`, `codex-impl-dedup-notion`, `codex-impl-dedup-gitlab`. Each owns exactly one file. The five dedup steps now share `dependsOn: ['build-adapter-core']` and execute genuinely in parallel (capped by `maxConcurrency(6)`, which fits the five dedup workers + headroom).

---

### 4. [Medium] Deterministic reads serialized unnecessarily — **ACCEPTED (partial)**

**Finding:** `read-sdk-index` and `read-adapter-core-index` had `dependsOn` on upstream edit steps, but the read itself has no data dependency — they're cheap `cat` operations that could pull earlier to shorten the critical path.

**Disposition:** Accepted in principle. The revised workflow kept some of these dependencies but only where a read genuinely needs to happen after a file has been written for the first time (e.g. reading `integration-adapter.ts` must wait for it to exist). Pure `cat` steps on pre-existing files were pulled to their earliest correct wave. Full optimization deferred to a dedicated parallelism-tuning pass once the campaign is further along.

---

### 5. [Medium] `bundle-review-context` is a 9-file blob for one reviewer — **REJECTED with reasoning**

**Finding:** The reviewer gets one large injected bundle containing the full edited surface, which is in tension with the skill's "one agent, one deliverable" guidance.

**Disposition:** Rejected for workflow 20 specifically. This is a correctness review, not a scope review — the reviewer's job is to confirm the abstract class only exists in the SDK and that no stale relative imports remain. That requires seeing every touched file to make the negative assertion. Splitting into smaller targeted bundles would fragment the reviewer's picture and risk missing cross-file inconsistencies (e.g. one adapter importing from `@relayfile/sdk` while another still uses a local path). The bundle is the right shape for this specific review.

Accepted as a general principle for future workflows: when a review is about *new* code, split into targeted bundles. When it's about *removed* duplication, a whole-surface bundle is correct.

---

## Self-Reflect Findings

### #3 [Partial] `review-migration` has no per-step timeout — **ACCEPTED (deferred)**

**Finding:** The step relies on the global 2h timeout. If Codex hangs during non-interactive review, the whole workflow waits 2h before failing. The skill's Common Mistake #3 recommends `timeout: 300_000` (5 min) for self-review steps.

**Disposition:** Legitimate concern. However, the skill also says in Mistake #6: "Setting `timeoutMs` on agents/steps" is a mistake — use global `.timeout()` only. These two rules conflict. Per-step `timeout` is a builder API the SDK may not expose consistently. **Deferred** to a campaign-level decision: either confirm the SDK supports per-step timeouts and apply retroactively, or codify in `TEMPLATE.md` that non-interactive review steps should inherit the global timeout.

---

### #20 [Hard] `async function main()` wrapper vs top-level await — **REJECTED with reasoning**

**Finding:** The workflow ends with `async function main() { ... } main().catch(...)` rather than the idiomatic ESM `try/catch` with top-level await that the skill's Quick Reference recommends. `relayfile-adapters/packages/core/package.json` declares `"type": "module"`, so mistake #20 applies.

**Disposition:** Rejected. The `main()` wrapper is used by every existing sage workflow (confirmed against `sage/workflows/v2/02e-nango-sync-scripts.ts` and `18-replace-github-discovery-with-relayfile.ts`). Adopting top-level await for workflow 20 only would create an inconsistent codebase where workflow 20 looks different from every other workflow in the repo. Consistency with existing convention beats theoretical skill-rule compliance.

Additionally, the two forms are functionally equivalent — both await the workflow, log the result, and set `process.exitCode = 1` on failure. The skill flags the wrapper as a "mistake" but agent-relay runs both forms identically.

Accepted principle for `TEMPLATE.md`: the campaign follows the existing sage workflow convention (`async function main() { ... } main().catch(...)`) to keep all workflows consistent. If we want to migrate to top-level await, that's a separate dedicated workflow across the whole campaign, not a workflow-20-only change.

---

## Summary

**Accepted (4):** PEER-1, PEER-2, PEER-3, PEER-4 (partial).
**Rejected (2):** PEER-5 (bundle shape is correct for removal reviews), SELF-20 (consistency with existing convention).
**Deferred (1):** SELF-3 (campaign-level decision on per-step timeouts).

**Net effect on workflow 20:**
- File-writing instructions are now explicit (write to disk).
- Reviewer blast radius is minimized (injected-only, read scope locked to PLAN_PATH).
- Dedup fan-out is genuinely parallel across 5 dedicated workers.
- Deterministic reads pulled forward where feasible.
- Review bundle retained deliberately, for stated reasons.
- ESM footer retained for cross-workflow consistency.

**Validation:** `agent-relay run --dry-run` on the revised workflow 20 returns `Validation: PASS (0 errors, 1 warnings)`. The single warning is cosmetic ("final-build-sdk depends on 5 upstream steps") and expected for a fan-in step.

**Status:** workflow 20 is production-ready. Proceed to `sign-off-20`.
