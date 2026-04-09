# Schema-Adapter Migration — Workflow Authoring Template

Reference card for every workflow in the `20-49` migration campaign. Each workflow in `relayfile-adapters/workflows/schema-adapter-migration/` MUST conform to the rules below. Deviations require an explicit note in the workflow JSDoc explaining why.

Source of truth: `skills/skills/writing-agent-relay-workflows/SKILL.md`. This template is a campaign-specific distillation — when in doubt, SKILL.md wins.

---

## 1. File naming

- Path: `relayfile-adapters/workflows/schema-adapter-migration/NN-kebab-case-name.ts`
- `NN` is a two-digit number in `20..49`, matching the entry in `BACKLOG.md`.
- `kebab-case-name` is the workflow slug — lowercase, hyphens only, no dates, no underscores.
- Examples:
  - `20-canonical-integration-adapter-sdk.ts`
  - `31-migrate-slack-adapter.ts`
  - `46-community-mapping-catalog.ts`

## 2. File header JSDoc

Every workflow begins with a JSDoc block in this shape:

```ts
/**
 * Workflow NN: <human title>.
 *
 * Phase:        <1-6>  <phase name from BACKLOG.md>
 * Depends on:   <comma-separated workflow numbers, or "none">
 * Parallel with:<comma-separated workflow numbers safe to run concurrently>
 * Packages:     <repo-relative paths touched, comma-separated>
 *
 * <one-paragraph description of what this workflow produces and why>
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/NN-<slug>.ts
 */
```

The `Packages:` line is load-bearing for wave planners — list every top-level repo-relative directory the workflow writes to.

## 3. ESM imports

Every package in this campaign is `"type": "module"`. Use published-entry ESM imports only:

```ts
import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';
```

Hard rules:
- No `require()`.
- No relative paths into `sdk` internals (`'../workflows/builder.js'` etc.).
- No hardcoded model strings (`'opus'`, `'gpt-5.4'`). Always `ClaudeModels.OPUS`, `CodexModels.GPT_5_4`, etc.
- No `createWorkflowRenderer`, no `.build()`, no `export default workflow(...)`. The runner executes the file as a subprocess — only `.run()` invocations produce steps.

## 4. `async main()` + footer

ESM supports top-level `await`, but this campaign uses an `async main()` wrapper for uniform error handling and exit-code propagation. Every file ends exactly like this:

```ts
async function main() {
  const result = await workflow('<workflow-slug>')
    // ...chain...
    .run({ cwd: process.cwd() });

  console.log('Result:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Do not add exit instructions to agent task strings — the runner handles termination.

## 5. `.run({ cwd: process.cwd() })` convention

The only permitted terminal call is `.run({ cwd: process.cwd() })`. This campaign is cross-repo: workflows are always invoked from the AgentWorkforce root, so `process.cwd()` is the parent of `sage/`, `relayfile/`, `relayfile-adapters/`, `skills/`. Never hardcode an absolute path, never use `__dirname`.

## 6. Required workflow fields

Every workflow declares, in order:

```ts
workflow('<slug>')                      // matches filename slug
  .description('<one-sentence summary>')
  .pattern('dag')                       // 'dag' is the default; only change with reason
  .channel('wf-<slug>')                 // see §9
  .maxConcurrency(4)                    // 4 default; 5-6 max; never >8
  .timeout(3_600_000)                   // 1h default; 2h for heavy write-heavy workflows
