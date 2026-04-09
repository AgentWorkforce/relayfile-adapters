# Schema Adapter Migration — Backlog (Workflows 20-49)

Source of truth for the campaign that unifies every `relayfile-adapters/packages/*` integration onto the canonical `SchemaAdapter` + `MappingSpec` runtime, and lands the three sync paths (Nango-native, Nango-unauth, direct-proxy) on one code path. Each workflow below is an independently runnable `agent-relay` workflow file under `relayfile-adapters/workflows/schema-adapter-migration/`. Slugs are used as filename stems (e.g. `20-sdk-integration-adapter.ts`) and as the `.slug()` call inside each builder. See `RESEARCH.md` for architectural background and the four-type verification-gate contract.

Phase summary:
- Phase 1 (20-24) — Foundation. Sequential. Unblocks every later phase.
- Phase 2 (25-29) — Mapping toolchain. Parallelizable once Phase 1 lands.
- Phase 3 (30-36) — Adapter migrations. Fans out, one package per workflow.
- Phase 4 (37-41) — Sage consumer integration. Mostly sequential; gated on Phase 3 parity.
- Phase 5 (42-45) — Ingestion hardening. Parallelizable, tool-side improvements.
- Phase 6 (46-49) — Catalog + polish. Parallelizable, low priority.

---

## Phase 1 — Foundation (20-24)

### 20. Canonical IntegrationAdapter moved to @relayfile/sdk
- Phase: 1
- Slug: `sdk-integration-adapter`
- Depends-on: (none — campaign entry point)
- Parallel-with: (none — every later workflow imports from the new SDK surface)

Promote the `abstract class IntegrationAdapter` currently living in `relayfile-adapters/packages/core/src/runtime/schema-adapter.ts` into the published `@relayfile/sdk` TypeScript package so that every downstream adapter package, the sage bridge, and the CLI can all `import { IntegrationAdapter, SchemaAdapter } from '@relayfile/sdk'`. Today the shape diverges: Notion's `computePath(raw, context)` takes a context record, the others do not; `supportedEvents` is optional on some subclasses and required on others. Workflow 20 lands the canonical shape — `{ ingestWebhook, computePath, computeSemantics, supportedEvents? }` with an optional `context?: AdapterContext` second argument on `computePath` / `computeSemantics` — and rewires `adapter-core` to re-export from the SDK so existing imports keep working during the migration. No behavior change; purely a code-movement workflow with downstream build verification.

Files touched:
- `relayfile/packages/sdk/typescript/src/integration-adapter.ts` (new)
- `relayfile/packages/sdk/typescript/src/index.ts`
- `relayfile-adapters/packages/core/src/runtime/schema-adapter.ts`
- `relayfile-adapters/packages/core/src/index.ts`
- `relayfile/packages/sdk/typescript/package.json` (version bump)
- `relayfile-adapters/packages/core/package.json` (dependency bump)

Agents:
- `worker` × 1 — move the class + update exports (one file focus at a time, chained by `dependsOn`).
- `reviewer` × 1 — diff check: ensure no behavior drift, no stale relative imports, SDK entry point re-exports type-equivalent shape.

Verification gates:
- `file_exists`: `relayfile/packages/sdk/typescript/src/integration-adapter.ts`
- `exit_code`: `pnpm --filter @relayfile/sdk build`
- `exit_code`: `pnpm --filter @relayfile/adapter-core build`
- `exit_code`: `pnpm --filter @relayfile/adapter-github typecheck` (downstream smoke)

Risks / notes:
- SDK is a published package — must bump version and keep the old `adapter-core` re-export path alive for at least the length of this campaign to avoid breaking sage's lazy-loaded imports (`sage/src/integrations/relayfile-bridge.ts:586`).
- `AdapterContext` shape is not yet agreed; keep it `Record<string, unknown>` for now and tighten in workflow 21.

---

### 21. Extend MappingSpec with declarative pagination + sync resource config
- Phase: 1
- Slug: `mapping-spec-sync-block`
- Depends-on: 20
- Parallel-with: (none — 22 consumes the types this workflow lands)

Extend `relayfile-adapters/packages/core/src/spec/types.ts` so that a `ResourceMapping` can declare how a generic paginator should walk the endpoint: pagination strategy (`cursor`, `page`, `offset`, `link-header`, `graphql-connection`), cursor field path, page-size parameter name and default, watermark field (for incremental syncs), max-pages safety cap, and an optional `extract` projection identical to the webhook `extract` that maps the wire shape onto the canonical VFS record. Also add a top-level `syncs?: Record<string, SyncSpec>` table that names logical sync resources (e.g. `"issues"`, `"pull_requests"`) and points at a `ResourceMapping` plus an optional list of derived child resources (e.g. `pull_request` → `pull_request_files`). This block is what workflow 22's generic `SchemaAdapter.sync()` consumes. Also needed: a GraphQL resource variant for Linear (workflow 32) — `type: 'graphql'` with `query`, `variables`, `connectionPath`.

Files touched:
- `relayfile-adapters/packages/core/src/spec/types.ts`
- `relayfile-adapters/packages/core/src/spec/validate.ts` (schema check for new fields)
- `relayfile-adapters/packages/core/src/spec/__tests__/types.test.ts` (new)
- `relayfile-adapters/packages/github/github.mapping.yaml` (add a `syncs:` block as the reference example)

Agents:
- `analyst` × 1 — read `RESEARCH.md §5` + GitHub/Linear/Slack REST docs, draft the type signatures.
- `worker` × 1 — land the types + validator changes + example YAML update.
- `reviewer` × 1 — confirm the GraphQL branch is distinguishable from REST at the type level (no `never`-narrowing leaks).

