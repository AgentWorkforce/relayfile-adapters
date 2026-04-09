# Schema Adapter Migration — Research

Source material: `skills/skills/writing-agent-relay-workflows/SKILL.md`, `sage/workflows/v2/02e-nango-sync-scripts.ts`, `relayfile-adapters/packages/core/src/runtime/schema-adapter.ts`, `relayfile-adapters/packages/core/src/spec/types.ts`, `relayfile-adapters/packages/github/github.mapping.yaml`, `relayfile-adapters/packages/notion/src/adapter.ts`, `relayfile/packages/sdk/typescript/src/connection.ts`, `sage/src/integrations/relayfile-bridge.ts`.

## 1. Authoring Conventions (distilled from SKILL.md)

### Module system
- TypeScript is preferred; YAML only for trivial config-driven workflows.
- Check the target `package.json`: if `"type": "module"`, use ESM `import` + top-level `await` (or `async main()` + `main().catch()`). Never use `require()` in ESM.
- Import the builder from the published entry: `import { workflow } from '@agent-relay/sdk/workflows'`. Never relative paths like `'../workflows/builder.js'`.
- Model constants only: `import { ClaudeModels, CodexModels } from '@agent-relay/config'`. Never hardcoded strings (`'opus'`, `'sonnet'`).
- The file must actually call `.run({ cwd: process.cwd() })`. `agent-relay run` executes the file as a subprocess — it does **not** inspect exports. No `.build()`, no `createWorkflowRenderer`.

### Preset usage (`.agent(...)`)
| Preset    | Interactive | Use for                                      |
|-----------|-------------|----------------------------------------------|
| `lead`    | yes (PTY)   | Coordination, channel monitoring             |
| `worker`  | no (exec)   | Bounded implementation, clean stdout chains  |
| `reviewer`| no (exec)   | Reading artifacts, producing verdicts        |
| `analyst` | no (exec)   | Reading code/files, writing findings         |

Only chain `{{steps.X.output}}` from deterministic steps or non-interactive presets — interactive PTY output is garbled. Pre-inject large files into workers via a deterministic `cat` read instead of asking the agent to open them.

### Verification gates
Only four types are valid: `exit_code`, `output_contains`, `file_exists`, `custom`. Anything else is silently ignored. Prefer `file_exists` for file-creation steps and `exit_code` for code-editing steps (avoids the verification-token double-match gotcha).

### Step sizing (one agent, one deliverable)
- Task prompts: 10-20 lines. Anything longer → split into a lead + workers team on a shared channel.
- Multi-file edits: one file per step, with a `git diff --quiet` / `file_exists` verify gate after each. Tell the agent "Only edit this one file". Agents reliably edit 1-2 files per step; fail on 4+.
- Always commit via a deterministic step — never ask an agent to `git commit`.

### Permission scoping
Each agent gets `permissions: { access, files: { read, write, deny }, exec }`. Workers must only `write` the paths they own. Tight deny lists stop cross-worker stomping in parallel fan-out. Permission paths are repo-relative to the workflow's `cwd` (AgentWorkforce root for cross-repo workflows).

### Parallelism + concurrency
- Design for wave-level parallelism (4-7× speedup). Declare `.packages()` and `.isolatedFrom()` so planners can group waves.
- Within a workflow, share `dependsOn` between independent branches to fan out. Merge at a single verify/review step.
- Cap `.maxConcurrency(4)` by default; 5-6 max for 10+ parallel agents. Broker times out above ~8.

### Common mistakes to avoid
Sequential chains where no data dependency exists · self-review without `timeout` · per-step `timeoutMs` (use global `.timeout()`) · `general` channel (use `wf-<slug>`) · `{{steps.X.output}}` without matching `dependsOn` · 100-line task prompts · `maxConcurrency: 16` · non-interactive agent reading large files (pre-read instead) · workers depending on a lead step that waits for workers (deadlock) · `fan-out`/`hub-spoke` for simple parallel work (use `dag`) · YAML numbers with `_` separators · `exit_code` on file-creation steps that auto-pass without writing · invalid verification types · exit instructions in task strings (runner handles it) · `pattern('supervisor')` with a single agent.

## 2. Current Architectural Split

Two parallel worlds exist in `relayfile-adapters/`:

### (a) Hand-coded adapters
Each integration package (`github/`, `slack/`, `linear/`, `notion/`, `gitlab/`, `teams/`) declares its own `abstract class IntegrationAdapter` (see `notion/src/adapter.ts:33`) and a concrete subclass with bespoke `computePath`, `computeSemantics`, `ingestWebhook`, `sync`, `writeBack` implementations. The abstract class shape diverges slightly per package — e.g. Notion's `computePath` takes a `context` record, others do not. This duplication is the migration target.

