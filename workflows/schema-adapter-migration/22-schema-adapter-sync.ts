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
 * adapter-core, driven by the declarative sync + pagination metadata landed in
 * workflow 21. The workflow keeps scope intentionally narrow: edit
 * `schema-adapter.ts`, add one focused runtime test under `packages/core/tests/`,
 * validate the adapter-core build, run the targeted sync test, and gate the
 * bundle with a reviewer verdict file.
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

const STANDARD_DENY = ['.env', '.env.*', '**/*.secret', '**/node_modules/**'];

const diffGate = (repoRelativePath: string): string =>
  `! git -C relayfile-adapters diff --quiet -- ${repoRelativePath}`;

async function main() {
  const result = await workflow('22-schema-adapter-sync')
    .description(
      'Implement SchemaAdapter.sync in adapter-core, add a focused paginator test, and gate the bundle with deterministic build, test, and review steps.',
    )
    .pattern('dag')
    .channel('wf-22-schema-adapter-sync')
    .maxConcurrency(4)
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
          read: [REVIEW_FILE],
          write: [REVIEW_FILE],
          deny: STANDARD_DENY,
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
      dependsOn: [
        'read-mapping-spec-types',
        'read-sdk-integration-adapter',
        'read-existing-runtime-test',
      ],
      command: `cat ${SCHEMA_ADAPTER_SRC}`,
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
      ],
      task: `Update only ${SCHEMA_ADAPTER_SRC}.

Current schema-adapter.ts:
{{steps.read-schema-adapter-for-edit.output}}

MappingSpec types:
{{steps.read-mapping-spec-types.output}}

SDK integration-adapter.ts:
{{steps.read-sdk-integration-adapter.output}}

Existing runtime test style:
{{steps.read-existing-runtime-test.output}}

Implement Workflow 22 Phase 1:
- add SchemaAdapter.sync(resourceName, options) using SyncOptions / SyncResult
- resolve resourceName through spec sync metadata from workflow 21
- paginate generically over this.provider.proxy()
- compute path + semantics per record, then write via this.client.writeFile
- persist checkpoints at .sync-state/<adapterName>/<resourceName>.json
- support resume, maxPages, since/watermark, and AbortSignal safely

Keep the implementation self-contained and minimize unrelated edits.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-schema-adapter', {
      type: 'deterministic',
      dependsOn: ['edit-schema-adapter'],
      command: diffGate('packages/core/src/runtime/schema-adapter.ts'),
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
      ],
      task: `Create exactly one file: ${SCHEMA_ADAPTER_SYNC_TEST}

Implemented schema-adapter.ts:
{{steps.read-schema-adapter-final.output}}

MappingSpec types:
{{steps.read-mapping-spec-types.output}}

SDK integration-adapter.ts:
{{steps.read-sdk-integration-adapter.output}}

Existing runtime test style:
{{steps.read-existing-runtime-test.output}}

Add focused node:test coverage proving:
- mock provider.proxy() paginates across multiple pages
- records land in a test workspace through client.writeFile
- checkpoint state is written and used on resume
- maxPages stops deterministically
- AbortSignal stops sync before a later checkpoint is written

Use inline deterministic fixtures only. Do NOT edit any other file.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'file_exists', value: SCHEMA_ADAPTER_SYNC_TEST },
    })

    .step('read-schema-adapter-sync-test', {
      type: 'deterministic',
      dependsOn: ['write-schema-adapter-sync-test'],
      command: `cat ${SCHEMA_ADAPTER_SYNC_TEST}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('build-adapter-core', {
      type: 'deterministic',
      dependsOn: ['verify-schema-adapter', 'write-schema-adapter-sync-test'],
      command: '(cd relayfile-adapters/packages/core && npm run build)',
      failOnError: true,
    })

    .step('test-schema-adapter-sync', {
      type: 'deterministic',
      dependsOn: ['build-adapter-core'],
      command:
        '(cd relayfile-adapters/packages/core && node --test dist/tests/runtime/schema-adapter.sync.test.js)',
      captureOutput: true,
      failOnError: true,
    })

    .step('verify-sync-test-output', {
      type: 'deterministic',
      dependsOn: ['test-schema-adapter-sync'],
      command:
        `printf '%s' "{{steps.test-schema-adapter-sync.output}}" | rg -q "checkpoint state"` +
        ` && printf '%s' "{{steps.test-schema-adapter-sync.output}}" | rg -q "test workspace"`,
      failOnError: true,
    })

    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: [
        'read-schema-adapter-final',
        'read-schema-adapter-sync-test',
        'test-schema-adapter-sync',
        'verify-sync-test-output',
      ],
      command:
        `printf '=== schema-adapter.ts ===\\n%s\\n' "{{steps.read-schema-adapter-final.output}}"` +
        ` && printf '\\n=== schema-adapter.sync.test.ts ===\\n%s\\n' "{{steps.read-schema-adapter-sync-test.output}}"` +
        ` && printf '\\n=== sync test output ===\\n%s\\n' "{{steps.test-schema-adapter-sync.output}}"`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-schema-adapter-sync', {
      agent: 'codex-reviewer',
      dependsOn: ['bundle-review-context'],
      task: `Review workflow 22's implementation bundle.

Bundle:
{{steps.bundle-review-context.output}}

Check only for:
- pagination edge cases or unbounded loop risk
- checkpoint ordering bugs and resume correctness
- AbortSignal behavior
- missing test coverage for the required scenarios

Write your verdict to ${REVIEW_FILE}.
The first line must be exactly "approved" or start with "blocked:".
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
IMPORTANT: Write the file to disk. Do NOT output to stdout.`,
      verification: { type: 'file_exists', value: REVIEW_FILE },
    })

    .step('gate-review-verdict', {
      type: 'deterministic',
      dependsOn: ['review-schema-adapter-sync'],
      command: `test -s ${REVIEW_FILE} && head -n 1 ${REVIEW_FILE} | grep -Eq '^approved$'`,
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
