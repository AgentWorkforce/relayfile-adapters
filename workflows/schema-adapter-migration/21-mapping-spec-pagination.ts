/**
 * Workflow 21: Extend MappingSpec with declarative pagination + sync resource config.
 *
 * Phase:        1  Foundation
 * Depends on:   20
 * Parallel with: none
 * Packages:     relayfile-adapters/packages/core,
 *               relayfile-adapters/workflows/schema-adapter-migration
 *
 * Extends `ResourceMapping` so adapter-core can declare sync-ready resources
 * with a `pagination` block for the supported REST strategies (`cursor`,
 * `offset`, `page`, `link-header`, `next-token`) plus a `sync` block that
 * opts a resource into `SchemaAdapter.sync()` and carries the
 * `modelName`/`cursorField`/`checkpointKey` metadata workflow 22 consumes.
 * The workflow updates the MappingSpec types, teaches the parser to accept and
 * reject the new fields correctly, adds focused parser coverage under
 * `packages/core/tests/`, and gates the change with deterministic diff checks,
 * `npm run build`, and `npm test` for `@relayfile/adapter-core`. It also
 * writes `ANALYSIS_21.md` and `REVIEW_21.md` under the migration workflow
 * directory.
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/21-mapping-spec-pagination.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

const WORKFLOW_SLUG = '21-mapping-spec-pagination';
const WORKFLOW_CHANNEL = 'wf-21-mapping-spec-pagination';

const TYPES_FILE = 'relayfile-adapters/packages/core/src/spec/types.ts';
const PARSER_FILE = 'relayfile-adapters/packages/core/src/spec/parser.ts';
const PARSER_TEST_FILE =
  'relayfile-adapters/packages/core/tests/spec/parser.test.ts';
const ANALYSIS_FILE =
  'relayfile-adapters/workflows/schema-adapter-migration/ANALYSIS_21.md';
const REVIEW_FILE =
  'relayfile-adapters/workflows/schema-adapter-migration/REVIEW_21.md';

const STANDARD_DENY = [
  '.env',
  '.env.*',
  '**/*.secret',
  '**/node_modules/**',
];

const modifiedGate = (path: string): string =>
  `! git -C relayfile-adapters diff --quiet -- ${path.replace('relayfile-adapters/', '')}`;

const modifiedOrUntrackedGate = (path: string): string =>
  `if git -C relayfile-adapters diff --quiet -- ${path.replace('relayfile-adapters/', '')}; then ` +
  `git -C relayfile-adapters ls-files --others --exclude-standard -- ${path.replace('relayfile-adapters/', '')} | rg -q .; ` +
  'else true; fi';