### (b) SchemaAdapter (the canonical runtime)
`relayfile-adapters/packages/core/src/runtime/schema-adapter.ts` defines:
- `abstract class IntegrationAdapter` with `{ ingestWebhook, computePath, computeSemantics, supportedEvents? }`
- `class SchemaAdapter extends IntegrationAdapter` — declarative, driven entirely by a `MappingSpec` (`packages/core/src/spec/types.ts`):
  - `webhooks: Record<string, WebhookMapping>` — lookup by eventType/objectType/eventRoot, path templated via `interpolateTemplate`, payload projected via `extract`.
  - `resources?: Record<string, ResourceMapping>` — REST endpoint descriptor + canonical VFS path.
  - `writebacks?: Record<string, WritebackMapping>` — minimatch glob → `METHOD /endpoint/{placeholder}` proxied through a `ConnectionProvider`.
- Writeback connection-id resolution order: body-embedded `connectionId`, `resolveConnectionId` callback, `defaultConnectionId`.

`ConnectionProvider` (`relayfile/packages/sdk/typescript/src/connection.ts`) is the current published abstraction: `{ name, proxy, healthCheck, handleWebhook?, getConnection?, listConnections? }`. `IntegrationAdapter` is **not** exported from the SDK today — it only lives in `adapter-core`. That is what workflow 20 will promote.

## 3. Mapping YAML Status

Adapters with mapping YAMLs today:
- `github/github.mapping.yaml` — webhooks (pull_request, pull_request_review, push, issues), resources (pull_request, pull_request_files), writebacks (review, comment). Used as the skeleton for the SchemaAdapter example.
- `gitlab/gitlab.mapping.yaml`
- `notion/notion.mapping.yaml`
- `teams/teams.mapping.yaml`

Adapters still missing a mapping YAML (Phase 3 authors must write one):
- `slack/` — write `slack.mapping.yaml` alongside refactor to SchemaAdapter.
- `linear/` — write `linear.mapping.yaml`; Linear is GraphQL, so the ResourceMapping schema needs a graphql resource type (tracked in workflow 21).

Notion is expected to keep a custom subclass for block-tree walking even after adopting SchemaAdapter for the rest; that custom logic cannot be expressed declaratively in the current spec.

## 4. The Three Sync Paths

All three share one mapping YAML and the SchemaAdapter runtime. They differ in who runs the loop and who holds credentials.

### (a) Nango-native
- Sync scripts live in `sage/nango-integrations/<provider>/syncs/*.ts` (see the existing `02e-nango-sync-scripts.ts` workflow).
- Nango owns auth + scheduling + checkpoint; writes records to its own cache, then webhooks `relayfile-cloud`.
- Sage consumes via `RelayFileBridge.processSyncWebhook()` (`sage/src/integrations/relayfile-bridge.ts:586`) which paginates `nango.listRecords()` and routes each record through an adapter's `computePath` / `computeSemantics` before `client.writeFile()`. The bridge already lazy-loads `@relayfile/adapter-github|slack|notion|linear`.
- Today every provider is hand-coded — Phase 3 replaces them with SchemaAdapter instances pointed at the mapping YAMLs.

### (b) Nango-unauth (planned)
- Uses Nango's `unauthenticated` integration type; the consumer passes credentials into the sync via connection metadata instead of letting Nango do the OAuth dance. Good for composed providers (e.g. Composio → Gmail).
- New package `@relayfile/provider-nango-unauth` (workflow 24) exposes a `ConnectionProvider` that reads metadata → proxies requests. Sync runs on Nango infra just like the native path, but the YAML + SchemaAdapter stay identical.
- First real consumer targeted for workflow 38 (Composio → Gmail).

### (c) Direct proxy
- No Nango runtime. Consumer (e.g. sage, a CLI, or a test harness) instantiates the adapter locally and drives sync by calling `SchemaAdapter.sync(resourceName, options)` — a new generic paginator to be added in workflow 22.
- Checkpoint state persists in the target RelayFile workspace under a `.sync-state/` convention (workflow 40). Cron/trigger lives wherever the consumer runs — e.g. a `relaycron` schedule, a CI job, or a sage background worker.
- This path is what unblocks `relayfile adapter new --from-openapi=<url>` — a newcomer can ship a working integration with zero Nango setup.

## 5. Open Questions for Later Phases
- Where should the canonical `IntegrationAdapter` live in the SDK tree — new `integration-adapter.ts` file, or folded into `index.ts`? (Workflow 20.)
- `MappingSpec` needs a `sync` resource block (pagination type, cursor field, watermark field, page-size default) to make `SchemaAdapter.sync()` generic. (Workflow 21.)
- Round-trip fixture format for the parity test suite — JSONL VFS snapshot vs. tar of written paths. (Workflow 23 / 36.)

RESEARCH_COMPLETE