```

> **No `.packages()` / `.isolatedFrom()` / `.requiresBefore()` builder calls.** Earlier drafts of this template referenced those methods, but `WorkflowBuilder` in `@agent-relay/sdk` does not expose them — calling any of them throws `TypeError: ... is not a function` at workflow load time. Wave planners read package/dependency information from the **`Packages:` JSDoc header** (see §2) and from `BACKLOG.md`'s `depends-on` / `parallel-with` rows, so document that information there instead. If a workflow needs additional planner metadata, add it to the JSDoc header — never to the builder chain.

Never set per-step `timeoutMs` — use the global `.timeout()`.

## 7. Agent conventions

Preset matrix (enforced for this campaign):

| Role                                    | Preset      | CLI                 | Interactive |
|-----------------------------------------|-------------|---------------------|-------------|
| Coordination, channel monitoring        | `lead`      | `claude`            | yes (PTY)   |
| Bounded file edits / file creation      | `worker`    | `codex` or `claude` | no          |
| Peer review / verdicts                  | `reviewer`  | `codex`             | no          |
| Reading code, writing findings only     | `analyst`   | `codex` or `claude` | no          |

Rules:
- **Model constants only** — `ClaudeModels.OPUS` / `ClaudeModels.SONNET` / `CodexModels.GPT_5_4`. Never strings.
- **Non-interactive implementation steps use `preset: 'worker'`.** This keeps stdout clean so downstream steps can safely chain `{{steps.X.output}}`.
- **Scope `permissions.files.write` per agent** — each worker writes only to the paths it owns; every worker has a `deny` list that includes `'.env', '.env.*', '**/*.secret', '**/node_modules/**'` plus any files owned by a parallel sibling.
- **`permissions.files.read`** is narrow too — the worker reads only what it genuinely needs plus `skills/skills/writing-agent-relay-workflows/**` if it needs to consult the skill.
- **`permissions.access`** is `'readonly'` for reviewer/analyst agents, `'restricted'` for workers/leads; never `'unrestricted'`.
- **`permissions.exec`** is `[]` unless a worker genuinely needs to run a binary (and then list the exact commands, e.g. `['tsc', 'pnpm']`).
- **One agent, one responsibility.** Do not reuse the same agent name for unrelated steps; define a new agent with a scoped permission block.

### 7a. Preset selection — the sprawl rule

**Use `preset: 'lead'` ONLY for steps whose inherent job is open-ended coordination on a channel.** Everything else is a worker. This is a hard rule learned from meta-workflow run `bcn1d1sqc` (2026-04-09), where two separate steps (`self-reflect-20` on the first run, `revise-workflow-20` on the second) failed their `file_exists` gates because an interactive `lead` agent ignored "single deliverable" constraints and went into autonomous validation mode — running `tsc`, `tsx`, even spawning a nested `agent-relay run --dry-run` from inside the step.

The root cause: interactive `lead` agents (PTY + full tool access + relay access) are allowed to take autonomous actions the moment they identify a "better" path. Prompt constraints ("IMPORTANT: do not run shell commands") do not reliably stop them. The only mechanism that does stop them is `preset: 'worker'`, which runs the agent one-shot via `claude -p` / `codex exec` — bounded by process lifetime, cannot sprawl.

**Decision rubric:**

| Step's inherent job | Preset |
|---|---|
| Research across many files, produce a synthesis | `lead` (needs wide read + judgment) |
| Write a spec/plan/template/doc file | `worker` (bounded deliverable, one-shot is enough) |
| Write a code file (new) | `worker` |
| Edit an existing code file (post-read injection) | `worker` |
| Self-reflect / critique existing output | `worker` (produce a document, not a dialog) |
| Peer review / verdict | `reviewer` (one-shot, pre-injected) |
| Apply accepted review findings (revise) | `worker` (two deliverables: decisions doc + edited file) |
| Coordinate a team on a shared channel | `lead` (inherently needs channel + tools) |
| Monitor long-running workers and issue OWNER_DECISION | `lead` |

**If in doubt, choose `worker`.** The failure mode of a worker being too bounded (needs a file it can't access) is loud and fast — the step fails in seconds. The failure mode of a lead being too unbounded (spawning nested workflows, running validation loops) is expensive — minutes of tool sprawl before the `file_exists` gate catches a missing deliverable.

**For any worker step that produces a file:**
- Pre-inject every input via deterministic `cat` predecessors. Do not rely on the worker's Read tool for anything larger than a handful of lines.
- Explicitly list forbidden shell commands in the task prompt (`Do NOT run tsc, tsx, agent-relay, npm, git, node`).
- State deliverable order: "Write FILE_A first, THEN edit FILE_B."
- Add `IMPORTANT: Write the file to disk. Do NOT output to stdout.`
- Verify with `file_exists` on the primary deliverable.

## 8. Step patterns

### 8a. Read-then-edit

Whenever an agent needs to modify an existing file, the file is read by a deterministic step immediately before the edit step, and injected into the edit prompt:

```ts
.step('read-schema-adapter', {
  type: 'deterministic',
  command: 'cat relayfile-adapters/packages/core/src/runtime/schema-adapter.ts',
  captureOutput: true,
  failOnError: true,
})
.step('edit-schema-adapter', {
  agent: 'codex-impl',
  dependsOn: ['read-schema-adapter'],
  task: `Current contents of schema-adapter.ts:
{{steps.read-schema-adapter.output}}

Add the \`sync\` abstract method with the SyncOptions shape below.
Only edit this one file.`,
  verification: { type: 'exit_code' },
})
```

Do not ask a non-interactive agent to open a file with its own tools — pre-inject.

### 8b. Multi-file split — one file per step

Agents reliably edit 1-2 files per step and fail at 4+. If a workflow touches N files, emit N edit steps. Each edit step:
- Has its own `read-<target>` deterministic predecessor.
- Tells the agent *explicitly*: `Only edit this one file: <path>`.
- Is followed by a deterministic `verify-<target>` gate (`git diff --quiet` or `file_exists`) before downstream steps run.

For parallel fan-out, the edit steps share a `dependsOn` on a common context step, and a single merge step lists every verify step in its `dependsOn`.

### 8c. Deterministic verify gates

Every file-creating or file-mutating step gets a deterministic gate immediately after:

- **File creation** → `file_exists` on the exact path. Never trust `exit_code` for creation — non-interactive agents exit 0 without writing if the cwd/path is wrong.
- **File mutation** → `exit_code` on the edit step plus a follow-up deterministic step that runs `git diff --quiet <path>` (exit 1 if unmodified).
- **Code-wide gates** → deterministic `tsc` / `pnpm build` step after all edits in a package have landed, gated with `failOnError: true`.

Only four verification types are valid: `exit_code`, `output_contains`, `file_exists`, `custom`. Anything else is silently ignored. Prefer `exit_code` on code-editing steps to avoid the verification-token double-match gotcha.

### 8d. Pre-injection for non-interactive agents

Non-interactive agents (`worker`/`reviewer`/`analyst`) should never be asked to read large files through their own tool use. Pre-read via a deterministic `cat` step and inject via `{{steps.STEP.output}}`. Only chain output from deterministic steps or `preset: 'worker'` — never from interactive leads.

### 8e. Task prompt length

Tasks are 10-20 lines max. If a task needs more, split into a lead + workers team sharing a dedicated channel — see SKILL.md "Step Sizing" and "Multi-File Edit Pattern".

### 8f. Deterministic commits

When a workflow needs to commit, it is always a deterministic step, never an agent step. List exact paths, never `git add -A`.

## 9. Channel naming

Every workflow declares its own channel: `.channel('wf-<workflow-slug>')` where `<workflow-slug>` exactly matches the filename slug (without the `NN-` prefix *or* with it — be consistent; this campaign uses the full slug *with* prefix, e.g. `wf-20-canonical-integration-adapter-sdk`). Never use `general`. Sub-channels spawned at runtime (e.g. team channels) follow `wf-<slug>-<topic>`.

## 10. Cross-repo workflows

Every workflow in this campaign is cross-repo — they reach into `sage/`, `relayfile/`, `relayfile-adapters/`, `skills/` from the AgentWorkforce root. Rules:

- **cwd is always the AgentWorkforce root.** Invoke as `agent-relay run relayfile-adapters/workflows/schema-adapter-migration/NN-<slug>.ts`. Document this in the JSDoc header.
- **All permission paths are repo-relative to that cwd.** Examples:
  - `read: ['relayfile/packages/sdk/typescript/src/**', 'relayfile-adapters/packages/core/src/**']`
  - `write: ['relayfile-adapters/packages/github/src/**']`
- **Deterministic commands use repo-relative paths too**: `cat relayfile-adapters/packages/core/src/runtime/schema-adapter.ts`, `(cd relayfile/packages/sdk/typescript && npm run build)`. Never absolute paths, never stray `cd` outside a subshell.
- **Permissions must include every repo the workflow reads from.** A GitHub migration workflow that also reads SKILL.md needs `skills/skills/writing-agent-relay-workflows/**` in its read list.

### 10a. Build tool: npm, not pnpm

Both `relayfile/` and `relayfile-adapters/` use **npm** (confirmed by `package-lock.json`, absence of `pnpm-workspace.yaml` anywhere). Earlier workflow drafts used `pnpm --filter @relayfile/<pkg> build` — **this is wrong**. pnpm `--filter` requires a workspace that doesn't exist in these repos, and even when pnpm silently scans sibling directories it's unpredictable.

**Correct form for any TS package build:**

```ts
command: '(cd relayfile/packages/sdk/typescript && npm run build)',
```

Wrapped in a subshell so the `cd` is scoped to the deterministic step's execution and doesn't leak into the workflow's cwd. Every adapter package has a `"build": "tsc -p tsconfig.json"` script (or just `"tsc"`); there are no workspace-level build commands.

### 10b. One-time repo setup: `npm link @relayfile/sdk`

**The two repos are NOT a shared workspace.** `relayfile-adapters/node_modules/@relayfile/sdk` is installed from the npm registry (v0.1.6). Adding a new file to `relayfile/packages/sdk/typescript/src/` does NOT automatically make it visible to `relayfile-adapters` — it has to be published to the registry AND adapter-core's dependency has to be bumped, OR a local link has to be established.

For the campaign to work end-to-end, establish the link **once**, before running any Phase 1/3 workflow:

```bash
cd /Users/khaliqgant/Projects/AgentWorkforce/relayfile/packages/sdk/typescript
npm run build
npm link

cd /Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapters
npm link @relayfile/sdk
```

Verify with:

```bash
readlink /Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapters/node_modules/@relayfile/sdk
# should print: ../../../relayfile/packages/sdk/typescript
```

Once linked, every `(cd relayfile-adapters/packages/<pkg> && npm run build)` sees the local SDK source (including any new files Phase 1 workflows add). The link persists across reboots. If it's accidentally broken (e.g. `npm install` overwrites node_modules), re-run the second command to reestablish.

**Campaign workflows assume the link is in place.** Don't add link-setup steps to individual workflows — that creates brittle per-workflow state. If the link is missing, the `build-adapter-core` or `regression-build-adapters` step fails with "Module '@relayfile/sdk' has no exported member 'IntegrationAdapter'" and the operator needs to re-link manually.

## 11. Common-mistakes checklist (campaign-specific)

Review every workflow against this table before committing. Every row is a mistake that has bitten similar workflows in SKILL.md.

| # | Mistake | Fix |
|---|---------|-----|
| 1 | Sequential chain where no data dependency exists | Share `dependsOn` to fan out independent edits |
| 2 | `{{steps.X.output}}` without matching `dependsOn: ['X']` | Add the dep; output is not available otherwise |
| 3 | Chaining output from an interactive `lead` agent | PTY output is garbled — only chain from deterministic steps or `preset: 'worker'` |
| 4 | Single step editing 4+ files | Split to one file per step, each with its own read + verify |
| 5 | File-creation step verified with `exit_code` only | Use `file_exists` on the exact path — `exit_code` auto-passes even with nothing written |
| 6 | Code-edit step verified with `output_contains` sentinel | Use `exit_code`; avoid the verification-token double-match gotcha |
| 7 | Invalid `verification.type` (e.g. `'deterministic'`, `'diff'`) | Only `exit_code`, `output_contains`, `file_exists`, `custom` are valid; anything else is silently ignored |
| 8 | Per-step `timeoutMs` | Use global `.timeout()` only |
| 9 | Workflow timeout under 30 minutes | Default `3_600_000` (1h); heavy workflows `7_200_000` (2h) |
| 10 | `maxConcurrency: 16` or similar | Cap at 4 default, 6 max; broker times out >8 |
| 11 | Using the `general` channel | Set `.channel('wf-<slug>')` |
| 12 | Hardcoded model strings (`'opus'`, `'sonnet'`, `'gpt-5.4'`) | Use `ClaudeModels.OPUS`, etc. from `@agent-relay/config` |
| 13 | `require()` or relative import into SDK internals | ESM `import { workflow } from '@agent-relay/sdk/workflows'` |
| 14 | Missing `.run({ cwd: process.cwd() })` | The runner only executes `.run()` invocations — never rely on exports |
| 15 | No `main().catch(...)` footer | Unhandled rejections exit silently with code 0 |
| 16 | `.build()` at end of chain / `export default workflow(...)` | Chain ends with `.run()` — no `.build()`, no default export |
| 17 | `pattern('supervisor')` with one agent | Use `dag` for one-agent or simple parallel flows |
| 18 | `fan-out`/`hub-spoke` used for plain parallel workers | Use `dag` with shared `dependsOn` |
| 19 | Worker step depending on a lead step that waits for workers | Deadlock — both should depend on a shared context step |
| 20 | Exit instructions in task strings (`"then exit"`) | Runner handles termination automatically |
| 21 | YAML numbers with `_` separators | Invalid YAML — use plain digits |
| 22 | Non-interactive agent reading large files via its own tools | Pre-read via `cat` deterministic step, inject via `{{steps.X.output}}` |
| 23 | Worker without `preset: 'worker'` in a chain that reads its output | PTY output can't be chained — add `preset: 'worker'` |
| 24 | Permission `write: ['**']` | Scope to the exact paths the agent owns |
| 25 | Missing `deny` list covering `.env*`, `**/*.secret`, `**/node_modules/**` | Add; never omit |
| 26 | Hardcoded absolute paths (`/Users/...`, `__dirname`) | Use repo-relative paths from the AgentWorkforce root |
| 27 | Relying on an agent to run `git commit` | Always commit with a deterministic step listing exact files |
| 28 | Missing `tsc`/build gate after code edits in a TS package | Add a deterministic `pnpm --filter <pkg> build` step with `failOnError: true` |
| 29 | Cross-repo workflow without the AgentWorkforce-root note in JSDoc | Add the `Run from the AgentWorkforce root` stanza |
| 30 | Workflow slug in `workflow('...')` differs from filename | Keep them identical — waves key off the slug |
| 31 | Self-review step with no timeout consideration | Self-review by a non-interactive reviewer is fine; interactive self-review needs the global `.timeout()` to cover hangs |
| 32 | Parallel workers writing overlapping file sets | Each worker's `write` list must be disjoint from every other parallel worker's `write` list |
| 33 | Two parallel workflows writing the same file | Declare `.isolatedFrom()` only for truly disjoint workflows; otherwise use `.requiresBefore()` |
| 34 | Forgetting to pre-inject the SKILL for reviewers | If a reviewer is expected to quote SKILL rules, include `skills/skills/writing-agent-relay-workflows/**` in its read permissions |
| 35 | Calling `.packages()` / `.isolatedFrom()` / `.requiresBefore()` on the builder | Those methods do not exist on `WorkflowBuilder` and throw `TypeError` at load time. Document package + dependency info in the JSDoc header (§2) and `BACKLOG.md`, never on the builder chain |
| 36 | Using `preset: 'lead'` for a bounded single-deliverable step | Interactive lead agents ignore "single deliverable" prompts and sprawl into tool chains (tsc/tsx/nested workflows). Use `preset: 'worker'` for any step that produces a specific file. See §7a |
| 37 | Self-reflection or revise step using `preset: 'lead'` | Both failure modes from run `bcn1d1sqc`. Self-reflect and revise must use `preset: 'worker'` with pre-injected inputs and explicit shell prohibition |
| 38 | Worker step asked to run shell commands ("verify the fix with tsc") | Workers should never self-validate via shell. Put validation in a downstream deterministic step — the worker's job is to produce the artifact, not to prove it's correct |
| 39 | Letting an interactive lead see a peer's output before the synthesis step | If `claude-lead` reads `PEER_REVIEW_*.md` during a self-reflect step, it will start fixing issues instead of documenting self-findings. Either use a worker (preferred) or sequence so self-reflection runs before peer review is visible |
| 40 | Assuming class duplication across packages means the classes are truly duplicates | Classes with the same name in different packages may encode different contracts (constructor shape, protected fields, return types). Compare semantically, not syntactically, before trying to dedup. Grep catches names; it doesn't catch `writeBack(): Promise<void>` vs `writeBack(): Promise<WritebackResult>`. Workflow 20's failed dedup cost ~20 minutes per run until this was caught. Always add a regression-build gate that compiles every sibling package to catch semantic conflicts early |
| 41 | `pnpm --filter @relayfile/<pkg> build` in workflows touching relayfile/relayfile-adapters | Both repos use npm (`package-lock.json`, no `pnpm-workspace.yaml`). Use `(cd <pkg-path> && npm run build)` instead. See §10a |
| 42 | Assuming cross-repo source imports "just work" without a link | `relayfile-adapters/node_modules/@relayfile/sdk` is a registry install. Adding files to `relayfile/packages/sdk/typescript/src/` has zero effect until `npm link @relayfile/sdk` is established (see §10b). If `build-adapter-core` reports "has no exported member 'IntegrationAdapter'", the link is the root cause — not a grep pattern, not a missing import statement |
| 43 | Blanket-migrating all adapter packages in one workflow | The 5 hand-coded adapters in github/slack/linear/notion/gitlab have divergent contracts; dedup-everything workflows hit 17+ compile errors in the fan-out phase. Each adapter gets its own per-package migration workflow in Phase 3 with an `analyze-adapter` step that picks Mode A (full SchemaAdapter replacement), Mode B (extension), or Mode C (legacy exception). See BACKLOG.md Phase 3 prelude |

---

TEMPLATE_COMPLETE