Verification gates:
- `exit_code`: `pnpm --filter @relayfile/adapter-core typecheck`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- spec/`
- `output_contains`: validator rejects a mapping with `pagination: cursor` but no `cursorPath` (unit test surfaces "cursorPath required")

Risks / notes:
- GraphQL resource type must not force REST-only consumers to handle a new required field — use a discriminated union keyed on `type: 'rest' | 'graphql'`.
- Don't over-model pagination — the five strategies listed cover every integration in Phase 3; resist adding more until a real adapter asks.

---

### 22. Implement SchemaAdapter.sync(resourceName, options) as generic paginator
- Phase: 1
- Slug: `schema-adapter-sync`
- Depends-on: 20, 21
- Parallel-with: (none — 23 validates this, 24 uses it as its proof-of-life consumer)

Add an async `sync(resourceName: string, options: SyncOptions): AsyncIterable<SyncedRecord>` method to `SchemaAdapter` in `relayfile-adapters/packages/core/src/runtime/schema-adapter.ts`. The method looks up `spec.syncs[resourceName]`, resolves the attached `ResourceMapping`, and drives a pagination loop using the strategy declared in workflow 21. For each page it runs `connectionProvider.proxy()` (REST) or `.graphql()` (new thin helper on `ConnectionProvider`, or reuse `proxy` with a GraphQL body), applies the resource's `extract` projection, yields `{ path: computePath(record), semantics: computeSemantics(record), record }` tuples, and handles checkpoint persistence via an injectable `SyncState` interface (`read(resource)`, `write(resource, cursor)`) so callers decide where state lives (see workflow 40). Respects `maxPages`, `since` watermark, and a `signal: AbortSignal`. Returns total counts via a resolved `stats` on completion.

Files touched:
- `relayfile-adapters/packages/core/src/runtime/schema-adapter.ts`
- `relayfile-adapters/packages/core/src/runtime/paginator.ts` (new — pure strategy functions)
- `relayfile-adapters/packages/core/src/runtime/sync-state.ts` (new — `SyncState` interface + `InMemorySyncState` default)
- `relayfile-adapters/packages/core/src/runtime/__tests__/paginator.test.ts` (new — unit test per strategy with fake fetcher)
- `relayfile/packages/sdk/typescript/src/connection.ts` (optional `graphql` helper on `ConnectionProvider`)

Agents:
- `worker` × 1 — paginator strategies (pure, easy to unit test).
- `worker` × 1 — wire paginator into `SchemaAdapter.sync` and `SyncState` injection (depends on the first worker via `dependsOn`).
- `reviewer` × 1 — confirm AbortSignal honored mid-page, no unbounded loops, cursor write happens after record emit (not before, to avoid data loss on crash).

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/runtime/paginator.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- runtime/paginator`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- runtime/schema-adapter`
- `output_contains`: paginator test output contains "respects maxPages" and "resumes from checkpoint"

Risks / notes:
- Off-by-one on cursor checkpointing is the classic bug here — test explicitly that a crash after page N resumes at page N+1, not N.
- GitHub link-header pagination and GraphQL connection pagination share almost nothing; keep their strategy functions fully separate and let the type narrow.

---

### 23. Round-trip test harness (OpenAPI → mapping → SchemaAdapter.sync → VFS)
- Phase: 1
- Slug: `round-trip-harness`
- Depends-on: 22
- Parallel-with: 24

Build a reusable Vitest harness that (a) takes a vendored OpenAPI spec or recorded HTTP fixture set under `relayfile-adapters/packages/core/fixtures/`, (b) feeds it through the ingestion step used by workflow 26's `--from-openapi` CLI (or a stub of it for Phase 1), (c) drives `SchemaAdapter.sync()` against a fake `ConnectionProvider` that replays the fixture HTTP responses deterministically, and (d) asserts that the resulting VFS writes match a golden snapshot file (JSONL with `{ path, semantics, recordHash }` per line, sorted for determinism). This harness is the parity contract every Phase 3 adapter must pass — it's the difference between "the new SchemaAdapter path works for GitHub" and "the new SchemaAdapter path works for every adapter, provably". Workflow 36 wires the full parity suite on top of this harness.

Files touched:
- `relayfile-adapters/packages/core/src/testing/round-trip.ts` (new — `runRoundTrip({ fixture, mapping, expectedSnapshot })`)
- `relayfile-adapters/packages/core/src/testing/fake-connection.ts` (new — fixture-replay `ConnectionProvider`)
- `relayfile-adapters/packages/core/src/testing/vfs-snapshot.ts` (new — deterministic JSONL writer/differ)
- `relayfile-adapters/packages/core/fixtures/github-pulls.http.json` (vendored sample)
- `relayfile-adapters/packages/core/fixtures/github-pulls.snapshot.jsonl` (expected)
- `relayfile-adapters/packages/core/src/testing/__tests__/round-trip.test.ts` (new — self-test of the harness)

Agents:
- `worker` × 1 — fake connection + JSONL snapshot writer.
- `worker` × 1 — harness entry point + self-test (depends on the first worker).
- `reviewer` × 1 — confirm the fixture format is replayable across machines (no timestamps in hash, sorted keys, stable ordering).

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/testing/round-trip.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- testing/round-trip`
- `output_contains`: "snapshot matches" in test output for the GitHub self-test

Risks / notes:
- Snapshot drift is the enemy: any field whose value is generated at runtime (`receivedAt`, `syncedAt`) must be stripped or frozen, or every unrelated change will break parity tests.
- Harness API should match what workflow 36 will call in a loop — design the input shape with a fan-out loop in mind (array of fixture-snapshot pairs).

---

### 24. @relayfile/provider-nango-unauth package (metadata-based credentials)
- Phase: 1
- Slug: `provider-nango-unauth`
- Depends-on: 20, 22
- Parallel-with: 23

Ship a new workspace package `@relayfile/provider-nango-unauth` that implements `ConnectionProvider` for Nango's `unauthenticated` integration type. The provider reads credentials from Nango connection metadata (set at connection-create time by the caller, e.g. a Composio-minted OAuth token) and proxies outbound HTTP through Nango's proxy so we still get rate-limit pooling and observability. It exposes `{ name: 'nango-unauth', proxy, healthCheck }` and a constructor that takes `{ nangoClient, connectionId, metadataKey }`. No new abstractions — just a concrete provider slotting into the existing `ConnectionProvider` interface from `relayfile/packages/sdk/typescript/src/connection.ts`. Paired with a minimal `examples/nango-unauth.ts` that boots `SchemaAdapter` against the GitHub mapping YAML and calls `.sync('pull_requests', ...)` using this provider, as the proof-of-life demo that all three Phase 1 pieces fit together.

Files touched:
- `relayfile-adapters/packages/provider-nango-unauth/package.json` (new)
- `relayfile-adapters/packages/provider-nango-unauth/src/index.ts` (new)
- `relayfile-adapters/packages/provider-nango-unauth/src/provider.ts` (new)
- `relayfile-adapters/packages/provider-nango-unauth/src/__tests__/provider.test.ts` (new)
- `relayfile-adapters/examples/nango-unauth.ts` (new)
- `relayfile-adapters/package.json` (add to workspaces)
- `relayfile-adapters/turbo.json` (pipeline entry)

