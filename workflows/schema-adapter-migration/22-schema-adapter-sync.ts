/**
 * Workflow 22: Implement SchemaAdapter.sync as a generic paginator.
 *
 * Phase:        1  Foundation
 * Depends on:   20, 21
 * Parallel with: none
 * Packages:     relayfile-adapters/packages/core,
 *               relayfile-adapters/workflows/schema-adapter-migration
 *
 * Adds the Phase 1 `SchemaAdapter.sync(resourceName, options)` foundation in
 * adapter-core, driven by the declarative sync and pagination metadata landed
 * in workflow 21. The workflow edits `schema-adapter.ts`, adds one focused
 * runtime test under `packages/core/tests/`, validates the adapter-core build,
 * runs the targeted sync test, and gates the bundle with a reviewer verdict
 * file. It reads `relayfile/packages/sdk/typescript` as read-only context and
 * writes no files in the SDK repo.
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/22-schema-adapter-sync.ts
 */

import { CodexModels } from '@agent-relay/config';
import { workflow } from '@agent-relay/sdk/workflows';

const SCHEMA_ADAPTER_SRC =
  'relayfile-adapters/packages/core/src/runtime/schema-adapter.ts';
const MAPPING_TYPES_SRC = 'relayfile-adapters/packages/core/src/spec/types.ts';
const SDK_INTEGRATION_ADAPTER =
  'relayfile/packages/sdk/typescript/src/integration-adapter.ts';
const EXISTING_RUNTIME_TEST =
  'relayfile-adapters/packages/core/tests/runtime/schema-adapter.test.ts';
const SCHEMA_ADAPTER_SYNC_TEST =
  'relayfile-adapters/packages/core/tests/runtime/schema-adapter.sync.test.ts';
const REVIEW_FILE =
  'relayfile-adapters/workflows/schema-adapter-migration/REVIEW_22.md';
const TEST_OUTPUT_LOG =
  'relayfile-adapters/workflows/schema-adapter-migration/TEST_OUTPUT_22.log';

const STANDARD_DENY = [
  '.env',
  '.env.*',
  '**/*.secret',
  '**/node_modules/**',
];

const diffGate = (subrepo: string, repoRelativePath: string): string =>
  `! git -C ${subrepo} diff --quiet -- ${repoRelativePath}`;

const modifiedOrUntrackedGate = (
  subrepo: string,
  repoRelativePath: string,
): string =>
  `if git -C ${subrepo} diff --quiet -- ${repoRelativePath}; then ` +
  `git -C ${subrepo} ls-files --others --exclude-standard -- ${repoRelativePath} | grep -q .; ` +
  'else true; fi';

