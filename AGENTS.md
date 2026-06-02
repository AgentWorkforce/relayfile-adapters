## Repository conventions

### Adapter contract

Every adapter under `packages/<name>` MUST:

- Export a `path-mapper.ts` with typed helpers for every canonical record path it emits. Importing the helper is the only supported way to compute a path; consumers must not construct paths by string concatenation.
- Emit a provider-specific `LAYOUT.md` at the root of its provider tree (e.g. `/<provider>/LAYOUT.md`) of at least ~1000 bytes describing the tree, naming convention, indexes, aliases, and copy-pasteable `jq`/`ls` examples. The 250-300 byte generic fallback is not acceptable for any shipping adapter.
- Emit `_index.json` files at each resource root listing all materialized records. The row schema MUST include `{ id, title, updated }` at a minimum; additional fields are encouraged when they enable filterless reads (e.g. `state`, `key`, `is_bot`, `parent_id`).
- Provide `by-*` alias subtree views when the underlying entity has a natural human-readable lookup key distinct from its stable ID (titles, names, keys, statuses, parents). Each alias path must resolve to the same record as the canonical path. Alias content may be either a minimal pointer `{ id, canonicalPath, ...minimal pointer fields }` or a materialized canonical mirror, but the choice must be consistent within a resource and covered by tests.
- Use `packages/core/src/alias-slug.ts` (`slugifyAlias`, `aliasCollisionSuffix`) for slug normalization and collision suffixes. Provider-local alias modules should re-export those helpers for backward compatibility. NEVER write a new slugifier.

### Declared catalogs: triggers, scope keys, and writeback paths

An adapter declares part of its contract as **data** so downstream consumers
(notably `@agentworkforce/persona-kit`, which types persona authoring, and
`@agentworkforce/relay-helpers`, which resolves draft paths) can autocomplete
and lint against it. When you add an adapter or change what it supports, keep
these current:

- **`supportedEvents(): string[]`** (adapter class, or a `webhooks:` block in
  `<provider>.mapping.yaml`) — the trigger event names the adapter emits
  (`pull_request.opened`). Feeds `@relayfile/adapter-core/triggers`
  (`KNOWN_TRIGGER_CATALOG`).
- **`supportedScopeKeys(): string[]`** (adapter class, or a `scopeKeys:` block in
  `<provider>.mapping.yaml`) — the connection-scope **filter** keys a persona may
  set under `integrations.<provider>.scope` (github → `owner`/`repo`). These are
  the user-facing filter params on the adapter config, NOT infra fields
  (`connectionId`, tokens). Feeds `@relayfile/adapter-core/scope-keys`
  (`KNOWN_SCOPE_KEY_CATALOG`). Declare only keys a persona should actually set;
  the set isn't derivable, which is why it's an explicit method.
- **`resources.ts`** (`{ name, path }[]`, generated from the `writebacks:`/
  `resources:` mapping blocks) — the canonical mount **path templates** a draft
  is written to in order to trigger a mutation. Each template is a path like
  `/linear/issues/{issueId}/comments`. This is the same data the writeback
  worker's `classifyWrite` routes against. Feeds
  `@relayfile/adapter-core/writeback-paths` (`WRITEBACK_PATH_CATALOG` + the
  `writebackPath(provider, resource, params)` resolver). A resource `name` can
  hold several templates (the same entity mounted at different roots); the
  resolver disambiguates by the exact param set. Read-only adapters with no
  writeback resources are listed in `ADAPTERS_WITHOUT_WRITEBACK_PATHS`, not
  silently dropped.

> "scope" is overloaded here: `docs/integration-scopes.yaml` tracks **OAuth
> permission scopes** (`data.records:read`) for app registration — a different
> thing from `supportedScopeKeys()` (connection filter keys). Don't conflate them.

The catalogs are generated, committed artifacts. After changing any of the above,
regenerate (adapters must be built first — the generators import them):

```bash
npx turbo build
npx adapter-core triggers generate
npx adapter-core scope-keys generate
npx adapter-core writeback-paths generate
```

This is **CI-enforced**: `npm test` (→ `turbo test`) runs an in-sync test per
catalog that regenerates and diffs the committed files, so changing a declaration
without regenerating fails the build. Ad-hoc check form:
`npx adapter-core triggers check` / `npx adapter-core scope-keys check` /
`npx adapter-core writeback-paths check`.