Agents:
- `worker` × 1 — package skeleton + provider implementation.
- `worker` × 1 — tests + example (depends on first worker).
- `reviewer` × 1 — confirm no Nango OAuth calls leaked in (pure metadata path) and no plaintext credentials logged.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/provider-nango-unauth/src/provider.ts`
- `exit_code`: `pnpm --filter @relayfile/provider-nango-unauth build`
- `exit_code`: `pnpm --filter @relayfile/provider-nango-unauth test`
- `output_contains`: package test output contains "reads credential from metadata key"

Risks / notes:
- Credentials-in-metadata must never be logged — add an explicit redaction test.
- The first real consumer (workflow 38, Composio→Gmail) will exercise this; design the metadata shape so Gmail, GitHub, and generic-bearer-token all fit the same key convention.

---

## Phase 2 — Mapping toolchain (25-29)

### 25. NangoSyncGenerator in adapter-core (YAML → createSync script)
- Phase: 2
- Slug: `nango-sync-generator`
- Depends-on: 21, 22
- Parallel-with: 26, 27, 28, 29

Build a code generator in `relayfile-adapters/packages/core/src/codegen/nango-sync.ts` that reads a `MappingSpec` YAML (specifically the `syncs:` block introduced in workflow 21) and emits a ready-to-ship Nango `sync.ts` file matching the shape that `sage/nango-integrations/<provider>/syncs/*.ts` already uses. Each generated file calls `nango.createSync(...)` with pagination, models, and the same `extract` projections declared in the YAML, so the Nango-native sync path (see `RESEARCH.md §4a`) and the direct-proxy path share one source of truth. Output is deterministic and idempotent — regenerating the file twice produces byte-identical results — so CI can enforce "generated file in git matches regen output". This is the bridge that keeps the existing `02e-nango-sync-scripts.ts` workflow working without hand-writing the sync bodies.

Files touched:
- `relayfile-adapters/packages/core/src/codegen/nango-sync.ts` (new)
- `relayfile-adapters/packages/core/src/codegen/templates/nango-sync.ts.hbs` (new — template)
- `relayfile-adapters/packages/core/src/codegen/__tests__/nango-sync.test.ts` (new)
- `relayfile-adapters/packages/core/fixtures/github-expected-sync.ts` (new — golden output)

Agents:
- `worker` × 1 — template + generator.
- `worker` × 1 — golden-output tests.
- `reviewer` × 1 — diff generated output against a hand-written reference to confirm no semantic drift.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/codegen/nango-sync.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- codegen/nango-sync`
- `output_contains`: "idempotent regeneration" assertion passes

Risks / notes:
- Handlebars or ts-morph — pick ts-morph to avoid template whitespace headaches; generated code must lint clean against sage's eslint config.
- Don't embed the mapping YAML path in the generated file (it creates cross-repo coupling); regenerate on CI and commit the result.

---

### 26. CLI: relayfile adapter new <name> --from-openapi=<url>
- Phase: 2
- Slug: `cli-adapter-new`
- Depends-on: 21, 23
- Parallel-with: 25, 27, 28, 29

Add a new subcommand to the existing `relayfile` CLI (package under `relayfile/packages/cli/` — confirm exact path in workflow kickoff) that scaffolds a brand-new integration package from an OpenAPI spec URL or local file: creates `relayfile-adapters/packages/<name>/` with a `package.json`, `src/index.ts`, `<name>.mapping.yaml` pre-populated from the OpenAPI paths table, a starter `README.md`, and a stub test that runs the workflow-23 round-trip harness against a recorded fixture. Calls into the ingestion pipeline (workflow 42 will harden it; this workflow depends on the current MVP version already in `relayfile-adapters/packages/core/src/ingest/openapi.ts` if present, otherwise writes a minimal first version). Interactive prompts only when `--from-openapi` is omitted. The goal is "new integration in ten minutes" — measured in workflow 29's docs.

Files touched:
- `relayfile/packages/cli/src/commands/adapter-new.ts` (new)
- `relayfile/packages/cli/src/commands/index.ts` (register subcommand)
- `relayfile/packages/cli/src/scaffolding/templates/` (new — package skeleton files)
- `relayfile/packages/cli/src/__tests__/adapter-new.test.ts` (new)
- `relayfile/packages/cli/package.json`

Agents:
- `analyst` × 1 — locate CLI entry point and existing command registration pattern.
- `worker` × 1 — scaffolding + command handler.
- `worker` × 1 — tests using a vendored OpenAPI fixture.
- `reviewer` × 1 — scaffolded output actually builds end-to-end.

Verification gates:
- `file_exists`: `relayfile/packages/cli/src/commands/adapter-new.ts`
- `exit_code`: `pnpm --filter @relayfile/cli test -- adapter-new`
- `exit_code`: in test, the scaffolded package passes `pnpm build` on its own

Risks / notes:
- OpenAPI specs vary wildly; v1 should cover Swagger 2.0 + OpenAPI 3.0/3.1 JSON. YAML input can come in workflow 42.
- Scaffolded package name must not collide with existing `relayfile-adapters/packages/*`; fail loudly if it does.

---

### 27. CLI: relayfile adapter gen-nango-sync <mapping.yaml>
- Phase: 2
- Slug: `cli-gen-nango-sync`
- Depends-on: 25
- Parallel-with: 26, 28, 29

Expose the workflow-25 generator as a CLI subcommand `relayfile adapter gen-nango-sync <mapping.yaml> --out=<dir>` that writes one `sync.ts` per entry in the mapping's `syncs:` block into the target directory (default: `sage/nango-integrations/<provider>/syncs/`). Idempotent; prints a diff of what changed; non-zero exit if the mapping has no `syncs:` block. This is the command that sage's CI or a developer runs after editing a mapping YAML — keeps Nango-native scripts in lockstep with the mapping YAML without hand-editing.

Files touched:
- `relayfile/packages/cli/src/commands/adapter-gen-nango-sync.ts` (new)
- `relayfile/packages/cli/src/commands/index.ts`
- `relayfile/packages/cli/src/__tests__/adapter-gen-nango-sync.test.ts` (new)

Agents:
- `worker` × 1 — command handler + diff printer.
- `reviewer` × 1 — confirms `--out` is honored, no writes outside the specified directory.

Verification gates:
- `file_exists`: `relayfile/packages/cli/src/commands/adapter-gen-nango-sync.ts`
- `exit_code`: `pnpm --filter @relayfile/cli test -- adapter-gen-nango-sync`
- `output_contains`: "no changes" on a second consecutive run (idempotent)

Risks / notes:
- The CLI must not overwrite hand-edited sync files silently — check for a `// generated-by: relayfile` marker and refuse to overwrite a file missing it unless `--force`.

---

### 28. Mapping YAML validator/linter
- Phase: 2
- Slug: `mapping-yaml-linter`
- Depends-on: 21
- Parallel-with: 25, 26, 27, 29

Add a `relayfile adapter lint <mapping.yaml>` subcommand backed by a structured validator in `relayfile-adapters/packages/core/src/spec/lint.ts` that catches the common mistakes RESEARCH.md §5 + real-world pain points surface: missing `cursorPath` when `pagination: cursor`, webhook `path` template referencing an unknown `extract` key, writeback glob overlapping a resource path (dangerous write-back loop), resource endpoint not covered by a `syncs:` entry (dead code warning), and a GraphQL resource missing `connectionPath`. Distinct from the schema-level `validate.ts` (workflow 21) which is type-shape only — the linter is rules + warnings with fixable suggestions.

Files touched:
- `relayfile-adapters/packages/core/src/spec/lint.ts` (new)
- `relayfile-adapters/packages/core/src/spec/__tests__/lint.test.ts` (new)
- `relayfile/packages/cli/src/commands/adapter-lint.ts` (new)
- `relayfile/packages/cli/src/__tests__/adapter-lint.test.ts` (new)

Agents:
- `analyst` × 1 — enumerate the rule set from RESEARCH.md §5 + recent bug reports.
- `worker` × 1 — implement lint rules with fixtures-per-rule tests.
- `worker` × 1 — CLI command wrapper.
- `reviewer` × 1 — confirm warnings vs. errors are distinguishable by exit code.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/spec/lint.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- spec/lint`
- `exit_code`: `pnpm --filter @relayfile/cli test -- adapter-lint`
- `output_contains`: at least 5 distinct rule IDs exercised by tests

Risks / notes:
- Don't make the linter opinionated about naming conventions; stick to correctness rules. Style lives elsewhere.

---

### 29. Docs: "adding a new integration in 10 minutes"
- Phase: 2
- Slug: `docs-new-integration`
- Depends-on: 24, 26, 27, 28
- Parallel-with: 25 (final pass waits on 27 landing)

Write `relayfile-adapters/docs/adding-an-integration.md` as a single end-to-end walkthrough: point a newcomer at a public OpenAPI spec URL, show them `relayfile adapter new foo --from-openapi=...`, show the generated mapping YAML, show how to tweak the `syncs:` block, run `relayfile adapter lint`, run `relayfile adapter gen-nango-sync` if targeting the Nango-native path, and boot `@relayfile/provider-nango-unauth` (or the direct-proxy path) against the new adapter in a ten-line example script. Also adds a "troubleshooting" appendix covering the five most common linter errors and a "when to drop down to a custom subclass" section (Notion's block walker being the canonical example — see `RESEARCH.md §3`). Docs must reference real files/commands, not aspirational ones.

Files touched:
- `relayfile-adapters/docs/adding-an-integration.md` (new)
- `relayfile-adapters/docs/examples/quickstart.ts` (new — ten-line example)
- `relayfile-adapters/README.md` (link into docs)

Agents:
- `analyst` × 1 — verify each CLI command and file path exists.
- `worker` × 1 — write the docs file.
- `reviewer` × 1 — runs the quickstart script end-to-end from a clean clone; docs ships only when the reviewer's run succeeds.

Verification gates:
- `file_exists`: `relayfile-adapters/docs/adding-an-integration.md`
- `exit_code`: `pnpm tsx relayfile-adapters/docs/examples/quickstart.ts --dry-run`
- `output_contains`: reviewer report includes the phrase "ran end-to-end from clean state"

Risks / notes:
- Don't let docs drift — add a CI step (future workflow) that runs the quickstart script on every merge to catch bitrot.

---

## Phase 3 — Adapter migrations (30-36)

> **Revised strategy — 2026-04-09.** The original plan assumed every hand-coded
> adapter could be deleted and replaced with `new SchemaAdapter(mappingSpec)`.
> Workflow 20 (the failed dedup run) proved this assumption is wrong: the 5
> local `IntegrationAdapter` abstract classes in github/slack/linear/notion/
> gitlab encode **semantically different contracts** — different constructor
> signatures, different protected fields (e.g. github has `config`, notion
> makes `provider` optional), different `SyncResult` / `WritebackResult`
> return types. Forcing one canonical base on all of them broke every
> concrete subclass with ~17 compile errors per package.
>
> **Each Phase 3 workflow is now a per-adapter judgment call, not a blanket
> dedup.** For each adapter, the workflow must:
>
> 1. **Enumerate the bespoke logic** in the current hand-coded class —
>    custom API client, pagination strategy, block-tree walking, GraphQL
>    layer, rich message formatting, etc.
> 2. **Score the declarative ratio** — what fraction of the adapter's
>    surface can be expressed in a mapping YAML (`webhooks`, `resources`,
>    `writebacks` tables) vs. what requires imperative code?
> 3. **Pick a migration mode:**
>    - **Mode A — Full SchemaAdapter replacement.** Adapter becomes `new
>      SchemaAdapter(mappingSpec)` with no subclass. Use when declarative
>      ratio is ≥80% and the remaining 20% can be expressed via the
>      mapping spec's `extract` rules or `writeback` templates. **Requires
>      deleting the adapter's local `IntegrationAdapter` class.** Slack,
>      GitLab, Teams, and probably Linear land here.
>    - **Mode B — Extension.** Keep a concrete subclass but rebase it on
>      `@relayfile/sdk`'s canonical `IntegrationAdapter`, reconciling any
>      constructor/field/return-type differences. The subclass keeps its
>      custom logic; only the base class changes. Notion lands here
>      (block-tree walking, markdown rendering can't be declarative).
>      GitHub may land here too depending on check-run dispatch.
>    - **Mode C — Legacy exception.** Keep the local
>      `IntegrationAdapter` class in the package as-is, do not touch the
>      concrete subclass. Use only when (A) and (B) would both require
>      rewriting more than ~30% of the adapter's concrete implementation.
>      This mode exists to prevent a bad migration from forcing a good
>      adapter to regress.
>
> 4. **Regression-build gate.** Every Phase 3 workflow must rebuild all 4
>    other adapters as-is at the end, identical to workflow 20's
>    `regression-build-adapters` step. If touching adapter X breaks
>    adapter Y's build, something in X's migration leaked into the shared
>    SDK or adapter-core surface and the migration needs to back out.
>
> **Per-adapter mode assignment (initial guess, revised during the
> workflow's `analyze-adapter` step):**
>
> | Adapter | Expected mode | Rationale |
> |---|---|---|
> | github | B (extension) | check-run dispatch, PR diff stitching, bulk webhook handlers — custom but coexists with YAML-driven resources |
> | slack | A (replacement) | message shape + webhook routing is almost entirely declarative; rich-message formatting stays as a helper utility, not a subclass |
> | linear | A or B | GraphQL client is imperative, but most object shaping is declarative — real mode decided during analyze-adapter |
> | notion | B (extension) | block-tree walking + markdown rendering + comment threading is genuinely imperative; mode B keeps it |
> | gitlab | A (replacement) | pagination + webhook structure mirrors github's mapping YAML pattern; no custom tree walking |
> | teams | A (replacement) | limited webhook surface, standard REST resources |
>
> The individual workflow entries below still describe the **Mode A**
> shape for consistency with the original backlog, but every one now
> starts with an `analyze-adapter` step that can pivot to Mode B or C if
> the mode guess turns out wrong.

---

### 30. GitHub — expand mapping YAML + refactor to SchemaAdapter
- Phase: 3
- Slug: `migrate-github`
- Depends-on: 22, 23
- Parallel-with: 31, 32, 33, 34, 35

GitHub already has `relayfile-adapters/packages/github/github.mapping.yaml` and serves as the reference for `SchemaAdapter`. This workflow expands it to cover the full surface area currently hand-coded in `packages/github/src/` (issues, issue_comments, reviews, review_comments, check_runs, releases, tags), adds the `syncs:` block from workflow 21, and deletes the bespoke subclass so the package's `src/index.ts` becomes `export const adapter = new SchemaAdapter(mappingSpec)`. The round-trip harness (workflow 23) must pass against recorded fixtures before the hand-coded subclass is removed. Preserves all existing webhook semantics and writeback globs — no behavior change visible to sage or downstream consumers.

Files touched:
- `relayfile-adapters/packages/github/github.mapping.yaml` (expand)
- `relayfile-adapters/packages/github/src/index.ts` (collapse to `new SchemaAdapter(...)`)
- `relayfile-adapters/packages/github/src/*.ts` (delete hand-coded subclass files)
- `relayfile-adapters/packages/github/fixtures/*.http.json` (record)
- `relayfile-adapters/packages/github/fixtures/*.snapshot.jsonl` (golden)
- `relayfile-adapters/packages/github/src/__tests__/round-trip.test.ts` (new)

Agents:
- `analyst` × 1 — enumerate all resources + webhooks from current hand-coded adapter.
- `worker` × 1 — expand mapping YAML.
- `worker` × 1 — record fixtures + write round-trip test (depends on the YAML worker).
- `worker` × 1 — delete hand-coded adapter, wire `SchemaAdapter` (depends on the round-trip-test worker).
- `reviewer` × 1 — diff old vs. new semantics on a real webhook payload.

Verification gates:
- `exit_code`: `pnpm --filter @relayfile/adapter-github test`
- `output_contains`: "round-trip: github parity" test line passes
- `exit_code`: `pnpm --filter @relayfile/adapter-github build`

Risks / notes:
- GitHub check-run webhooks have nested action dispatching that the current subclass handles via a switch — make sure the YAML `webhooks:` table can express it via `extract` + `eventRoot` keying, or document the workaround.

---

### 31. Slack — write slack.mapping.yaml + refactor
- Phase: 3
- Slug: `migrate-slack`
- Depends-on: 22, 23
- Parallel-with: 30, 32, 33, 34, 35

Slack has no mapping YAML today. Write `relayfile-adapters/packages/slack/slack.mapping.yaml` covering message / message_edited / reaction_added / channel_created webhooks and the `conversations.history` / `conversations.list` / `users.list` resources, then refactor `packages/slack/src/` to `new SchemaAdapter(slackMapping)`. Slack's pagination uses `cursor` with `response_metadata.next_cursor`, which is exactly the strategy workflow 22 ships; no runtime changes expected. Webhook path templating needs the channel ID + ts pair to match the existing VFS layout (verify against sage's current write paths in `sage/src/integrations/relayfile-bridge.ts`).

Files touched:
- `relayfile-adapters/packages/slack/slack.mapping.yaml` (new)
- `relayfile-adapters/packages/slack/src/index.ts`
- `relayfile-adapters/packages/slack/src/*.ts` (delete bespoke subclass)
- `relayfile-adapters/packages/slack/fixtures/*.http.json`
- `relayfile-adapters/packages/slack/fixtures/*.snapshot.jsonl`
- `relayfile-adapters/packages/slack/src/__tests__/round-trip.test.ts` (new)

Agents:
- `analyst` × 1 — map current subclass → webhook/resource table.
- `worker` × 1 — author YAML.
- `worker` × 1 — fixtures + round-trip test.
- `worker` × 1 — refactor src/ (depends on fixture worker).
- `reviewer` × 1 — webhook path byte-identical vs. old output.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/slack/slack.mapping.yaml`
- `exit_code`: `pnpm --filter @relayfile/adapter-slack test`
- `output_contains`: "round-trip: slack parity"

Risks / notes:
- Slack's rate limits are per-method; the generic paginator must honor `Retry-After` headers. If the paginator doesn't yet, file a fix back into workflow 22 before this workflow unblocks.

---

### 32. Linear — write linear.mapping.yaml (GraphQL resource type)
- Phase: 3
- Slug: `migrate-linear`
- Depends-on: 21, 22, 23
- Parallel-with: 30, 31, 33, 34, 35

First consumer of the GraphQL resource type from workflow 21. Linear exposes a GraphQL API with `nodes { ... }` connection pagination. Write `relayfile-adapters/packages/linear/linear.mapping.yaml` covering issue/comment/project/cycle queries and the corresponding webhook events. Refactor `packages/linear/src/` to `new SchemaAdapter(linearMapping)`. This workflow is the real test of whether the GraphQL branch in `MappingSpec` is shaped correctly — if the YAML can't express a nested `issues.edges.node` with pagination cleanly, it reveals a Phase 1 design gap that must loop back into workflow 21 before more GraphQL adapters land.

Files touched:
- `relayfile-adapters/packages/linear/linear.mapping.yaml` (new)
- `relayfile-adapters/packages/linear/src/index.ts`
- `relayfile-adapters/packages/linear/src/*.ts` (delete subclass)
- `relayfile-adapters/packages/linear/fixtures/*.graphql.json`
- `relayfile-adapters/packages/linear/fixtures/*.snapshot.jsonl`
- `relayfile-adapters/packages/linear/src/__tests__/round-trip.test.ts` (new)

Agents:
- `analyst` × 1 — enumerate Linear's GraphQL surface currently used by the subclass.
- `worker` × 1 — YAML + GraphQL queries.
- `worker` × 1 — fixtures + round-trip test.
- `worker` × 1 — refactor src/.
- `reviewer` × 1 — spot-check GraphQL cursor handling; confirm no N+1 regression.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/linear/linear.mapping.yaml`
- `exit_code`: `pnpm --filter @relayfile/adapter-linear test`
- `output_contains`: "round-trip: linear parity"

Risks / notes:
- GraphQL schema versioning — pin the Linear schema version used in fixtures; mark any schema drift as a separate task so parity failures are triageable.

---

### 33. Notion — write notion.mapping.yaml (block walking stays custom)
- Phase: 3
- Slug: `migrate-notion`
- Depends-on: 22, 23
- Parallel-with: 30, 31, 32, 34, 35

Notion already has `relayfile-adapters/packages/notion/notion.mapping.yaml` (per RESEARCH.md §3) but the bespoke subclass in `packages/notion/src/adapter.ts` handles recursive block-tree walking that the declarative `MappingSpec` can't express. This workflow expands the YAML to cover the flat parts (page webhooks, database queries, user resources), refactors the subclass to `extends SchemaAdapter` (not `extends IntegrationAdapter` directly) so it inherits the paginator + webhook table but keeps an overridden `syncBlockTree()` method for the custom logic. The result: ~70% of the Notion code deletes; the remaining 30% is a single focused file.

Files touched:
- `relayfile-adapters/packages/notion/notion.mapping.yaml` (expand)
- `relayfile-adapters/packages/notion/src/adapter.ts` (keep class, extend `SchemaAdapter`)
- `relayfile-adapters/packages/notion/src/block-walker.ts` (extract custom logic)
- `relayfile-adapters/packages/notion/src/index.ts`
- `relayfile-adapters/packages/notion/fixtures/*.http.json`
- `relayfile-adapters/packages/notion/fixtures/*.snapshot.jsonl`
- `relayfile-adapters/packages/notion/src/__tests__/round-trip.test.ts` (new)

Agents:
- `analyst` × 1 — identify which methods can move to YAML vs. which must stay custom.
- `worker` × 1 — expand YAML.
- `worker` × 1 — refactor subclass + extract block walker.
- `worker` × 1 — fixtures + tests.
- `reviewer` × 1 — block walker parity against recorded deep-nested page.

Verification gates:
- `exit_code`: `pnpm --filter @relayfile/adapter-notion test`
- `output_contains`: "round-trip: notion parity (flat resources)"
- `output_contains`: "block walker: depth ≥ 5 nested blocks handled"

Risks / notes:
- This workflow is the proof-of-life that SchemaAdapter is extensible, not a straightjacket. If the extraction is ugly, revisit the `SchemaAdapter` hook surface in a follow-up before 34-35 inherit the same pattern.

---

### 34. GitLab — write gitlab.mapping.yaml
- Phase: 3
- Slug: `migrate-gitlab`
- Depends-on: 22, 23
- Parallel-with: 30, 31, 32, 33, 35

GitLab has `relayfile-adapters/packages/gitlab/gitlab.mapping.yaml` already. Expand to the current subclass's full surface (merge_request / push / pipeline / note webhooks; merge_requests / issues / projects resources), add the `syncs:` block, and collapse the subclass. GitLab's pagination is page-based via `X-Next-Page` header — one of the five strategies in workflow 22, so no runtime gap expected.

Files touched:
- `relayfile-adapters/packages/gitlab/gitlab.mapping.yaml` (expand)
- `relayfile-adapters/packages/gitlab/src/index.ts`
- `relayfile-adapters/packages/gitlab/src/*.ts` (delete subclass)
- `relayfile-adapters/packages/gitlab/fixtures/*.http.json`
- `relayfile-adapters/packages/gitlab/fixtures/*.snapshot.jsonl`
- `relayfile-adapters/packages/gitlab/src/__tests__/round-trip.test.ts` (new)

Agents:
- `analyst` × 1 — enumerate current subclass surface.
- `worker` × 1 — expand YAML.
- `worker` × 1 — fixtures + test.
- `worker` × 1 — collapse subclass.
- `reviewer` × 1 — parity check.

Verification gates:
- `exit_code`: `pnpm --filter @relayfile/adapter-gitlab test`
- `output_contains`: "round-trip: gitlab parity"

Risks / notes:
- GitLab self-hosted instances use different URL bases; make sure the mapping's endpoint paths are relative, not absolute.

---

### 35. Teams — write teams.mapping.yaml
- Phase: 3
- Slug: `migrate-teams`
- Depends-on: 22, 23
- Parallel-with: 30, 31, 32, 33, 34

Microsoft Teams has `relayfile-adapters/packages/teams/teams.mapping.yaml` already. Expand to cover chat messages, channel messages, team/channel resources, and the Graph API subscription-based webhook flow. Teams auth lives in Microsoft Graph (token endpoint + scopes); this workflow does not change auth — it still flows through whatever `ConnectionProvider` the consumer passes. Microsoft Graph uses OData `@odata.nextLink` pagination (link-header strategy from workflow 22).

Files touched:
- `relayfile-adapters/packages/teams/teams.mapping.yaml` (expand)
- `relayfile-adapters/packages/teams/src/index.ts`
- `relayfile-adapters/packages/teams/src/*.ts` (delete subclass)
- `relayfile-adapters/packages/teams/fixtures/*.http.json`
- `relayfile-adapters/packages/teams/fixtures/*.snapshot.jsonl`
- `relayfile-adapters/packages/teams/src/__tests__/round-trip.test.ts` (new)

Agents:
- `analyst` × 1 — enumerate current subclass surface.
- `worker` × 1 — expand YAML.
- `worker` × 1 — fixtures + test.
- `worker` × 1 — collapse subclass.
- `reviewer` × 1 — parity + Graph subscription webhook semantic check.

Verification gates:
- `exit_code`: `pnpm --filter @relayfile/adapter-teams test`
- `output_contains`: "round-trip: teams parity"

Risks / notes:
- Graph change notifications include lifecycle events (subscription about to expire) — make sure these are either expressible in YAML or explicitly delegated to a custom method and documented.

---

### 36. Parity test suite (recorded fixtures, byte-identical VFS writes)
- Phase: 3
- Slug: `parity-suite`
- Depends-on: 30, 31, 32, 33, 34, 35
- Parallel-with: (none — this is the Phase 3 gate)

Wire all six per-adapter round-trip tests into a single `pnpm --filter @relayfile/adapter-core test:parity` pipeline that runs every fixture-snapshot pair and produces a single pass/fail report. Add a CI job (file to be determined in workflow kickoff — likely `.github/workflows/parity.yml`) that runs on every PR touching `relayfile-adapters/`. Captures metrics: total fixtures, total records, total bytes written, runtime per adapter. Also adds a `--update-snapshots` flag for when a mapping YAML change intentionally shifts output, with a guard: update-snapshots requires a non-empty `REASON=` env var so drift is traceable in git history.

Files touched:
- `relayfile-adapters/packages/core/src/testing/parity-runner.ts` (new)
- `relayfile-adapters/package.json` (add `test:parity` script)
- `.github/workflows/parity.yml` (new, if CI lives in GitHub Actions — confirm at kickoff)
- `relayfile-adapters/docs/parity-testing.md` (new)

Agents:
- `worker` × 1 — parity runner script.
- `worker` × 1 — CI config + docs.
- `reviewer` × 1 — confirms all six adapters actually exercise the runner (no silent skips).

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/testing/parity-runner.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test:parity`
- `output_contains`: "6 adapters, all parity" in runner output

Risks / notes:
- Parity suite runtime must stay under ~2 minutes on CI — if it exceeds that, shard per-adapter in the CI matrix.
- A silent skip (e.g. missing fixture file) must fail loud, not pass with zero assertions.

---

## Phase 4 — Sage consumer (37-41)

### 37. RelayFileBridge.runSync(provider, adapter, resource, options)
- Phase: 4
- Slug: `bridge-run-sync`
- Depends-on: 22, 36
- Parallel-with: (none — 38, 39, 40 build on this)

Add a `runSync(provider, adapter, resource, options)` method to `sage/src/integrations/relayfile-bridge.ts` that wraps `SchemaAdapter.sync()` and routes each yielded `{ path, semantics, record }` through the bridge's existing `client.writeFile()` call. Today the bridge's `processSyncWebhook` (see line 586) only consumes the Nango-native path; `runSync` adds the direct-proxy path (and by extension, the Nango-unauth path via the workflow-24 provider). Accepts an `AbortSignal`, a `SyncState` instance, and a `dryRun` flag. Logs per-page progress via sage's existing logger. Does **not** change `processSyncWebhook` — the two paths coexist, and sage callers choose which to use based on the provider type.

Files touched:
- `sage/src/integrations/relayfile-bridge.ts`
- `sage/src/integrations/__tests__/relayfile-bridge.runSync.test.ts` (new)
- `sage/src/integrations/relayfile-bridge.types.ts` (if types live separately)

Agents:
- `analyst` × 1 — read the existing bridge; identify exact integration points.
- `worker` × 1 — implement `runSync`.
- `worker` × 1 — tests using the workflow-23 round-trip harness pattern.
- `reviewer` × 1 — confirm no duplicate writes when both `runSync` and `processSyncWebhook` run against the same provider.

Verification gates:
- `exit_code`: `pnpm --filter sage test -- relayfile-bridge`
- `output_contains`: "runSync: direct-proxy path writes"
- `exit_code`: `pnpm --filter sage build`

Risks / notes:
- sage uses lazy-loaded `@relayfile/adapter-*` imports today; keep the lazy-load pattern to avoid forcing every adapter into sage's startup bundle.

---

### 38. First real Nango-unauth connection (Composio → Gmail as reference)
- Phase: 4
- Slug: `composio-gmail-nango-unauth`
- Depends-on: 24, 37
- Parallel-with: 39, 40

Prove the full stack end-to-end with a real provider: build a Gmail adapter (`relayfile-adapters/packages/gmail/`, mostly generated by workflow 26's CLI from the Gmail REST OpenAPI), wire it to `@relayfile/provider-nango-unauth` with a Composio-minted Gmail OAuth token in Nango connection metadata, and run `RelayFileBridge.runSync` against a test inbox. This is the reference implementation for all future composed-provider integrations and the first production validation of the Phase 1 stack. Test fixtures use a sandboxed Gmail account; no production credentials in the repo.

Files touched:
- `relayfile-adapters/packages/gmail/` (new — scaffolded by workflow 26's CLI)
- `relayfile-adapters/packages/gmail/gmail.mapping.yaml` (new)
- `relayfile-adapters/packages/gmail/src/index.ts` (new)
- `sage/src/integrations/providers/composio-gmail.ts` (new — composio token minter)
- `sage/src/integrations/__tests__/composio-gmail.e2e.test.ts` (new, gated by env var)
- `relayfile-adapters/docs/examples/composio-gmail.md` (new)

Agents:
- `worker` × 1 — generate gmail package via CLI, hand-curate the YAML.
- `worker` × 1 — sage composio token minter.
- `worker` × 1 — e2e test scaffolding.
- `reviewer` × 1 — e2e actually writes to a test VFS workspace; no leaked credentials.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/gmail/gmail.mapping.yaml`
- `exit_code`: `pnpm --filter @relayfile/adapter-gmail test`
- `exit_code`: `pnpm --filter sage test -- composio-gmail` (skipped if env var missing)

Risks / notes:
- Gmail OAuth scopes matter — minimum set is `gmail.readonly` + `gmail.metadata`; document and enforce in composio token request.
- E2E test must be skippable by default (env var gate) so CI doesn't need Composio creds.

---

### 39. Credential-refresh background job
- Phase: 4
- Slug: `credential-refresh-job`
- Depends-on: 24, 37
- Parallel-with: 38, 40

Add a background refresh job in sage that watches Nango connections using the `nango-unauth` provider and rotates the metadata-held credential before expiry. Composio-minted tokens are short-lived (~1h for Gmail); without refresh the sync breaks after one hour. The job reads each connection's metadata, calls the composio (or equivalent) token endpoint, and updates the Nango connection metadata via Nango's admin API — no changes to the sync code path. Runs on sage's existing scheduler (BullMQ or similar — confirm at kickoff). Emits metrics on refresh success/failure.

Files touched:
- `sage/src/jobs/credential-refresh.ts` (new)
- `sage/src/jobs/index.ts` (register job)
- `sage/src/integrations/providers/composio-gmail.ts` (refresh helper)
- `sage/src/jobs/__tests__/credential-refresh.test.ts` (new)

Agents:
- `analyst` × 1 — locate sage's scheduler + job registration pattern.
- `worker` × 1 — implement the refresh job.
- `worker` × 1 — tests with fake clock.
- `reviewer` × 1 — confirms no race between refresh and in-flight sync.

Verification gates:
- `file_exists`: `sage/src/jobs/credential-refresh.ts`
- `exit_code`: `pnpm --filter sage test -- credential-refresh`
- `output_contains`: "refreshes before expiry window"

Risks / notes:
- Refresh window must be conservative — e.g. refresh at T-10min, not T-1min, to survive job-scheduler jitter.
- A failed refresh should not delete the old credential; keep the old metadata until new one is confirmed live.

---

### 40. .sync-state/ workspace convention for direct-proxy path
- Phase: 4
- Slug: `sync-state-convention`
- Depends-on: 22, 37
- Parallel-with: 38, 39

Standardize where the direct-proxy path persists checkpoint state. Add a `WorkspaceSyncState` implementation of the `SyncState` interface (workflow 22) that reads/writes `.sync-state/<provider>/<resource>.json` inside the target RelayFile workspace via the same `client.writeFile`/`client.readFile` used for sync records. Documents the convention in `relayfile-adapters/docs/sync-state.md` — directory layout, file schema (`{ cursor, updatedAt, stats }`), gitignore recommendation, and the invariant that `.sync-state/` is never touched by user-facing tooling. Bridge (workflow 37) defaults to this implementation if no `SyncState` is passed.

Files touched:
- `relayfile-adapters/packages/core/src/runtime/workspace-sync-state.ts` (new)
- `relayfile-adapters/packages/core/src/runtime/__tests__/workspace-sync-state.test.ts` (new)
- `sage/src/integrations/relayfile-bridge.ts` (default wiring)
- `relayfile-adapters/docs/sync-state.md` (new)

Agents:
- `worker` × 1 — `WorkspaceSyncState` implementation.
- `worker` × 1 — wire bridge default + docs.
- `reviewer` × 1 — concurrent-write safety (two syncs for different resources don't clobber each other).

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/runtime/workspace-sync-state.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- workspace-sync-state`
- `output_contains`: "concurrent writes isolated per resource"

Risks / notes:
- Workspace-stored state means the sync lineage lives with the data — tempting, but means a user deleting the workspace resets all cursors. Document this explicitly.

---

### 41. e2e test: new provider via YAML → all three paths → identical VFS
- Phase: 4
- Slug: `three-paths-parity`
- Depends-on: 36, 37, 38, 39, 40
- Parallel-with: (none — this is the Phase 4 gate)

The campaign's capstone test. Takes a fresh integration (recommend a tiny one like a public JSON placeholder API scaffolded via workflow 26's CLI), runs the same sync through all three paths — (a) Nango-native using generated sync scripts from workflow 25, (b) Nango-unauth via workflow 24, (c) direct-proxy via workflow 37's `runSync` — and asserts that all three write byte-identical output to three parallel workspaces. If they diverge, something leaked between the paths (e.g. Nango silently casts types on ingestion). This is the test that proves the claim "one mapping YAML, three paths". Runs in CI on a nightly schedule, not per-PR (too expensive).

Files touched:
- `relayfile-adapters/packages/core/src/testing/three-paths.ts` (new)
- `relayfile-adapters/packages/core/src/testing/__tests__/three-paths.test.ts` (new)
- `.github/workflows/three-paths-nightly.yml` (new)
- `relayfile-adapters/docs/three-paths-parity.md` (new)

Agents:
- `worker` × 1 — scaffold reference integration.
- `worker` × 1 — three-paths runner.
- `worker` × 1 — CI nightly config + docs.
- `reviewer` × 1 — diff the three outputs manually once; confirm byte identity is meaningful (not a vacuous "all empty").

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/testing/three-paths.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- three-paths`
- `output_contains`: "3 paths, byte-identical"

Risks / notes:
- Nango-native introduces a timing skew (Nango's cron vs. direct call); the test must normalize `syncedAt`/`receivedAt` before comparing.
- This test will surface every subtle type-coercion bug in Nango's record layer — budget time for investigation when it first runs.

---

## Phase 5 — Ingestion hardening (42-45)

### 42. OpenAPI ingestion improvements
- Phase: 5
- Slug: `ingest-openapi-v2`
- Depends-on: 26
- Parallel-with: 43, 44, 45

Harden `relayfile-adapters/packages/core/src/ingest/openapi.ts` to cover edge cases found while running Phase 3: YAML input (not just JSON), `$ref` resolution (internal + external), `allOf`/`oneOf` schema composition, discriminator unions, path parameters with pattern constraints, and authentication schemes surfaced as `ConnectionProvider` config hints. Adds a golden-test directory with a dozen real-world specs (GitHub, Stripe, Linear REST, etc.) and asserts that ingestion produces a mapping YAML that passes workflow 28's linter.

Files touched:
- `relayfile-adapters/packages/core/src/ingest/openapi.ts`
- `relayfile-adapters/packages/core/src/ingest/ref-resolver.ts` (new)
- `relayfile-adapters/packages/core/src/ingest/schema-composer.ts` (new)
- `relayfile-adapters/packages/core/src/ingest/__tests__/openapi.test.ts`
- `relayfile-adapters/packages/core/fixtures/openapi/*.yaml` (vendored specs)

Agents:
- `analyst` × 1 — catalog the edge cases Phase 3 hit and which specs trigger them.
- `worker` × 1 — `$ref` resolver + composer.
- `worker` × 1 — main ingestion logic updates.
- `worker` × 1 — golden tests.
- `reviewer` × 1 — lint output on all twelve specs must pass.

Verification gates:
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- ingest/openapi`
- `output_contains`: "12 specs ingest cleanly"

Risks / notes:
- External `$ref` resolution can recurse infinitely; cap depth and fail loudly.

---

### 43. Postman ingestion improvements
- Phase: 5
- Slug: `ingest-postman`
- Depends-on: 26
- Parallel-with: 42, 44, 45

Accept Postman collection JSON as an input source for `relayfile adapter new`, alongside OpenAPI. Postman collections are common for APIs that don't publish OpenAPI specs (e.g. many SaaS tools ship a Postman collection first). Converts collection items → resource mappings, extracts auth configuration, and warns when request bodies use non-JSON (form-data, raw text). Round-trips through the linter the same way workflow 42 does.

Files touched:
- `relayfile-adapters/packages/core/src/ingest/postman.ts` (new)
- `relayfile-adapters/packages/core/src/ingest/__tests__/postman.test.ts` (new)
- `relayfile-adapters/packages/core/fixtures/postman/*.json` (vendored collections)
- `relayfile/packages/cli/src/commands/adapter-new.ts` (add `--from-postman` flag)

Agents:
- `analyst` × 1 — study Postman collection schema v2.1.
- `worker` × 1 — ingestion logic.
- `worker` × 1 — CLI flag + tests.
- `reviewer` × 1 — confirm warnings for non-JSON bodies are actionable.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/ingest/postman.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- ingest/postman`

Risks / notes:
- Postman variable substitution (`{{baseUrl}}`) needs to survive into the mapping YAML as templated endpoint values.

---

### 44. Sample-based spec ingestion
- Phase: 5
- Slug: `ingest-samples`
- Depends-on: 26
- Parallel-with: 42, 43, 45

Accept a directory of sample HTTP request/response pairs (e.g. `.http` files from VS Code REST Client or saved curl output) and infer a mapping YAML. Used when neither OpenAPI nor Postman is available. Quality will be lower than spec-driven ingestion — the output is explicitly marked as "draft, lint before use" and surfaces confidence warnings when record shapes drift between samples.

Files touched:
- `relayfile-adapters/packages/core/src/ingest/samples.ts` (new)
- `relayfile-adapters/packages/core/src/ingest/__tests__/samples.test.ts` (new)
- `relayfile-adapters/packages/core/fixtures/samples/*.http` (vendored)
- `relayfile/packages/cli/src/commands/adapter-new.ts` (add `--from-samples` flag)

Agents:
- `worker` × 1 — sample parser.
- `worker` × 1 — shape inference + warnings.
- `reviewer` × 1 — low-quality input produces explicit warnings, not silent bad YAML.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/ingest/samples.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- ingest/samples`
- `output_contains`: "draft YAML flagged"

Risks / notes:
- Resist scope creep — this is a convenience feature; OpenAPI + Postman cover 90% of real cases.

---

### 45. Golden test suite (10+ real public APIs)
- Phase: 5
- Slug: `ingestion-golden-suite`
- Depends-on: 42, 43, 44
- Parallel-with: (none — the Phase 5 gate)

Assemble a single test pipeline that runs every ingestion input type (OpenAPI, Postman, samples) against at least ten real public API sources and asserts: (a) ingestion completes without errors, (b) produced mapping YAML passes the workflow-28 linter, (c) the generated mapping can be loaded by `SchemaAdapter` without crashing. Does **not** run sync against live APIs — just validates the ingestion→validation→load chain. Acts as a regression fence so future ingestion changes can't silently break real-world specs.

Files touched:
- `relayfile-adapters/packages/core/src/testing/ingestion-golden.ts` (new)
- `relayfile-adapters/packages/core/fixtures/golden-apis/*` (ten+ vendored specs)
- `relayfile-adapters/package.json` (add `test:golden` script)

Agents:
- `worker` × 1 — golden runner.
- `worker` × 1 — vendor specs + manifests.
- `reviewer` × 1 — each spec exercises the ingestion path it's meant to.

Verification gates:
- `exit_code`: `pnpm --filter @relayfile/adapter-core test:golden`
- `output_contains`: "10 golden specs pass"

Risks / notes:
- Vendored specs go stale over time; schedule a quarterly refresh task (not part of this workflow).

---

## Phase 6 — Catalog + polish (46-49)

### 46. Community mapping YAML catalog
- Phase: 6
- Slug: `community-catalog`
- Depends-on: 29, 36
- Parallel-with: 47, 48, 49

Stand up `relayfile-adapters/catalog/` as a directory of community-contributed mapping YAMLs that aren't yet promoted to first-class packages under `packages/*`. Each catalog entry has a `README.md`, the YAML itself, a manifest with author/license/last-tested-date, and a pointer to any recorded fixtures. Adds a CI job that lints every catalog entry against workflow 28 on every merge. Intentionally low-bar for contribution — catalog entries don't need round-trip parity tests, just a clean lint.

Files touched:
- `relayfile-adapters/catalog/README.md` (new — how to contribute)
- `relayfile-adapters/catalog/_template/` (new — starter for contributions)
- `.github/workflows/catalog-lint.yml` (new)
- `relayfile-adapters/docs/catalog.md` (new)

Agents:
- `worker` × 1 — catalog layout + README.
- `worker` × 1 — CI lint config.
- `reviewer` × 1 — contribution instructions are actually followable.

Verification gates:
- `file_exists`: `relayfile-adapters/catalog/README.md`
- `exit_code`: `pnpm --filter @relayfile/adapter-core lint-catalog`

Risks / notes:
- Don't promise support guarantees in the README; catalog is explicitly community-maintained.

---

### 47. VS Code extension for mapping YAMLs
- Phase: 6
- Slug: `vscode-mapping-ext`
- Depends-on: 28
- Parallel-with: 46, 48, 49

Publish a VS Code extension that provides schema validation, autocomplete, and hover docs for `*.mapping.yaml` files. Wraps workflow 28's linter as an LSP diagnostic provider and ships a JSON Schema (`mapping.schema.json`) generated from the TypeScript types in workflow 21. Extension lives under `tools/vscode-mapping-yaml/` and publishes to the VS Code marketplace on tagged release.

Files touched:
- `tools/vscode-mapping-yaml/package.json` (new)
- `tools/vscode-mapping-yaml/src/extension.ts` (new)
- `tools/vscode-mapping-yaml/src/language-server.ts` (new)
- `tools/vscode-mapping-yaml/schema/mapping.schema.json` (new, generated)
- `relayfile-adapters/packages/core/src/spec/schema-export.ts` (new — JSON Schema emitter)

Agents:
- `analyst` × 1 — study the VS Code LSP + JSON Schema integration points.
- `worker` × 1 — extension scaffold + LSP wiring.
- `worker` × 1 — JSON Schema generator.
- `reviewer` × 1 — extension actually provides hover docs on a real mapping file.

Verification gates:
- `file_exists`: `tools/vscode-mapping-yaml/package.json`
- `exit_code`: `pnpm --filter vscode-mapping-yaml compile`
- `exit_code`: `pnpm --filter vscode-mapping-yaml package`

Risks / notes:
- Marketplace publishing requires a VSCE publisher token — handle outside this workflow; this workflow ships a VSIX artifact only.

---

### 48. Mapping YAML version migration tool
- Phase: 6
- Slug: `mapping-migrate`
- Depends-on: 21, 28
- Parallel-with: 46, 47, 49

Add a `relayfile adapter migrate <mapping.yaml>` subcommand that auto-upgrades older mapping YAML versions to the current schema when the `MappingSpec` type changes shape. Each schema change gets a numbered migration function (e.g. `v1-to-v2.ts`) that transforms the YAML AST without rewriting comments or reordering keys where possible. Ensures downstream consumers aren't stranded on old schema versions when workflow 21 or later add fields.

Files touched:
- `relayfile-adapters/packages/core/src/migrations/index.ts` (new — registry)
- `relayfile-adapters/packages/core/src/migrations/v1-to-v2.ts` (new — first migration)
- `relayfile-adapters/packages/core/src/migrations/__tests__/migrate.test.ts` (new)
- `relayfile/packages/cli/src/commands/adapter-migrate.ts` (new)

Agents:
- `worker` × 1 — migration registry + first migration.
- `worker` × 1 — CLI command + tests.
- `reviewer` × 1 — comment preservation works on a real YAML file.

Verification gates:
- `file_exists`: `relayfile-adapters/packages/core/src/migrations/index.ts`
- `exit_code`: `pnpm --filter @relayfile/adapter-core test -- migrations`
- `output_contains`: "migration preserves comments"

Risks / notes:
- Version detection needs a `version:` field in the YAML; if older files don't have one, default to v1.

---

### 49. Perf benchmarks
- Phase: 6
- Slug: `perf-benchmarks`
- Depends-on: 22, 36
- Parallel-with: 46, 47, 48

Add a repeatable benchmark suite that measures `SchemaAdapter.sync()` throughput (records/sec), memory footprint, and time-to-first-record for the Phase 3 adapters against recorded fixtures. Output is a JSON report committed to `relayfile-adapters/benchmarks/results/` on demand; no perf regressions are enforced in CI (too noisy), but trend is tracked via a weekly summary task. Helps catch the accidental O(n²) regression before a real customer does.

Files touched:
- `relayfile-adapters/benchmarks/package.json` (new)
- `relayfile-adapters/benchmarks/src/run.ts` (new)
- `relayfile-adapters/benchmarks/results/.gitkeep` (new)
- `relayfile-adapters/docs/benchmarks.md` (new)

Agents:
- `worker` × 1 — benchmark harness (tinybench or mitata).
- `worker` × 1 — reporter + docs.
- `reviewer` × 1 — numbers are stable across three consecutive runs.

Verification gates:
- `file_exists`: `relayfile-adapters/benchmarks/src/run.ts`
- `exit_code`: `pnpm --filter @relayfile/benchmarks run bench -- --adapters=github --iterations=3`
- `output_contains`: "records/sec" in report

Risks / notes:
- Don't enforce perf thresholds in CI — machine variance swamps real signal. Document the expected p50/p90 in the docs and let humans eyeball drift.

---

BACKLOG_COMPLETE
