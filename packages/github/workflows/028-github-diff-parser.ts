/**
 * 028-github-diff-parser.ts
 *
 * Parse unified diffs to per-file patches.
 * Tokenizes raw unified diff output and builds structured patch objects.
 *
 * Run: agent-relay run workflows/028-github-diff-parser.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const GITHUB_ADAPTER_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';
const SDK_REPO = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const NANGO_REPO = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-provider-nango';
const SPEC = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github/docs/adapter-spec.md';

async function main() {
const result = await workflow('github-diff-parser')
  .description('Parse unified diffs into per-file structured patches')
  .pattern('dag')
  .channel('wf-relayfile-github-diff-parser')
  .maxConcurrency(4)
  .timeout(3_600_000)

  .agent('architect', { cli: 'claude', role: 'Plans diff parsing strategy' })
  .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements diff parser' })
  .agent('reviewer', { cli: 'claude', role: 'Reviews diff parser implementation' })

  .step('plan-parser', {
    agent: 'architect',
    task: `Read ${SPEC} and ${GITHUB_ADAPTER_REPO}/src/pr/diff-writer.ts.

Plan the unified diff parser:
- Input: raw unified diff string (from GitHub diff endpoint)
- Tokenize into diff headers, hunks, and lines
- Split into per-file patches
- Each patch: { oldPath, newPath, status, hunks[] }
- Each hunk: { oldStart, oldLines, newStart, newLines, lines[] }
- Each line: { type: 'add'|'remove'|'context', content, oldLineNo?, newLineNo? }
- Handle binary file markers
- Handle renamed files (similarity index)
- Handle new/deleted file modes

Define tokenizer and patch builder modules.
Keep output under 50 lines. End with PLAN_PARSER_COMPLETE.`,
    verification: { type: 'output_contains', value: 'PLAN_PARSER_COMPLETE' },
    timeout: 120_000,
  })

  .step('write-diff-tokenizer', {
    agent: 'builder',
    dependsOn: ['plan-parser'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/diff/tokenizer.ts.

Based on: {{steps.plan-parser.output}}

Export interface DiffToken { type, value, line }
Export type TokenType = 'diff_header' | 'old_file' | 'new_file' | 'hunk_header' | 'add' | 'remove' | 'context' | 'binary' | 'rename' | 'mode'

Export function tokenize(rawDiff: string): DiffToken[]
- Split on newlines
- Identify lines starting with 'diff --git' as diff_header
- '---' as old_file, '+++' as new_file
- '@@' as hunk_header (parse line numbers)
- '+' as add, '-' as remove, ' ' as context
- 'Binary files' as binary
- 'similarity index' as rename
- 'new file mode' / 'deleted file mode' as mode

Export function parseHunkHeader(line: string): { oldStart, oldLines, newStart, newLines }
- Parse @@ -oldStart,oldLines +newStart,newLines @@`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-patch-builder', {
    agent: 'builder',
    dependsOn: ['write-diff-tokenizer'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/diff/patch-builder.ts.

Export interface FilePatch { oldPath, newPath, status, isBinary, hunks: Hunk[] }
Export interface Hunk { oldStart, oldLines, newStart, newLines, lines: DiffLine[] }
Export interface DiffLine { type, content, oldLineNo?, newLineNo? }

Export function buildPatches(tokens: DiffToken[]): FilePatch[]
- Group tokens by diff_header boundaries
- For each file: extract paths, determine status (added/deleted/modified/renamed)
- Build hunks from hunk_header groups
- Assign line numbers to each DiffLine

Export function parseDiff(rawDiff: string): FilePatch[]
- Convenience: tokenize then buildPatches

Export function getPatchForFile(patches: FilePatch[], path: string): FilePatch | null
- Find patch by oldPath or newPath`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('write-tests', {
    agent: 'builder',
    dependsOn: ['write-patch-builder'],
    task: `Write ${GITHUB_ADAPTER_REPO}/src/diff/__tests__/diff-parser.test.ts.

Tests using vitest with sample unified diffs:
- tokenize identifies all token types
- parseHunkHeader extracts line numbers correctly
- buildPatches splits multi-file diff into patches
- buildPatches handles added file (new file mode)
- buildPatches handles deleted file (deleted file mode)
- buildPatches handles renamed file (similarity index)
- buildPatches handles binary file
- DiffLine has correct line numbers
- parseDiff end-to-end with real-ish diff
- getPatchForFile finds by path

Include inline diff fixtures in the test file.`,
    verification: { type: 'exit_code' },
    timeout: 180_000,
  })

  .step('verify-artifacts', {
    type: 'deterministic',
    dependsOn: ['write-tests'],
    command: `test -f ${GITHUB_ADAPTER_REPO}/src/diff/tokenizer.ts && test -f ${GITHUB_ADAPTER_REPO}/src/diff/patch-builder.ts && test -f ${GITHUB_ADAPTER_REPO}/src/diff/__tests__/diff-parser.test.ts`,
    captureOutput: true,
    failOnError: true,
  })

  .step('review', {
    agent: 'reviewer',
    dependsOn: ['verify-artifacts'],
    task: `Review diff parser at ${GITHUB_ADAPTER_REPO}/src/diff/:
- tokenizer.ts, patch-builder.ts, __tests__/diff-parser.test.ts

Verify:
- Tokenizer handles all unified diff line types
- Hunk header parsing is correct
- Line numbering tracks old and new independently
- Binary and rename cases handled
- Status detection (added/deleted/modified/renamed) is correct
- Tests use realistic diff samples

Keep output under 50 lines. End with REVIEW_COMPLETE.`,
    verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
    timeout: 120_000,
  })

  .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

console.log('Diff parser:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
