# Wave Execution Plan

## Overview
45 workflows organized into 8 parallel execution waves.
Estimated total time: ~4-5 hours with 4-6 way parallelism.

## Wave 1: Plugin System Foundation (parallel)
**Files touched:** @relayfile/sdk types, client, test helpers
**Duration:** ~30 min
```bash
agent-relay run workflows/001-adapter-plugin-types.ts &
agent-relay run workflows/003-webhook-normalization.ts &
agent-relay run workflows/004-adapter-test-helpers.ts &
agent-relay run workflows/009-plugin-config-schema.ts &
wait
git add -A && git commit -m "Wave 1: plugin system types + normalizer + test helpers + config schema"
```

## Wave 2: Plugin System Core (depends on Wave 1)
**Files touched:** SDK client registration, plugin loader, validation
**Duration:** ~30 min
```bash
agent-relay run workflows/002-adapter-registration.ts &
agent-relay run workflows/006-plugin-loader.ts &
agent-relay run workflows/007-adapter-validation.ts &
agent-relay run workflows/008-plugin-events.ts &
wait
git add -A && git commit -m "Wave 2: registration + loader + validation + events"
```

## Wave 3: Plugin System E2E + CLI (depends on Wave 2)
**Files touched:** CLI scaffolder, E2E tests
**Duration:** ~25 min
```bash
agent-relay run workflows/005-adapter-cli-scaffold.ts &
agent-relay run workflows/010-plugin-system-e2e.ts &
wait
git add -A && git commit -m "Wave 3: CLI scaffolder + plugin system E2E"
```

## Wave 4: GitHub Adapter Core (depends on Wave 1, parallel)
**Files touched:** @relayfile/adapter-github package
**Duration:** ~40 min
```bash
agent-relay run workflows/011-github-adapter-scaffold.ts &
agent-relay run workflows/020-github-diff-parser.ts &
agent-relay run workflows/024-github-adapter-config.ts &
wait
# These need the scaffold:
agent-relay run workflows/012-github-pr-ingestion.ts &
agent-relay run workflows/013-github-commit-mapping.ts &
agent-relay run workflows/014-github-nango-proxy.ts &
agent-relay run workflows/015-github-file-semantics.ts &
wait
git add -A && git commit -m "Wave 4: GitHub adapter core - PR ingestion + commits + nango + semantics"
```

## Wave 5: GitHub Adapter Features (depends on Wave 4)
**Files touched:** adapter GitHub mappings
**Duration:** ~35 min
```bash
agent-relay run workflows/016-github-review-mapping.ts &
agent-relay run workflows/017-github-check-runs.ts &
agent-relay run workflows/018-github-issue-mapping.ts &
agent-relay run workflows/019-github-webhook-router.ts &
agent-relay run workflows/021-github-bulk-ingest.ts &
wait
git add -A && git commit -m "Wave 5: reviews + checks + issues + webhook router + bulk ingest"
```

## Wave 6: GitHub Adapter Advanced + E2E (depends on Wave 5)
**Files touched:** sync, branches, e2e
**Duration:** ~30 min
```bash
agent-relay run workflows/022-github-incremental-sync.ts &
agent-relay run workflows/023-github-branch-mapping.ts &
agent-relay run workflows/025-github-adapter-e2e.ts &
wait
git add -A && git commit -m "Wave 6: incremental sync + branches + GitHub adapter E2E"
```

## Wave 7: Review Integration (depends on Wave 4 + relayauth)
**Files touched:** review orchestrator, tokens, writeback
**Duration:** ~45 min
```bash
agent-relay run workflows/026-review-workspace-lifecycle.ts &
agent-relay run workflows/027-review-scoped-tokens.ts &
agent-relay run workflows/042-adapter-error-catalog.ts &
agent-relay run workflows/043-adapter-rate-limiting.ts &
wait
agent-relay run workflows/028-review-agent-dispatch.ts &
agent-relay run workflows/029-review-writeback.ts &
agent-relay run workflows/030-review-orchestrator.ts &
agent-relay run workflows/031-review-concurrent-prs.ts &
wait
agent-relay run workflows/032-review-comment-threading.ts &
agent-relay run workflows/033-review-status-checks.ts &
agent-relay run workflows/034-review-summary-generation.ts &
agent-relay run workflows/035-review-metrics-tracking.ts &
wait
git add -A && git commit -m "Wave 7: review integration - lifecycle + tokens + dispatch + writeback + orchestrator"
```

## Wave 8: Ecosystem + Final E2E (depends on all above)
**Files touched:** example adapters, publishing, telemetry, docs
**Duration:** ~40 min
```bash
agent-relay run workflows/036-adapter-slack-example.ts &
agent-relay run workflows/037-adapter-linear-example.ts &
agent-relay run workflows/038-adapter-docs-generator.ts &
agent-relay run workflows/044-adapter-telemetry.ts &
wait
agent-relay run workflows/039-adapter-publish-pipeline.ts &
agent-relay run workflows/040-adapter-versioning.ts &
agent-relay run workflows/041-adapter-compatibility-matrix.ts &
wait
agent-relay run workflows/045-full-system-e2e.ts
git add -A && git commit -m "Wave 8: ecosystem adapters + publishing + telemetry + full E2E"
```

## Dependency Graph (simplified)

```
Wave 1 ──→ Wave 2 ──→ Wave 3
  │                      │
  └──→ Wave 4 ──→ Wave 5 ──→ Wave 6
              │
              └──→ Wave 7 ──→ Wave 8
```

## Parallelism Budget

| Wave | Workflows | Max Parallel | Est. Time |
|------|-----------|-------------|-----------|
| 1    | 4         | 4           | 30 min    |
| 2    | 4         | 4           | 30 min    |
| 3    | 2         | 2           | 25 min    |
| 4    | 7         | 4→4         | 40 min    |
| 5    | 5         | 5           | 35 min    |
| 6    | 3         | 3           | 30 min    |
| 7    | 12        | 4→4→4       | 45 min    |
| 8    | 8         | 4→3→1       | 40 min    |
| **Total** | **45** | | **~4.5 hours** |
