#!/usr/bin/env bash
set -euo pipefail

CAMPAIGN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WF_DIR="relayfile-adapters/workflows/schema-adapter-migration"
STATE_FILE="$CAMPAIGN_ROOT/$WF_DIR/.campaign-state"
BASELINE_DIR="$CAMPAIGN_ROOT/$WF_DIR/.campaign-pr-baseline"
REPORT_FILE="$CAMPAIGN_ROOT/$WF_DIR/.campaign-pr-report.tsv"
REPOS=(relayfile relayfile-adapters relayfile-providers sage)

DRY_RUN=false
IGNORE_BASELINE=false
INIT_BASELINE=false

usage() {
  cat <<'EOF'
Usage:
  ./relayfile-adapters/workflows/schema-adapter-migration/finalize-campaign-prs.sh [--dry-run] [--ignore-baseline]
  ./relayfile-adapters/workflows/schema-adapter-migration/finalize-campaign-prs.sh --init-baseline

Modes:
  --init-baseline    Snapshot starting branch + dirty-path baseline for campaign repos.
  --dry-run          Print the repos/files/PRs that would be created without mutating git or GitHub.
  --ignore-baseline  Do not subtract the starting dirty-path baseline when collecting commit candidates.
EOF
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

repo_exists() {
  local repo="$1"
  [ -d "$CAMPAIGN_ROOT/$repo/.git" ]
}

default_branch_for_repo() {
  local repo="$1"
  local branch
  branch="$(git -C "$CAMPAIGN_ROOT/$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  branch="${branch#origin/}"
  if [ -n "$branch" ]; then
    printf '%s\n' "$branch"
  else
    printf 'main\n'
  fi
}

current_branch_for_repo() {
  local repo="$1"
  local branch
  branch="$(git -C "$CAMPAIGN_ROOT/$repo" branch --show-current 2>/dev/null || true)"
  if [ -n "$branch" ]; then
    printf '%s\n' "$branch"
  else
    printf 'HEAD\n'
  fi
}

collect_repo_changes() {
  local repo="$1"
  local output_file="$2"
  {
    git -C "$CAMPAIGN_ROOT/$repo" diff --name-only
    git -C "$CAMPAIGN_ROOT/$repo" diff --cached --name-only
    git -C "$CAMPAIGN_ROOT/$repo" ls-files -o --exclude-standard
  } | awk 'NF { if (!seen[$0]++) print $0 }' > "$output_file"
}

ignore_path() {
  local repo="$1"
  local path="$2"
  case "$repo/$path" in
    relayfile-adapters/workflows/schema-adapter-migration/.campaign-state)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/.campaign-pr-report.tsv)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/.campaign-pr-baseline/*)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/BATCH_REVIEW_*.md)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/PEER_REVIEW_*.md)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/PLAN_*.md)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/REVIEW_*.md)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/SELF_REFLECT_*.md)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/DECISIONS_*.md)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/SIGN_OFF_*.md)
      return 0
      ;;
    relayfile-adapters/workflows/schema-adapter-migration/*.v1.*)
      return 0
      ;;
  esac
  return 1
}

extract_workflow_packages() {
  local workflow_file="$1"
  awk '
    BEGIN {
      in_header = 0;
      collecting = 0;
      buffer = "";
      emitted = 0;
    }
    /^[[:space:]]*\/\*\*/ {
      in_header = 1;
      next;
    }
    in_header {
      line = $0;
      sub(/^[[:space:]]*\*[[:space:]]?/, "", line);
      if (collecting) {
        if (line == "" || line ~ /^[A-Za-z][^:]*:[[:space:]]/) {
          print buffer;
          emitted = 1;
          exit;
        }
        buffer = buffer " " line;
        next;
      }
      if (line ~ /^Packages:[[:space:]]*/) {
        sub(/^Packages:[[:space:]]*/, "", line);
        buffer = line;
        collecting = 1;
      }
    }
    END {
      if (buffer != "" && emitted == 0) print buffer;
    }
  ' "$workflow_file"
}

repo_is_supported() {
  local target="$1"
  local repo
  for repo in "${REPOS[@]}"; do
    if [ "$repo" = "$target" ]; then
      return 0
    fi
  done
  return 1
}

append_unique_line() {
  local value="$1"
  local file="$2"
  if [ -z "$value" ]; then
    return 0
  fi
  if [ ! -f "$file" ] || ! grep -Fqx "$value" "$file" 2>/dev/null; then
    printf '%s\n' "$value" >> "$file"
  fi
}

