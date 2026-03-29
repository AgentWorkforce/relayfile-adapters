/**
 * 037-review-comment-threading.ts
 *
 * Threaded review comments with line-level mapping.
 * Maps agent findings to exact diff positions for inline PR comments.
 *
 * Run: agent-relay run workflows/037-review-comment-threading.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('review-comment-threading')
  .description('Threaded review comments with line-level mapping')
  .pattern('dag')
  .channel('wf-relayfile-review-comment-threading')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans comment threading strategy' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements comment threading' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews threading code' })

  .step('plan-threading', {
    agent: 'architect',
    task: `Read ${SPEC} section 6 (filesystem layout) and GitHub PR review comments API docs.

Plan comment threading with line-level mapping:
- Agent findings reference file paths and line numbers in source
- Must map source line numbers to diff positions for GitHub API
- GitHub review comments need: path, line (in diff), side (LEFT/RIGHT)
- Thread builder groups related comments (same file, nearby lines)
- Support reply threading: in_reply_to_id links to existing comments
- Handle multi-line suggestions with start_line and line
- Parse diff.patch to build line-to-position mapping

Define thread-builder and line-mapper modules.
Keep output under 50 lines. End with PLAN_THREADING_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_THREADING_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-thread-builder', {
    agent: 'builder',
    dependsOn: ['plan-threading'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/thread-builder.ts.

Based on: {{steps.plan-threading.output}}

Export interface CommentThread { path: string; comments: ThreadedComment[]; startLine: number; endLine: number }
Export interface ThreadedComment { body: string; line: number; side: 'LEFT'|'RIGHT'; inReplyTo?: number; suggestion?: string }

Export function groupIntoThreads(comments: FormattedComment[]):
- Group comments by file path
- Within each file, cluster nearby lines (within 5 lines) into threads
- Sort threads by line number
- Return CommentThread[]

Export function buildReplyComment(existingCommentId, body):
- Create a ThreadedComment that replies to an existing comment
- Set inReplyTo to existingCommentId
- Return ThreadedComment

Export function buildSuggestion(path, line, originalCode, suggestedCode):
- Format as GitHub suggestion block: \`\`\`suggestion\\n{code}\\n\`\`\`
- Return ThreadedComment with suggestion field

Export function deduplicateComments(newComments, existingComments):
- Compare against existing review comments on PR
- Skip comments that duplicate existing ones (same path, line, similar body)
- Return filtered newComments`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-line-mapper', {
    agent: 'builder',
    dependsOn: ['write-thread-builder'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/line-mapper.ts.

Export interface DiffPosition { path: string; line: number; side: 'LEFT'|'RIGHT'; position: number }
Export interface DiffHunk { path: string; startLineOld: number; startLineNew: number; lines: string[] }

Export function parseDiffToPositionMap(diffPatch: string):
- Parse unified diff format
- Build a map: { [path]: { [lineNumber]: { position, side } } }
- Position is the 1-based offset within the file's diff hunk
- Return Map<string, Map<number, DiffPosition>>

Export function mapLineToPosition(positionMap, path, line, side?):
- Look up the diff position for a source line
- If exact line not in diff, find nearest diff line
- Return DiffPosition or null if line not in diff

Export function getChangedLines(diffPatch: string, path: string):
- Extract all changed line numbers for a given file
- Return { added: number[], removed: number[] }

Export function isLineInDiff(positionMap, path, line):
- Return boolean indicating if line is part of the diff`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-line-mapper'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/review/__tests__/comment-threading.test.ts.

Tests using vitest with sample unified diff fixture:
- groupIntoThreads clusters nearby comments in same file
- groupIntoThreads creates separate threads for distant lines
- buildReplyComment sets inReplyTo correctly
- buildSuggestion formats GitHub suggestion block
- deduplicateComments filters existing duplicates
- parseDiffToPositionMap builds correct position map from diff
- mapLineToPosition returns correct position for changed line
- mapLineToPosition returns null for line not in diff

Use a small unified diff string as fixture data.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/review/thread-builder.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/line-mapper.ts && test -f ${GITHUB_ADAPTER_REPO}/src/review/__tests__/comment-threading.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review comment threading at ${GITHUB_ADAPTER_REPO}/src/review/:
- thread-builder.ts, line-mapper.ts, __tests__/comment-threading.test.ts

Verify:
- Diff position mapping is accurate (unified diff format)
- Comments that aren't in the diff are handled gracefully
- Thread grouping uses reasonable proximity threshold
- Suggestion format matches GitHub's expected format
- Deduplication prevents redundant comments
- Tests use realistic diff fixtures

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Comment threading:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