async function main() {
  const result = await workflow(WORKFLOW_SLUG)
    .description(
      'Add ResourceMapping pagination and sync metadata, validate the parser surface, and prove adapter-core still builds and tests cleanly.',
    )
    .pattern('dag')
    .channel(WORKFLOW_CHANNEL)
    .maxConcurrency(6)
    .timeout(3_600_000)

    .agent('claude-analyst', {
      cli: 'claude',
      role: 'Writes the workflow 21 implementation brief for types, parser, and tests.',
      preset: 'worker',
      model: ClaudeModels.SONNET,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [TYPES_FILE, PARSER_FILE, PARSER_TEST_FILE],
          write: [ANALYSIS_FILE],
          deny: [...STANDARD_DENY, REVIEW_FILE],
        },
        exec: [],
      },
    })

    .agent('codex-types-author', {
      cli: 'codex',
      role: 'Adds the bounded ResourceMapping pagination and sync type surface.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [TYPES_FILE, ANALYSIS_FILE],
          write: [TYPES_FILE],
          deny: [...STANDARD_DENY, PARSER_FILE, PARSER_TEST_FILE, REVIEW_FILE],
        },
        exec: [],
      },
    })

    .agent('codex-parser-author', {
      cli: 'codex',
      role: 'Extends parser support for pagination and sync configuration.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [PARSER_FILE, ANALYSIS_FILE],
          write: [PARSER_FILE],
          deny: [...STANDARD_DENY, TYPES_FILE, PARSER_TEST_FILE, REVIEW_FILE],
        },
        exec: [],
      },
    })

    .agent('codex-tests-author', {
      cli: 'codex',
      role: 'Adds focused parser tests for pagination and sync parsing.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [PARSER_TEST_FILE, ANALYSIS_FILE],
          write: [PARSER_TEST_FILE],
          deny: [...STANDARD_DENY, TYPES_FILE, PARSER_FILE, REVIEW_FILE],
        },
        exec: [],
      },
    })

    .agent('codex-reviewer', {
      cli: 'codex',
      role: 'Reviews the adapter-core diff for pagination and sync coherence.',
      preset: 'reviewer',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'readonly',
        files: {
          read: [],
          write: [REVIEW_FILE],
          deny: [...STANDARD_DENY, TYPES_FILE, PARSER_FILE, PARSER_TEST_FILE],
        },
        exec: [],
      },
    })

    .step('read-types-file', {
      type: 'deterministic',
      command: `cat ${TYPES_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-parser-file', {
      type: 'deterministic',
      command: `cat ${PARSER_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-parser-test-file', {
      type: 'deterministic',
      command: `cat ${PARSER_TEST_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('analyze-workflow-21-scope', {
      agent: 'claude-analyst',
      dependsOn: ['read-types-file', 'read-parser-file', 'read-parser-test-file'],
      task: `Prepare a concise implementation brief for workflow 21.

types.ts:
{{steps.read-types-file.output}}

parser.ts:
{{steps.read-parser-file.output}}

parser.test.ts:
{{steps.read-parser-test-file.output}}

Write ${ANALYSIS_FILE} with the exact ResourceMapping fields, parser rules for
cursor/offset/page/link-header/next-token, rejection cases for missing or
unsupported pagination config, and the focused parser tests to add.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'file_exists', value: ANALYSIS_FILE },
    })

    .step('read-analysis-file', {
      type: 'deterministic',
      dependsOn: ['analyze-workflow-21-scope'],
      command: `cat ${ANALYSIS_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-types-file-for-edit', {
      type: 'deterministic',
      command: `cat ${TYPES_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('edit-types-file', {
      agent: 'codex-types-author',
      dependsOn: ['read-analysis-file', 'read-types-file-for-edit'],
      task: `Update only ${TYPES_FILE}.

Current file:
{{steps.read-types-file-for-edit.output}}

Implementation brief:
{{steps.read-analysis-file.output}}

Add the minimal ResourceMapping type support for pagination strategies
cursor, offset, page, link-header, and next-token, plus a sync block with
modelName, cursorField, and checkpointKey.
Keep the change type-level only in this file.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-types-file', {
      type: 'deterministic',
      dependsOn: ['edit-types-file'],
      command: modifiedGate(TYPES_FILE),
      failOnError: true,
    })

    .step('read-parser-file-for-edit', {
      type: 'deterministic',
      command: `cat ${PARSER_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('edit-parser-file', {
      agent: 'codex-parser-author',
      dependsOn: ['read-analysis-file', 'read-parser-file-for-edit'],
      task: `Update only ${PARSER_FILE}.

Current file:
{{steps.read-parser-file-for-edit.output}}

Implementation brief:
{{steps.read-analysis-file.output}}

Teach the parser to read ResourceMapping.pagination and ResourceMapping.sync,
accept exactly the five supported pagination strategies, and reject invalid or
underspecified configs including cursor pagination without a cursorPath.
Keep existing parser behavior unchanged outside this feature.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-parser-file', {
      type: 'deterministic',
      dependsOn: ['edit-parser-file'],
      command: modifiedGate(PARSER_FILE),
      failOnError: true,
    })

    .step('read-parser-test-file-for-edit', {
      type: 'deterministic',
      command: `cat ${PARSER_TEST_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('edit-parser-tests', {
      agent: 'codex-tests-author',
      dependsOn: ['read-analysis-file', 'read-parser-test-file-for-edit'],
      task: `Update only ${PARSER_TEST_FILE}.

Current file:
{{steps.read-parser-test-file-for-edit.output}}

Implementation brief:
{{steps.read-analysis-file.output}}

Add focused tests proving parseMappingSpecText accepts pagination and sync
blocks, rejects cursor pagination without cursorPath, and rejects unsupported
pagination strategies.
Stay consistent with the existing node:test style in this file.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-parser-tests', {
      type: 'deterministic',
      dependsOn: ['edit-parser-tests'],
      command: modifiedGate(PARSER_TEST_FILE),
      failOnError: true,
    })

    .step('build-adapter-core', {
      type: 'deterministic',
      dependsOn: ['verify-types-file', 'verify-parser-file', 'verify-parser-tests'],
      command: '(cd relayfile-adapters/packages/core && npm run build)',
      failOnError: true,
    })

    .step('test-adapter-core', {
      type: 'deterministic',
      dependsOn: ['build-adapter-core'],
      command: '(cd relayfile-adapters/packages/core && npm test)',
      failOnError: true,
    })

    .step('regression-build-adapters', {
      type: 'deterministic',
      dependsOn: ['test-adapter-core'],
      command:
        '(cd relayfile-adapters/packages/github && npm run build)' +
        ' && (cd relayfile-adapters/packages/gitlab && npm run build)' +
        ' && (cd relayfile-adapters/packages/linear && npm run build)' +
        ' && (cd relayfile-adapters/packages/notion && npm run build)' +
        ' && (cd relayfile-adapters/packages/slack && npm run build)' +
        ' && (cd relayfile-adapters/packages/teams && npm run build)',
      failOnError: true,
    })

    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: ['regression-build-adapters'],
      command:
        `printf '=== IMPLEMENTATION BRIEF ===\n' && cat ${ANALYSIS_FILE}` +
        ` && printf '\n=== relayfile-adapters diff ===\n'` +
        ` && git -C relayfile-adapters diff -- ${TYPES_FILE.replace('relayfile-adapters/', '')} ${PARSER_FILE.replace('relayfile-adapters/', '')} ${PARSER_TEST_FILE.replace('relayfile-adapters/', '')}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-workflow-21', {
      agent: 'codex-reviewer',
      dependsOn: ['bundle-review-context'],
      task: `Review workflow 21's adapter-core diff.

Review bundle:
{{steps.bundle-review-context.output}}

Write ${REVIEW_FILE} first. The first line must be exactly approved or start with blocked:.
Confirm the diff only adds ResourceMapping pagination and sync support, limits
pagination strategies to cursor/offset/page/link-header/next-token, carries
modelName/cursorField/checkpointKey in sync, rejects cursor pagination without
cursorPath, and adds meaningful parser coverage for the new surface.
Do NOT run npm, git, node, tsc, tsx, or agent-relay.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'file_exists', value: REVIEW_FILE },
    })

    .step('verify-review-file', {
      type: 'deterministic',
      dependsOn: ['review-workflow-21'],
      command: modifiedOrUntrackedGate(REVIEW_FILE),
      failOnError: true,
    })

    .step('gate-review-verdict', {
      type: 'deterministic',
      dependsOn: ['verify-review-file'],
      command: `test -s ${REVIEW_FILE} && head -n 1 ${REVIEW_FILE} | grep -Eq "^approved$"`,
      failOnError: true,
    })

    .onError('fail-fast')
    .run({ cwd: process.cwd() });

  console.log('Result:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
