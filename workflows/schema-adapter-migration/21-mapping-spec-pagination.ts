/**
 * Workflow 21: Extend MappingSpec with declarative pagination + sync resource config.
 *
 * Phase:        1  Foundation
 * Depends on:   20
 * Parallel with: none
 * Packages:     relayfile-adapters/packages/core,
 *               relayfile-adapters/workflows/schema-adapter-migration
 *
 * Extends `ResourceMapping` so adapter-core can describe sync-ready resources
 * declaratively: a `pagination` block for the supported REST pagination
 * strategies (`cursor`, `offset`, `page`, `link-header`, `next-token`) plus a
 * `sync` block that opt-ins a resource to `SchemaAdapter.sync()` and carries
 * the model/checkpoint metadata that workflow 22 will consume. The workflow
 * updates the MappingSpec types, teaches the parser to accept and reject the
 * new fields correctly, adds focused parser tests under `packages/core/tests/`,
 * and gates the change with deterministic diff checks, `npm run build`, and
 * `npm test` for `@relayfile/adapter-core`.
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/21-mapping-spec-pagination.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

const TYPES_FILE = 'relayfile-adapters/packages/core/src/spec/types.ts';
const PARSER_FILE = 'relayfile-adapters/packages/core/src/spec/parser.ts';
const PARSER_TEST_FILE =
  'relayfile-adapters/packages/core/tests/spec/parser.test.ts';
const PACKAGE_JSON = 'relayfile-adapters/packages/core/package.json';
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

const diffGate = (path: string): string => `! git diff --quiet ${path}`;

async function main() {
  const result = await workflow('21-mapping-spec-pagination')
    .description(
      'Add MappingSpec pagination and sync metadata, validate the parser surface, and prove adapter-core still builds and tests cleanly.',
    )
    .pattern('dag')
    .channel('wf-21-mapping-spec-pagination')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('claude-analyst', {
      cli: 'claude',
      role: 'Summarizes the exact type, parser, and parser-test deltas for workflow 21 into a short implementation brief.',
      preset: 'analyst',
      model: ClaudeModels.SONNET,
      retries: 1,
      permissions: {
        access: 'readonly',
        files: {
          read: [TYPES_FILE, PARSER_FILE, PARSER_TEST_FILE, PACKAGE_JSON],
          write: [ANALYSIS_FILE],
          deny: [...STANDARD_DENY, REVIEW_FILE],
        },
        exec: [],
      },
    })

    .agent('codex-types-author', {
      cli: 'codex',
      role: 'Applies the bounded ResourceMapping type changes for workflow 21.',
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
      role: 'Updates parser support for pagination and sync configuration.',
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
      role: 'Adds focused parser coverage for pagination and sync parsing.',
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
      role: 'Reviews the three-file diff and confirms the new pagination and sync shapes are coherent and covered by tests.',
      preset: 'reviewer',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'readonly',
        files: {
          read: [ANALYSIS_FILE],
          write: [REVIEW_FILE],
          deny: STANDARD_DENY,
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

    .step('read-package-json', {
      type: 'deterministic',
      command: `cat ${PACKAGE_JSON}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('analyze-workflow-21-scope', {
      agent: 'claude-analyst',
      dependsOn: [
        'read-types-file',
        'read-parser-file',
        'read-parser-test-file',
        'read-package-json',
      ],
      task: `Prepare a concise implementation brief for workflow 21.

types.ts:
{{steps.read-types-file.output}}

parser.ts:
{{steps.read-parser-file.output}}

parser.test.ts:
{{steps.read-parser-test-file.output}}

package.json:
{{steps.read-package-json.output}}

Write ${ANALYSIS_FILE} with:
1. The exact pagination and sync fields to add to ResourceMapping.
2. Parser rules for accepted strategies and required fields.
3. The focused parser tests to add.

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
      dependsOn: ['read-analysis-file'],
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

Add ResourceMapping support for:
- pagination strategies: cursor, offset, page, link-header, next-token
- pagination config fields needed by workflow 21
- sync config with modelName, cursorField, checkpointKey

Keep the change minimal and type-level only in this file.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-types-file', {
      type: 'deterministic',
      dependsOn: ['edit-types-file'],
      command: diffGate(TYPES_FILE),
      failOnError: true,
    })

    .step('read-parser-file-for-edit', {
      type: 'deterministic',
      dependsOn: ['read-analysis-file'],
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

Teach the parser to read the new ResourceMapping.pagination and
ResourceMapping.sync fields and validate them. The parser must accept the
five supported strategies and reject invalid or underspecified configs,
including cursor pagination without a cursorPath.

Keep existing parser behavior unchanged outside this feature.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-parser-file', {
      type: 'deterministic',
      dependsOn: ['edit-parser-file'],
      command: diffGate(PARSER_FILE),
      failOnError: true,
    })

    .step('read-parser-test-file-for-edit', {
      type: 'deterministic',
      dependsOn: ['read-analysis-file'],
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

Add focused tests that prove:
1. parseMappingSpecText accepts pagination and sync blocks.
2. validation rejects cursor pagination without cursorPath.
3. validation rejects unsupported pagination strategies.

Stay consistent with the existing node:test style in this file.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-parser-tests', {
      type: 'deterministic',
      dependsOn: ['edit-parser-tests'],
      command: diffGate(PARSER_TEST_FILE),
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
      captureOutput: true,
      failOnError: true,
    })

    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: ['test-adapter-core'],
      command:
        `printf '=== IMPLEMENTATION BRIEF ===\n' && cat ${ANALYSIS_FILE}` +
        ` && printf '\n=== relayfile-adapters diff ===\n'` +
        ` && git diff -- ${TYPES_FILE} ${PARSER_FILE} ${PARSER_TEST_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-workflow-21', {
      agent: 'codex-reviewer',
      dependsOn: ['bundle-review-context'],
      task: `Review workflow 21's adapter-core diff.

Review bundle:
{{steps.bundle-review-context.output}}

Confirm:
1. ResourceMapping gained pagination and sync config without unrelated drift.
2. Supported pagination strategies are exactly cursor, offset, page,
   link-header, and next-token.
3. sync carries modelName, cursorField, checkpointKey.
4. Parser validation rejects cursor pagination without cursorPath.
5. Tests cover the new surface meaningfully.

Write your verdict to ${REVIEW_FILE}. The first line must be exactly
"approved" or start with "blocked:".
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'file_exists', value: REVIEW_FILE },
    })

    .step('gate-review-verdict', {
      type: 'deterministic',
      dependsOn: ['review-workflow-21'],
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
