#!/usr/bin/env bash
#
# run-campaign.sh — sequentially execute the schema-adapter migration
# campaign from the AgentWorkforce root. Each step is one workflow file;
# meta-workflows draft target workflows, target workflows apply the actual
# refactor. Halts on first failure. Resumable via the state file.
#
# Usage:
#   ./relayfile-adapters/workflows/schema-adapter-migration/run-campaign.sh
#
# Must be invoked from the AgentWorkforce root (so cross-repo paths resolve).
# Each workflow run can take 5-40 minutes; plan for unattended operation.
#
# State file format: one absolute-ish workflow path per line, each line is a
# completed step. Lines are appended in order. To re-run a completed step,
# delete its line from the state file. To start over, delete the state file.
#
# Halt behavior: `set -e` exits on the first non-zero agent-relay exit. The
# state file is updated ONLY after a successful run, so restarting the script
# picks up exactly where it failed.
#
# Globs resolve at call time (not script-parse time) so meta-workflows can
# produce target files that later steps then run. Each step's pattern must
# match exactly one file at call time; ambiguous matches halt the run.

set -euo pipefail

CAMPAIGN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WF_DIR="relayfile-adapters/workflows/schema-adapter-migration"
STATE_FILE="$CAMPAIGN_ROOT/$WF_DIR/.campaign-state"

cd "$CAMPAIGN_ROOT"

# Ordered sequence of glob patterns to run, one per line.
# Meta-workflows (00, 00b, 00c, ...) produce target workflows (20, 21, 22, ...)
# that are then run by subsequent lines. If a target file doesn't exist when
# its line is reached, the preceding meta-workflow didn't produce it and the
# script halts.
#
# Patterns that currently fail to resolve (e.g. 21-*.ts before 00b has run)
# are fine — the script will wait for the glob to resolve at the moment each
# line is evaluated.
CAMPAIGN_SEQUENCE=(
  # Phase 0 — Meta-workflow foundation (already shipped if 00 ran successfully)
  "$WF_DIR/00-generate-workflows.ts"

  # Phase 1 — Canonical IntegrationAdapter + adapter-core migration
  "$WF_DIR/20-canonical-integration-adapter-sdk.ts"

  # Phase 1 rest — meta-workflow drafts 21/22/23/24, then each runs in order
  "$WF_DIR/00b-generate-phase-1-rest.ts"
  "$WF_DIR/21-*.ts"
  "$WF_DIR/22-*.ts"
  "$WF_DIR/23-*.ts"
  "$WF_DIR/24-*.ts"

  # Phase 2 — mapping toolchain (requires 00c-*.ts to be authored first)
  # Uncomment as phase 2 is drafted:
  # "$WF_DIR/00c-generate-phase-2.ts"
  # "$WF_DIR/25-*.ts"
  # "$WF_DIR/26-*.ts"
  # "$WF_DIR/27-*.ts"
  # "$WF_DIR/28-*.ts"
  # "$WF_DIR/29-*.ts"

  # Phase 3 — per-adapter migrations
  # Uncomment as phase 3 is drafted (Mode A/B/C decisions per adapter):
  # "$WF_DIR/00d-generate-phase-3.ts"
  # "$WF_DIR/30-*.ts" "$WF_DIR/31-*.ts" "$WF_DIR/32-*.ts"
  # "$WF_DIR/33-*.ts" "$WF_DIR/34-*.ts" "$WF_DIR/35-*.ts" "$WF_DIR/36-*.ts"

  # Phase 4 — sage consumer integration
  # "$WF_DIR/00e-generate-phase-4.ts"
  # "$WF_DIR/37-*.ts" "$WF_DIR/38-*.ts" "$WF_DIR/39-*.ts"
  # "$WF_DIR/40-*.ts" "$WF_DIR/41-*.ts"

  # Phase 5 — ingestion hardening (parallelizable, runs after 37-41)
  # "$WF_DIR/00f-generate-phase-5.ts"
  # "$WF_DIR/42-*.ts" "$WF_DIR/43-*.ts" "$WF_DIR/44-*.ts" "$WF_DIR/45-*.ts"

  # Phase 6 — catalog + polish (lowest priority)
  # "$WF_DIR/00g-generate-phase-6.ts"
  # "$WF_DIR/46-*.ts" "$WF_DIR/47-*.ts" "$WF_DIR/48-*.ts" "$WF_DIR/49-*.ts"
)

mkdir -p "$(dirname "$STATE_FILE")"
touch "$STATE_FILE"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  schema-adapter migration campaign"
echo "  root:  $CAMPAIGN_ROOT"
echo "  state: $STATE_FILE"
echo "  steps: ${#CAMPAIGN_SEQUENCE[@]}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

completed=0
skipped=0
failed_step=""

for pattern in "${CAMPAIGN_SEQUENCE[@]}"; do
  # Resolve the glob at call time — later patterns may depend on files
  # produced by earlier meta-workflows.
  # shellcheck disable=SC2086
  matches=( $pattern )
  if [ ${#matches[@]} -eq 0 ] || [ ! -e "${matches[0]}" ]; then
    echo
    echo "✗ HALT: no file matches $pattern"
    echo "  This usually means a preceding meta-workflow didn't produce it."
    echo "  Fix the upstream or author the missing workflow manually, then re-run."
    failed_step="$pattern"
    break
  fi
  if [ ${#matches[@]} -gt 1 ]; then
    echo
    echo "✗ HALT: ambiguous match for $pattern:"
    printf '    %s\n' "${matches[@]}"
    echo "  Narrow the pattern or remove ambiguity."
    failed_step="$pattern"
    break
  fi
  wf_file="${matches[0]}"

  if grep -qFx "$wf_file" "$STATE_FILE" 2>/dev/null; then
    echo "✓ SKIP (already done): $wf_file"
    skipped=$((skipped + 1))
    continue
  fi

  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  → RUNNING: $wf_file"
  echo "  started: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if agent-relay run "$wf_file"; then
    echo "$wf_file" >> "$STATE_FILE"
    echo "✓ DONE: $wf_file ($(date '+%Y-%m-%d %H:%M:%S'))"
    completed=$((completed + 1))
  else
    echo "✗ FAILED: $wf_file ($(date '+%Y-%m-%d %H:%M:%S'))"
    failed_step="$wf_file"
    break
  fi
done

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CAMPAIGN RUN SUMMARY"
echo "  completed this run: $completed"
echo "  skipped (prior):    $skipped"
if [ -n "$failed_step" ]; then
  echo "  halted at:          $failed_step"
  echo
  echo "  To resume: fix the failure and re-run this script. Completed steps"
  echo "  will be skipped via $STATE_FILE."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
echo "  status:             all workflows complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