Cross-repo: a catalog change reaches `persona-kit` / `relay-helpers` only on its
next `@relayfile/adapter-core` dep bump (release coordination — see
[Cross-repo coordination](#cross-repo-coordination)). A *missing* `/triggers`,
`/scope-keys`, or `/writeback-paths` export hard-fails the consumer's build; a
*stale* catalog merely lags until the bump.

> **Adding a new writeback-capable adapter** (one with `resources.ts` writeback
> paths) puts a new provider in `WRITEBACK_PATH_CATALOG`. Downstream,
> `@agentworkforce/relay-helpers` (workforce) must add a named `<provider>Client`
> for it — its test *"every catalog provider has a named client export"* goes red
> on the next adapter-core bump until someone does. So when you add an adapter,
> leave a note on the release/bump PR so the workforce side gets its client (see
> `packages/relay-helpers/AGENTS.md` there). The build enforces it; this is the
> heads-up so it isn't a surprise.

### Generated adapter path templates are not authoritative

Older mapping specs and generated workflow prompts may still contain the legacy
`/<provider>/<resource>/<id>/metadata.json` shape. Treat those as historical
scaffolding only. Before shipping any adapter path change, compare every emitted
canonical path against the contract below:

- Entities with child artifacts MUST use directory records ending in `meta.json`.
- Entities without child artifacts MUST use flat `.json` records.
- If a generated template disagrees with `path-mapper.ts`, update the template,
  README, discovery docs, and tests in the same PR.
- Add a regression test that fails on the legacy `metadata.json` shape whenever
  the entity owns child files.

### Naming convention

The cross-adapter joiner between a human-readable slug and the provider's stable ID is **`<slug>__<id>`** (double underscore). The shape depends on whether the entity owns child files:

- **Flat records** (entities with no sub-artifacts): `<slug>__<id>.json` at a canonical resource directory. Example: `/jira/issues/task-1__10000.json`.
- **Directory records** (entities WITH sub-artifacts, e.g. GitHub PRs with `diff.patch`/`files/**`, Slack channels with `messages/**`): `<id>__<slug>/meta.json`. Example: `/github/repos/o/r/pulls/42__fix-thing/meta.json`.

Rule of thumb: if the entity owns child files, use a directory plus `meta.json`. Otherwise, prefer the flat form — it is simpler and matches the "human-discoverable filesystem" pitch.

Slug rules (always go through `slugifyAlias`):

- ASCII only, lowercase, hyphen-separated.
- Truncate to 80 characters at a word boundary.
- Empty slugs fall back to the bare ID (or `untitled` for aliases).
- Never roll your own slugifier; reuse `packages/core/src/alias-slug.ts`.

ID format: whatever the provider's stable ID is (UUID, numeric, string key). Do not normalize provider IDs.

### Indexes

- `/<provider>/_index.json` enumerates top-level resource roots (e.g. `{ "id": "issues", "title": "Issues" }`-style entries).
- `/<provider>/<resource>/_index.json` enumerates all records with `{ id, title, updated, ...natural-filter-fields }`.
- Indexes MUST stay sorted by `updated` descending so consumers can rely on order without re-sorting.

### Aliases

- Path shape: `/<provider>/<resource>/by-<key>/<slug>__<id>.json` (e.g. `/notion/pages/by-title/my-page__a1b2c3d4.json`).
- Collisions: append a deterministic short hash of the ID via `aliasCollisionSuffix`. NEVER pick "first writer wins" — collision handling must be deterministic across sync runs.
- Alias files are either minimal pointers (`{ id, canonicalPath, title? }`) or materialized canonical mirrors. Keep the choice consistent within each resource, and document/test it so readers know whether to follow `canonicalPath` or read the alias body directly.

### Versioning

- NEVER bump `version` in `package.json` in feature PRs. The publish workflow handles version bumps.
- If you change a path-mapper helper's output, add the new helper additively and deprecate the old (export both, JSDoc-deprecate the old). Or implement reader-side back-compat: try the new path, fall back to the old. NEVER break existing consumers without a deprecation window.

### Tests

- `npx turbo build typecheck test` at the repo root MUST pass before any PR is opened.
- Each path-mapper helper needs round-trip tests (compose -> parse -> equality).
- Each alias subtree needs a collision test.
- Each `LAYOUT.md` emitter needs a non-empty content test (length plus key-substring assertions).

### Cross-repo coordination

- Cloud (`AgentWorkforce/cloud`) consumes these adapters. After a path-mapper change ships and is published, cloud needs a dep bump and possibly a full provider resync. Coordinate by mentioning the follow-up in the adapter PR body.

### Do not bump package versions in feature PRs

Versions in `packages/*/package.json` are bumped by the publish phase, not in the PR that introduces the change. The repo's pattern (see `chore(release): bump all (patch)` commits in history) is:

1. Open a feature PR with the source change only — leave `version` fields untouched.
2. After merge, the publish workflow (`.github/workflows/publish.yml`, `workflow_dispatch`) handles the version bump and npm publish.

If you bump a version in a feature PR, downstream consumers (e.g. the `cloud` repo) may pin to a version that hasn't been published yet, breaking installs. Always leave version bumps to the release flow.

### Adding a new adapter package: discoverable by `publish.yml`

The publish workflow's "Resolve packages to publish" step delegates to `scripts/resolve-publish-targets.mjs`, which auto-discovers every non-private directory under `packages/` from the filesystem. **A new adapter package needs no manual edits to `.github/workflows/publish.yml` to be publishable** — as long as its `package.json` exists and is not marked `"private": true`, it will be picked up by `package=all`, the `missing` selector, and any group alias that includes its slug.

What you _do_ need to do when adding a new adapter:

1. Ensure the package has a `package.json` with `"private"` unset (or `false`) and a `version` field — otherwise the resolver skips it.
2. If the new adapter belongs to a category that maps to a `GROUPS` alias in `scripts/resolve-publish-targets.mjs` (e.g. `crm`, `messaging`, `storage`), add its slug to that group so it can be published as part of the group. Adding new group aliases is optional.

Quick sanity check before opening the PR — confirms the resolver sees the new package (should list every non-private slug under `packages/`):

```bash
node scripts/resolve-publish-targets.mjs all
```

If your new adapter is missing from the output, check that `packages/<slug>/package.json` exists and is not marked private.

### Adapter writeback discovery is required

Every adapter resource that supports writeback must declare file-native writeback metadata:

1. `src/resources.ts` entry with a resource path, schema path, create example path, and `idPattern` regex.
2. `.schema.json` — JSON Schema draft 2020-12 for the full synced record shape, not only the create payload.
3. `.create.example.json` — a minimal valid create document that omits read-only fields.

Each adapter must also ship `<adapter>/.adapter.md` in its discovery tree with an overview, read-only mount summary, resource table, operation table, and ID pattern section. Source schema details from the strongest available integration contract: JSON Schema, OpenAPI, Postman collection, provider docs, or the adapter writeback resolver. Field-level descriptions are required, create-time required fields must be explicit, provider enum values must be represented as `enum` values, and server-managed fields such as `id`, `createdAt`, `updatedAt`, `url`, `_webhook`, and `_connection` must use `"readOnly": true`.

New resources must not introduce a magic `new.json` create path. Creates happen by writing a valid JSON document to any non-canonical filename in the resource directory; edits happen by writing mutable fields to a canonical `<id>.json`; deletes happen by removing a canonical `<id>.json`. When adding a new adapter or writeback route, update `scripts/writeback-discovery-data.mjs`, regenerate the discovery files with `node scripts/generate-writeback-discovery.mjs`, and run `npm run test:writeback-discovery`. Do not rely on prompts alone to describe writeback shapes.

Tracking docs are part of the adapter contract. When adding a new integration, adding/removing writeback resources, or changing whether an endpoint is backed by OpenAPI, JSON Schema, Postman, provider docs, or inline code, update `docs/writeback-spec-coverage.md` in the same PR. If a change affects any other integration tracking document, such as scope/permission inventories, schema provenance notes, provider capability matrices, or generated discovery coverage, update that tracking doc alongside the code and mention the doc update in the PR summary.

<!-- PRPM_MANIFEST_START -->

<skills_system priority="1">
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills (loaded into main context):
- Use the <path> from the skill entry below
- Invoke: Bash("cat <path>")
- The skill content will load into your current context
- Example: Bash("cat .openskills/backend-architect/SKILL.md")

Usage notes:
- Skills share your context window
- Do not invoke a skill that is already loaded in your context
</usage>

<available_skills>

<skill activation="lazy">
<name>running-headless-orchestrator</name>
<description>Use when an agent needs to self-bootstrap agent-relay and autonomously manage a team of workers - covers infrastructure startup, agent spawning, lifecycle monitoring, and team coordination without human intervention</description>
<path>.openskills/running-headless-orchestrator/SKILL.md</path>
</skill>

<skill activation="lazy">
<name>writing-agent-relay-workflows</name>
<description>Use when building multi-agent workflows with the relay broker-sdk - covers the WorkflowBuilder API, DAG step dependencies, agent definitions, step output chaining via {{steps.X.output}}, verification gates, dedicated channels, swarm patterns, error handling, and event listeners</description>
<path>.openskills/writing-agent-relay-workflows/SKILL.md</path>
</skill>

</available_skills>
</skills_system>

<!-- PRPM_MANIFEST_END -->

<!-- prpm:snippet:start @agent-workforce/trail-snippet@1.1.2 -->
# Trail

Record your work as a trajectory for future agents and humans to follow.

## Usage

If `trail` is installed globally, run commands directly:
```bash
trail start "Task description"
```

If not globally installed, use npx to run from local installation:
```bash
npx trail start "Task description"
```

## When Starting Work

Start a trajectory when beginning a task:

```bash
trail start "Implement user authentication"
```

With external task reference:
```bash
trail start "Fix login bug" --task "ENG-123"
```

## Recording Decisions

Record key decisions as you work:

```bash
trail decision "Chose JWT over sessions" \
  --reasoning "Stateless scaling requirements"
```

For minor decisions, reasoning is optional:
```bash
trail decision "Used existing auth middleware"
```

**Record decisions when you:**
- Choose between alternatives
- Make architectural trade-offs
- Decide on an approach after investigation

## Recording Reflections

Periodically step back and synthesize progress:

```bash
trail reflect "Workers aligned on auth approach, API layer progressing well" \
  --confidence 0.8
```

With focal points and adjustments:
```bash
trail reflect "Frontend and backend duplicating validation logic" \
  --focal-points "duplication,ownership" \
  --adjustments "Reassigning validation to backend team" \
  --confidence 0.7
```

**Record reflections when you:**
- Have received several updates and need to synthesize the big picture
- Notice workers or tasks diverging from the plan
- Want to course-correct before continuing
- Are coordinating multiple agents and need to assess overall progress

Reflections differ from decisions: decisions record a specific choice,
reflections record a higher-level synthesis of what's happening and whether
the current approach is working.

## Completing Work

When done, complete with a retrospective:

```bash
trail complete --summary "Added JWT auth with refresh tokens" --confidence 0.85
```

After completing work, compact the finished trajectory or merged PR into a
durable summary. When the compacted summary is sufficient, discard the raw
source trajectories so `.trajectories/index.json` and list output stay focused:

```bash
trail compact --discard-sources
# or after a PR merge:
trail compact --pr 42 --discard-sources
```

`--discard-sources` removes the source trajectory JSON/Markdown/trace files and
updates the index. Use it after confirming the compacted artifact is the record
you want to keep.

**Confidence levels:**
- 0.9+ : High confidence, well-tested
- 0.7-0.9 : Good confidence, standard implementation
- 0.5-0.7 : Some uncertainty, edge cases possible
- <0.5 : Significant uncertainty, needs review

## Abandoning Work

If you need to stop without completing:

```bash
trail abandon --reason "Blocked by missing API credentials"
```

## Checking Status

View current trajectory:
```bash
trail status
```

## Listing and Viewing Trajectories

List all trajectories:
```bash
trail list
```

View a specific trajectory:
```bash
trail show <trajectory-id>
```

Export a trajectory (markdown, json, timeline, html):
```bash
trail export <trajectory-id> --format markdown
```

## Compacting Trajectories

After a PR merge, compact related trajectories into a single summary and prune
raw source trajectories when the summary should replace them:

```bash
trail compact --pr 42 --discard-sources
```

Compact by branch (finds trajectories with commits not in the specified base branch):
```bash
trail compact --branch main --discard-sources
```

Compact by specific commits:
```bash
trail compact --commits abc123,def456 --discard-sources
```

Compaction consolidates decisions and creates a grouped summary. Adding
`--discard-sources` makes the compacted artifact the durable record by removing
the raw trajectories and their index entries.

## Why Trail?

Your trajectory helps others understand:
- **What** you built (commits show this)
- **Why** you built it this way (trajectory shows this)
- **What alternatives** you considered
- **What challenges** you faced

Future agents can query past trajectories to learn from your decisions.
<!-- prpm:snippet:end @agent-workforce/trail-snippet@1.1.2 -->

# Relayfile Integration Digest Contract

Relayfile digest rendering is generic upstream over workspace events. Every
adapter that exposes provider records to Relayfile must expose usable metadata
and layout aliases for that generic renderer. When adding or materially changing
an adapter:

- Classify lifecycle actions explicitly. Terminal states such as `closed`,
  `merged`, `archived`, `completed`, `canceled`, and `resolved` must not fall
  through to a generic "updated" line unless the provider has no terminal
  concept.
- Do not model terminal lifecycle states as deletion in adapter webhook
  handling. Only actual upstream deletes should produce delete semantics.
- Keep digest behavior and layout aliases aligned with the category matrix in
  `docs/digest-layout-contract.md`. Issue-tracking resources must expose
  `by-state`, `by-assignee`, `by-creator`, and `by-priority` unless the matrix
  documents an explicit exception; status-driven build/deploy resources must
  expose `by-status`.
- If an adapter exports a digest compatibility handler, build it with
  `createDigestHandler` and shared digest types from `@relayfile/adapter-core`.
  Adapter-local code should only identify provider records, declare lifecycle
  action rules, optionally narrow canonical record paths, and configure alias
  segments. Do not reimplement sorting, path prefix filtering, alias/index/layout
  suppression, or digest bullet assembly in adapter packages.
- Run `npm run test:digest-contracts` after adding or changing an adapter,
  layout manifest, or category matrix entry.

Full rule: `.claude/rules/relayfile-integration-digests.md`.
