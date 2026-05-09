# Repeatable Workflows

Repeatable workflows are meant to be run more than once as the adapter catalog changes. Keep them deterministic, resumable, and narrow enough that future agents can use them without rediscovering the operating model.

## Guidelines

- Put repeatable workflows in this directory, using descriptive names instead of numbered one-off names.
- Keep inputs explicit through environment variables, and document every supported variable in this README.
- Prefer deterministic preflight and final validation steps that can run without an agent.
- When a workflow edits shared catalog files, process targets in a stable order and avoid parallel writes to the same file.
- Write per-target evidence into `.workflow-artifacts/<workflow-name>/` so eval runners can inspect sources and uncertainty.
- Do not stage or commit unrelated worktree changes. These workflows are often run in active branches with other edits present.

## `research-integration-scopes.ts`

Researches missing scopes and permissions for entries in `docs/integration-scopes.yaml`.

The workflow reads the YAML catalog, selects entries with `scope_status: pending` or `scope_status: needs_review`, sorts them by `slug`, and runs one sequential research agent per integration. Each agent updates exactly one YAML entry and writes a matching evidence note under `.workflow-artifacts/integration-scope-research/`.

Use it when adding integrations, preparing app registrations, or refreshing eval requirements after provider docs change.

```bash
ricky run workflows/repeatable/research-integration-scopes.ts
```

Run a small batch first:

```bash
SCOPE_RESEARCH_LIMIT=5 ricky run workflows/repeatable/research-integration-scopes.ts
```

Allow a partial run to finish even when other entries remain pending:

```bash
SCOPE_RESEARCH_ALLOW_PENDING=1 ricky run workflows/repeatable/research-integration-scopes.ts
```

Useful variables:

| Variable | Purpose |
|---|---|
| `SCOPE_RESEARCH_LIMIT` | Limits the number of pending or review-needed integrations processed in this run. |
| `SCOPE_RESEARCH_ALLOW_PENDING` | Set to `1` to let final validation pass even when unprocessed pending entries remain. This is useful for batched runs. |

Expected outputs:

| Path | Purpose |
|---|---|
| `docs/integration-scopes.yaml` | Updated scope catalog consumed by evals and app registration work. |
| `.workflow-artifacts/integration-scope-research/<slug>.md` | Evidence, sources, and uncertainty for each researched integration. |