async function main() {
  const result = await workflow('22-schema-adapter-sync')
    .description(
      'Implement SchemaAdapter.sync in adapter-core, add a focused paginator test, and gate the bundle with deterministic build, test, and review steps.',
    )
    .pattern('dag')
    .channel('wf-22-schema-adapter-sync')
    .maxConcurrency(5)
    .timeout(3_600_000)

    .agent('codex-impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      permissions: {
        access: 'restricted',
        exec: [],
        files: {
          read: [
            SCHEMA_ADAPTER_SRC,
            MAPPING_TYPES_SRC,
            SDK_INTEGRATION_ADAPTER,
            EXISTING_RUNTIME_TEST,
          ],
          write: [SCHEMA_ADAPTER_SRC],
          deny: STANDARD_DENY,
        },
      },
    })

    .agent('codex-test', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      permissions: {
        access: 'restricted',
        exec: [],
        files: {
          read: [
            SCHEMA_ADAPTER_SRC,
            MAPPING_TYPES_SRC,
            SDK_INTEGRATION_ADAPTER,
            EXISTING_RUNTIME_TEST,
          ],
          write: [SCHEMA_ADAPTER_SYNC_TEST],
          deny: STANDARD_DENY,
        },
      },
    })

    .agent('codex-reviewer', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      permissions: {
        access: 'readonly',
        exec: [],
        files: {
          read: [],
          write: [REVIEW_FILE],
          deny: [
            ...STANDARD_DENY,
            SCHEMA_ADAPTER_SRC,
            SCHEMA_ADAPTER_SYNC_TEST,
            TEST_OUTPUT_LOG,
          ],
        },
      },
    })

    .step('read-mapping-spec-types', {
      type: 'deterministic',
      command: `cat ${MAPPING_TYPES_SRC}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-sdk-integration-adapter', {
      type: 'deterministic',
      command: `cat ${SDK_INTEGRATION_ADAPTER}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-existing-runtime-test', {
      type: 'deterministic',
      command: `cat ${EXISTING_RUNTIME_TEST}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-schema-adapter-for-edit', {
      type: 'deterministic',
      command: `cat ${SCHEMA_ADAPTER_SRC}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-existing-sync-test', {
      type: 'deterministic',
      command: `if [ -f ${SCHEMA_ADAPTER_SYNC_TEST} ]; then cat ${SCHEMA_ADAPTER_SYNC_TEST}; else printf '__MISSING__'; fi`,
      captureOutput: true,
      failOnError: true,
    })

    .step('edit-schema-adapter', {
      agent: 'codex-impl',
      dependsOn: [
        'read-schema-adapter-for-edit',
        'read-mapping-spec-types',
        'read-sdk-integration-adapter',
        'read-existing-runtime-test',
        'read-review-file',
      ],
      task: `Update only ${SCHEMA_ADAPTER_SRC}. Inputs are pre-injected below.
Current schema-adapter.ts:
{{steps.read-schema-adapter-for-edit.output}}
MappingSpec types:
{{steps.read-mapping-spec-types.output}}
SDK integration-adapter.ts:
{{steps.read-sdk-integration-adapter.output}}
Existing runtime test style:
{{steps.read-existing-runtime-test.output}}
Current review file:
{{steps.read-review-file.output}}

Implement SchemaAdapter.sync(resourceName, options): use SyncOptions/SyncResult, resolve spec sync metadata, paginate provider.proxy(), compute path/semantics, write via client.writeFile, persist checkpoints at .sync-state/<adapterName>/<resourceName>.json, and support resume, maxPages, since/watermark, and AbortSignal.
If the review is blocked, address its concrete findings without weakening already-passing behavior.
Do not regress the link-header fix: a repeated rel="next" target must be detected before stale page records are written or checkpointed.
Keep self-contained; minimize unrelated edits.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-schema-adapter', {
      type: 'deterministic',
      dependsOn: ['edit-schema-adapter'],
      command: diffGate(
        'relayfile-adapters',
        'packages/core/src/runtime/schema-adapter.ts',
      ),
      failOnError: true,
    })

    .step('read-schema-adapter-final', {
      type: 'deterministic',
      dependsOn: ['verify-schema-adapter'],
      command: `cat ${SCHEMA_ADAPTER_SRC}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('write-schema-adapter-sync-test', {
      agent: 'codex-test',
      dependsOn: [
        'read-schema-adapter-final',
        'read-mapping-spec-types',
        'read-sdk-integration-adapter',
        'read-existing-runtime-test',
        'read-existing-sync-test',
        'read-review-file',
      ],
      task: `Create exactly one file: ${SCHEMA_ADAPTER_SYNC_TEST}.
Implemented schema-adapter.ts:
{{steps.read-schema-adapter-final.output}}
MappingSpec types:
{{steps.read-mapping-spec-types.output}}
SDK integration-adapter.ts:
{{steps.read-sdk-integration-adapter.output}}
Existing runtime test style:
{{steps.read-existing-runtime-test.output}}
Current schema-adapter.sync.test.ts, if present:
{{steps.read-existing-sync-test.output}}
Current review file:
{{steps.read-review-file.output}}

Add focused node:test coverage for multi-page provider.proxy(), workspace writes via client.writeFile, checkpoint write/resume, deterministic maxPages stop, and AbortSignal stopping before a later checkpoint.
If the review is blocked, preserve or add coverage for each concrete blocked finding.
The repeated link-header test must assert the repeated target page is not written and no second checkpoint is created.
Use inline deterministic fixtures only. Do NOT edit any other file.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'file_exists', value: SCHEMA_ADAPTER_SYNC_TEST },
    })

    .step('verify-schema-adapter-sync-test', {
      type: 'deterministic',
      dependsOn: ['write-schema-adapter-sync-test'],
      command: modifiedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/tests/runtime/schema-adapter.sync.test.ts',
      ),
      failOnError: true,
    })

    .step('read-schema-adapter-sync-test', {
      type: 'deterministic',
      dependsOn: ['verify-schema-adapter-sync-test'],
      command: `cat ${SCHEMA_ADAPTER_SYNC_TEST}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('build-adapter-core', {
      type: 'deterministic',
      dependsOn: ['verify-schema-adapter', 'verify-schema-adapter-sync-test'],
      command: '(cd relayfile-adapters/packages/core && npm run build)',
      failOnError: true,
    })

    .step('test-schema-adapter-sync', {
      type: 'deterministic',
      dependsOn: ['build-adapter-core'],
      command:
        `bash -o pipefail -c '(cd relayfile-adapters/packages/core && node --test dist/tests/runtime/schema-adapter.sync.test.js) | tee ${TEST_OUTPUT_LOG}'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('verify-sync-test-log', {
      type: 'deterministic',
      dependsOn: ['test-schema-adapter-sync'],
      command: `test -s ${TEST_OUTPUT_LOG}`,
      failOnError: true,
    })

    .step('regression-build-adapters', {
      type: 'deterministic',
      dependsOn: ['verify-sync-test-log'],
      command:
        '(cd relayfile-adapters/packages/github && npm run build)' +
        ' && (cd relayfile-adapters/packages/gitlab && npm run build)' +
        ' && (cd relayfile-adapters/packages/linear && npm run build)' +
        ' && (cd relayfile-adapters/packages/notion && npm run build)' +
        ' && (cd relayfile-adapters/packages/slack && npm run build)' +
        ' && (cd relayfile-adapters/packages/teams && npm run build)',
      failOnError: true,
    })

    .step('verify-sync-test-output', {
      type: 'deterministic',
      dependsOn: ['regression-build-adapters'],
      command: `test -s ${TEST_OUTPUT_LOG}`,
      failOnError: true,
    })

    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: [
        'verify-schema-adapter',
        'verify-schema-adapter-sync-test',
        'verify-sync-test-output',
      ],
      command:
        `printf '=== schema-adapter.ts ===\\n' && cat ${SCHEMA_ADAPTER_SRC}` +
        ` && printf '\\n=== schema-adapter.sync.test.ts ===\\n' && cat ${SCHEMA_ADAPTER_SYNC_TEST}` +
        ` && printf '\\n=== sync test output ===\\n' && cat ${TEST_OUTPUT_LOG}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-review-file', {
      type: 'deterministic',
      command: `if [ -f ${REVIEW_FILE} ]; then cat ${REVIEW_FILE}; else printf '__MISSING__'; fi`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-schema-adapter-sync', {
      agent: 'codex-reviewer',
      dependsOn: ['bundle-review-context', 'read-review-file'],
      task: `Review workflow 22's implementation bundle.

Bundle:
{{steps.bundle-review-context.output}}

Current review file:
{{steps.read-review-file.output}}

Write ${REVIEW_FILE} first. The first line must be exactly approved or start with blocked:.

Check only for:
- pagination edge cases or unbounded loop risk
- checkpoint ordering bugs and resume correctness
- AbortSignal behavior
- missing test coverage for the required scenarios

Do NOT run npm, git, node, tsc, tsx, or agent-relay.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'file_exists', value: REVIEW_FILE },
    })

    .step('verify-review-file', {
      type: 'deterministic',
      dependsOn: ['review-schema-adapter-sync'],
      command: modifiedOrUntrackedGate(
        'relayfile-adapters',
        'workflows/schema-adapter-migration/REVIEW_22.md',
      ),
      failOnError: true,
    })

    .step('gate-review-verdict', {
      type: 'deterministic',
      dependsOn: ['verify-review-file'],
      command:
        `test -s ${REVIEW_FILE} && printf '%s' "$(sed -n '1p' ${REVIEW_FILE})" | grep -q '^approved$'`,
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