remote_slug_for_repo() {
  local repo="$1"
  local remote
  remote="$(git -C "$CAMPAIGN_ROOT/$repo" remote get-url origin 2>/dev/null || true)"
  case "$remote" in
    git@github.com:*.git)
      remote="${remote#git@github.com:}"
      remote="${remote%.git}"
      ;;
    git@github.com:*)
      remote="${remote#git@github.com:}"
      ;;
    https://github.com/*.git)
      remote="${remote#https://github.com/}"
      remote="${remote%.git}"
      ;;
    https://github.com/*)
      remote="${remote#https://github.com/}"
      ;;
    ssh://git@github.com/*/*.git)
      remote="${remote#ssh://git@github.com/}"
      remote="${remote%.git}"
      ;;
    ssh://git@github.com/*/*)
      remote="${remote#ssh://git@github.com/}"
      ;;
    *)
      remote=""
      ;;
  esac
  printf '%s\n' "$remote"
}

snapshot_baseline() {
  local repo
  mkdir -p "$BASELINE_DIR"
  for repo in "${REPOS[@]}"; do
    if ! repo_exists "$repo"; then
      continue
    fi
    {
      printf 'start_branch=%s\n' "$(current_branch_for_repo "$repo")"
      printf 'default_branch=%s\n' "$(default_branch_for_repo "$repo")"
    } > "$BASELINE_DIR/$repo.meta"
    collect_repo_changes "$repo" "$BASELINE_DIR/$repo.paths"
  done
}

load_repo_meta() {
  local repo="$1"
  local meta_file="$BASELINE_DIR/$repo.meta"
  REPO_START_BRANCH=""
  REPO_DEFAULT_BRANCH="$(default_branch_for_repo "$repo")"
  if [ -f "$meta_file" ]; then
    # shellcheck disable=SC1090
    . "$meta_file"
    REPO_START_BRANCH="${start_branch:-}"
    REPO_DEFAULT_BRANCH="${default_branch:-$REPO_DEFAULT_BRANCH}"
  fi
}

matches_allowed_prefix() {
  local path="$1"
  local prefixes_file="$2"
  local prefix
  while IFS= read -r prefix; do
    [ -n "$prefix" ] || continue
    if [ "$path" = "$prefix" ] || [[ "$path" == "$prefix/"* ]]; then
      return 0
    fi
  done < "$prefixes_file"
  return 1
}

report_line() {
  local repo="$1"
  local status="$2"
  local branch="$3"
  local pr_url="$4"
  local reason="$5"
  printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$status" "$branch" "$pr_url" "$reason" >> "$REPORT_FILE"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --ignore-baseline)
      IGNORE_BASELINE=true
      ;;
    --init-baseline)
      INIT_BASELINE=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ "$INIT_BASELINE" = true ]; then
  snapshot_baseline
  echo "Baseline initialized at $BASELINE_DIR"
  exit 0
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "Missing state file: $STATE_FILE" >&2
  exit 1
fi

if [ ! -s "$STATE_FILE" ]; then
  echo "No completed workflows in $STATE_FILE"
  exit 0
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

: > "$REPORT_FILE"

repo=""
for repo in "${REPOS[@]}"; do
  : > "$tmp_dir/$repo.prefixes"
  : > "$tmp_dir/$repo.workflows"
done

while IFS= read -r workflow_path; do
  [ -n "$workflow_path" ] || continue
  workflow_abs="$CAMPAIGN_ROOT/$workflow_path"
  if [ ! -f "$workflow_abs" ]; then
    continue
  fi
  workflow_name="$(basename "$workflow_path")"
  packages="$(extract_workflow_packages "$workflow_abs")"
  OLDIFS="$IFS"
  IFS=','
  for raw_pkg in $packages; do
    pkg="$(trim "$raw_pkg")"
    [ -n "$pkg" ] || continue
    repo_name="${pkg%%/*}"
    if ! repo_is_supported "$repo_name"; then
      continue
    fi
    pkg_rel="${pkg#"$repo_name"/}"
    append_unique_line "$pkg_rel" "$tmp_dir/$repo_name.prefixes"
    append_unique_line "$workflow_name" "$tmp_dir/$repo_name.workflows"
  done
  IFS="$OLDIFS"
done < "$STATE_FILE"

echo "repo	status	branch	pr_url	reason" > "$REPORT_FILE"

