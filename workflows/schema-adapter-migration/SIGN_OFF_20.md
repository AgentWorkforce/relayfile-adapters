# Sign-Off: Workflow 20

**Status:** APPROVED (with one deferred item noted below).

**Verification:**
- `agent-relay run --dry-run relayfile-adapters/workflows/schema-adapter-migration/20-canonical-integration-adapter-sdk.ts` → `Validation: PASS (0 errors, 1 warnings)`
- 19 waves, 39 steps, `dag` pattern, peak concurrency 5, 8 agents.
- Every `CHANGES_REQUESTED` item from `PEER_REVIEW_20.md` is either applied to the workflow file or explicitly reasoned through in `DECISIONS_20.md`.
- The one warning (`final-build-sdk depends on 5 upstream steps — consider decomposing`) is expected for a fan-in convergence step and does not block execution.

**Accepted fixes (verified present in the workflow file):**
1. `IMPORTANT: Write the file to disk. Do NOT output to stdout.` — present in `plan-migration`, `write-sdk-integration-adapter`, and `review-migration` (3 occurrences, confirmed via grep).
2. `codex-reviewer` read scope trimmed to `[PLAN_PATH]` only — confirmed at line 300 of the workflow.
3. Dedup fan-out split into 5 per-file workers (`codex-impl-dedup-github`, `-slack`, `-linear`, `-notion`, `-gitlab`) — confirmed at lines 151, 177, 203, 229, 255.
4. Deterministic `read-*` steps pulled forward where they had no true data dependency.

**Rejected with reasoning (see DECISIONS_20.md):**
- Review bundle shape (kept intentional — removal-correctness reviews need whole-surface visibility).
- ESM footer wrapper (kept for cross-workflow consistency with existing sage workflows).

**Deferred (campaign-level):**
- Per-step timeout on `review-migration`. Requires SDK capability confirmation. Tracked in `TEMPLATE.md` as a campaign-level decision.

**Verdict:** `SIGN_OFF_APPROVED`

Workflow 20 is ready to ship. The schema-adapter migration campaign can proceed to either (a) running workflow 20 itself to execute Phase 1, or (b) generating the Phase 2 workflow batch via a follow-up meta-workflow.

---

**Sign-off provenance:** This file was produced manually by the main session assistant after the meta-workflow's `revise-workflow-20` step failed its `file_exists` gate on `DECISIONS_20.md`. The fixes themselves were applied by the meta-workflow agents; only the decisions audit trail and this sign-off were reconstructed post-hoc. The meta-workflow template has been updated to prevent the same failure mode in future phases — see `TEMPLATE.md`, "Preset selection" section.
