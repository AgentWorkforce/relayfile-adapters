/**
 * 031-review-workspace-lifecycle.ts
 *
 * Create workspace on PR open, update on push, archive on close.
 * Manages the full lifecycle of relayfile workspaces tied to PR events.
 *
 * Run: agent-relay run workflows/031-review-workspace-lifecycle.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('review-workspace-lifecycle')
  .description('Create workspace on PR open, update on push, archive on close')
  .pattern('dag')
  .channel('wf-relayfile-review-workspace-lifecycle')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans workspace lifecycle handlers' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements workspace lifecycle' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews workspace lifecycle code' })

  .step('plan-lifecycle', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/types.ts.

Plan workspace lifecycle for PR reviews:
- On pull_request.opened: create workspace, populate with PR data (meta.json, diff.patch, files)
- On pull_request.synchronize: update workspace with new commits and changed files
- On pull_request.closed: archive workspace, mark as read-only, clean up temp data
- Workspace path: /github/repos/{owner}/{repo}/pulls/{number}/**
- Track workspace state: active, updating, archived
- Each handler returns IngestResult

Define create-handler, update-handler, and archive-handler modules.
Keep output under 50 lines. End with PLAN_LIFECYCLE_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_LIFECYCLE_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-create-handler', {
    agent: 'builder',
    dependsOn: ['plan-lifecycle'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/workspace-create.ts.

Based on: {{steps.plan-lifecycle.output}}

Export async function createPRWorkspace(client, provider, workspaceId, event):
- Extract owner, repo, number from event payload
- Write meta.json with PR title, author, base/head refs, created_at
- Fetch diff via provider.proxy() GET /repos/{owner}/{repo}/pulls/{number}
  with Accept: application/vnd.github.diff header
- Write diff.patch to workspace
- Fetch changed files list and write each file's head and base revisions
- Return IngestResult with filesWritten count and paths array

Import types from ${GITHUB_ADAPTER_REPO}/src/types.ts.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-update-handler', {
    agent: 'builder',
    dependsOn: ['write-create-handler'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/workspace-update.ts.

Export async function updatePRWorkspace(client, provider, workspaceId, event):
- Extract owner, repo, number, before/after SHAs from synchronize event
- Fetch new commits between before and after
- Update diff.patch with latest diff
- Fetch only changed files (compare before...after)
- Update head revision files, leave base files unchanged
- Update meta.json with new head SHA and updated_at
- Return IngestResult

Handle incremental updates: only write files that actually changed.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-archive-handler', {
    agent: 'builder',
    dependsOn: ['write-update-handler'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/workspace-archive.ts.

Export async function archivePRWorkspace(client, provider, workspaceId, event):
- Extract owner, repo, number from closed event
- Update meta.json: set state to 'archived', add closed_at, merged flag
- Write final review summary if merge occurred
- Mark workspace as read-only via client API
- Return IngestResult

Export async function isWorkspaceArchived(client, workspaceId, prPath):
- Check meta.json state field
- Return boolean`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-archive-handler'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/__tests__/workspace-lifecycle.test.ts.

Tests using vitest:
- createPRWorkspace writes meta.json with correct PR data
- createPRWorkspace fetches and writes diff.patch
- createPRWorkspace writes head and base file revisions
- updatePRWorkspace only updates changed files
- updatePRWorkspace refreshes diff.patch
- archivePRWorkspace sets state to archived
- archivePRWorkspace marks workspace read-only
- isWorkspaceArchived returns correct boolean

Mock client and provider.proxy() with fixture data.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/review/workspace-create.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/workspace-update.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/workspace-archive.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/__tests__/workspace-lifecycle.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review workspace lifecycle at ${GITHUB_ADAPTER_REPO}/src/review/:
- workspace-create.ts, workspace-update.ts, workspace-archive.ts
- __tests__/workspace-lifecycle.test.ts

Verify:
- Correct GitHub API endpoints for PR data and diffs
- VFS paths follow /github/repos/{owner}/{repo}/pulls/{number}/** layout
- Incremental updates only touch changed files
- Archive handler properly marks workspace read-only
- Tests cover create, update, and archive flows

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Workspace lifecycle:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