for repo in "${REPOS[@]}"; do
  if ! repo_exists "$repo"; then
    report_line "$repo" "skipped" "" "" "repo_missing"
    continue
  fi

  if [ ! -s "$tmp_dir/$repo.prefixes" ]; then
    report_line "$repo" "skipped" "" "" "no_completed_workflows_touch_repo"
    continue
  fi

  if ! command -v gh >/dev/null 2>&1 && [ "$DRY_RUN" = false ]; then
    report_line "$repo" "skipped" "" "" "gh_not_installed"
    continue
  fi

  load_repo_meta "$repo"
  if [ "$IGNORE_BASELINE" = false ] && [ -n "$REPO_START_BRANCH" ] && [ "$REPO_START_BRANCH" != "$REPO_DEFAULT_BRANCH" ]; then
    report_line "$repo" "skipped" "" "" "started_on_non_default_branch:$REPO_START_BRANCH"
    continue
  fi

  collect_repo_changes "$repo" "$tmp_dir/$repo.current"
  : > "$tmp_dir/$repo.candidates"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if ignore_path "$repo" "$path"; then
      continue
    fi
    if ! matches_allowed_prefix "$path" "$tmp_dir/$repo.prefixes"; then
      continue
    fi
    if [ "$IGNORE_BASELINE" = false ] && [ -f "$BASELINE_DIR/$repo.paths" ] && grep -Fqx "$path" "$BASELINE_DIR/$repo.paths" 2>/dev/null; then
      continue
    fi
    append_unique_line "$path" "$tmp_dir/$repo.candidates"
  done < "$tmp_dir/$repo.current"

  if [ ! -s "$tmp_dir/$repo.candidates" ]; then
    report_line "$repo" "skipped" "" "" "no_new_changes_after_filtering"
    continue
  fi

  if [ "$DRY_RUN" = true ]; then
    branch="campaign/schema-adapter-migration/${repo}-$(date +%Y%m%d-%H%M%S)"
    echo
    echo "=== $repo ==="
    echo "branch: $branch"
    echo "workflows:"
    sed 's/^/- /' "$tmp_dir/$repo.workflows"
    echo "paths:"
    sed 's/^/- /' "$tmp_dir/$repo.candidates"
    report_line "$repo" "dry-run" "$branch" "" "would_open_pr"
    continue
  fi

  if ! git -C "$CAMPAIGN_ROOT/$repo" diff --cached --quiet; then
    report_line "$repo" "skipped" "" "" "repo_has_preexisting_staged_changes"
    continue
  fi

  branch="campaign/schema-adapter-migration/${repo}-$(date +%Y%m%d-%H%M%S)"
  git -C "$CAMPAIGN_ROOT/$repo" switch -c "$branch"

  add_paths=()
  delete_paths=()
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -e "$CAMPAIGN_ROOT/$repo/$path" ]; then
      add_paths+=("$path")
    else
      delete_paths+=("$path")
    fi
  done < "$tmp_dir/$repo.candidates"

  if [ "${#add_paths[@]}" -gt 0 ]; then
    git -C "$CAMPAIGN_ROOT/$repo" add -- "${add_paths[@]}"
  fi
  if [ "${#delete_paths[@]}" -gt 0 ]; then
    git -C "$CAMPAIGN_ROOT/$repo" add -u -- "${delete_paths[@]}"
  fi

  if git -C "$CAMPAIGN_ROOT/$repo" diff --cached --quiet; then
    report_line "$repo" "skipped" "$branch" "" "nothing_staged_after_filtering"
    continue
  fi

  workflow_summary="$(sed 's/^/- /' "$tmp_dir/$repo.workflows")"
  commit_title="schema-adapter-migration: apply completed campaign results"
  commit_body="Completed workflows touching this repo:
$workflow_summary"
  git -C "$CAMPAIGN_ROOT/$repo" commit -m "$commit_title" -m "$commit_body"

  git -C "$CAMPAIGN_ROOT/$repo" push -u origin "$branch"

  repo_slug="$(remote_slug_for_repo "$repo")"
  if [ -z "$repo_slug" ]; then
    report_line "$repo" "skipped" "$branch" "" "unable_to_detect_origin_slug"
    continue
  fi

  pr_title="schema-adapter-migration: completed campaign results for $repo"
  pr_body="## Summary
- auto-opened after the schema-adapter migration campaign completed
- repo-scoped to paths declared by completed workflows' Packages headers

## Completed workflows touching this repo
$workflow_summary

## Changed paths
$(sed 's/^/- `/' "$tmp_dir/$repo.candidates" | sed 's/$/`/')
"

  pr_url="$(gh pr create \
    --repo "$repo_slug" \
    --base "$REPO_DEFAULT_BRANCH" \
    --head "$branch" \
    --title "$pr_title" \
    --body "$pr_body" \
    --draft)"

  report_line "$repo" "opened" "$branch" "$pr_url" ""
done

echo
echo "Campaign PR finalization report:"
cat "$REPORT_FILE"
