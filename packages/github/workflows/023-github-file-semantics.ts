/**
 * 023-github-file-semantics.ts
 *
 * FileSemantics mapping - properties and relations for GitHub entities.
 * Maps GitHub data to relayfile FileSemantics (properties, relations).
 *
 * Run: agent-relay run workflows/023-github-file-semantics.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-file-semantics')
  .description('Map GitHub entities to relayfile FileSemantics (properties, relations)')
  .pattern('dag')
  .channel('wf-relayfile-github-file-semantics')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans semantics mapping' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements semantics mappers' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews semantics implementation' })

  .step('plan-semantics', {
    agent: 'architect',
    task: `Read ${SPEC} and the SDK FileSemantics type at ${SDK_REPO}/packages/relayfile-sdk/src/.

Plan FileSemantics mapping for GitHub entities:
- PR meta.json: properties (title, state, author, labels, branch), relations (repo, commits, reviews, checks)
- Commit JSON: properties (sha, message, author, date), relations (pr, parent commits, files)
- Review JSON: properties (state, body, author), relations (pr, comments)
- Issue meta.json: properties (title, state, author, labels), relations (repo, comments)
- File entries: properties (path, status, additions, deletions), relations (pr, commit)

Define property mapper and relation mapper modules.
Keep output under 50 lines. End with PLAN_SEMANTICS_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_SEMANTICS_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-property-mapper', {
    agent: 'builder',
    dependsOn: ['plan-semantics'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/semantics/property-mapper.ts.

Based on: {{steps.plan-semantics.output}}

Export function mapPRProperties(pr): FileSemantics['properties']
- Map: title, state, author.login, base_branch, head_branch, labels[], created_at, updated_at, mergeable

Export function mapCommitProperties(commit): FileSemantics['properties']
- Map: sha, message, author.login, author.email, date, additions, deletions

Export function mapReviewProperties(review): FileSemantics['properties']
- Map: state (APPROVED/CHANGES_REQUESTED/COMMENTED), author.login, body, submitted_at

Export function mapIssueProperties(issue): FileSemantics['properties']
- Map: title, state, author.login, labels[], created_at, assignees[]

Export function mapFileProperties(file): FileSemantics['properties']
- Map: path, status, additions, deletions, patch_available`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-relation-mapper', {
    agent: 'builder',
    dependsOn: ['write-property-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/semantics/relation-mapper.ts.

Export function mapPRRelations(owner, repo, number): FileSemantics['relations']
- repo → /github/repos/{owner}/{repo}/
- commits → /github/repos/{owner}/{repo}/pulls/{number}/commits/
- reviews → /github/repos/{owner}/{repo}/pulls/{number}/reviews/
- checks → /github/repos/{owner}/{repo}/pulls/{number}/checks/

Export function mapCommitRelations(owner, repo, prNumber, sha, parents): FileSemantics['relations']
- pr → pulls/{number}/meta.json
- parents → commits/{parentSha}.json for each parent

Export function mapReviewRelations(owner, repo, prNumber, reviewId): FileSemantics['relations']
- pr → pulls/{number}/meta.json
- comments → reviews/{reviewId}/comments/

Export function mapIssueRelations(owner, repo, number): FileSemantics['relations']
- repo → /github/repos/{owner}/{repo}/
- comments → issues/{number}/comments/`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-relation-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/semantics/__tests__/semantics.test.ts.

Tests using vitest:
- mapPRProperties extracts all required fields
- mapPRProperties handles missing optional fields
- mapCommitProperties formats author correctly
- mapReviewProperties maps state enum
- mapIssueProperties handles multiple labels
- mapPRRelations builds correct VFS paths
- mapCommitRelations links to parent commits
- mapReviewRelations links to PR and comments
- All relations use absolute VFS paths

Use fixture data matching GitHub API response shapes.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/semantics/property-mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/semantics/relation-mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/semantics/__tests__/semantics.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review semantics at ${GITHUB_ADAPTER_REPO}/src/semantics/:
- property-mapper.ts, relation-mapper.ts, __tests__/semantics.test.ts

Verify:
- All entity types have property mappers
- Relations use correct VFS paths from spec
- FileSemantics type compatibility
- No missing required properties
- Tests cover all entity types

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('File semantics:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
