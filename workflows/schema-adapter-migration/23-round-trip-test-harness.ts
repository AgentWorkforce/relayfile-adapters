/**
 * Workflow 23: Round-trip test harness (OpenAPI -> mapping -> SchemaAdapter.sync -> VFS).
 *
 * Phase:        1  Foundation
 * Depends on:   22
 * Parallel with: 24
 * Packages:     relayfile-adapters, relayfile-adapters/packages/core, relayfile-adapters/workflows/schema-adapter-migration
 *
 * Lands the reusable parity harness every Phase 3 adapter will use: a Vitest-only
 * round-trip suite under `packages/core/tests/round-trip/` that ingests a vendored
 * OpenAPI fixture, validates a mapping against that ingested service spec, replays
 * deterministic HTTP responses through a fake `ConnectionProvider`, runs
 * `SchemaAdapter.sync()`, and snapshots resulting VFS writes as sorted JSONL. The
 * first exemplar is GitHub pull-request listing, backed by recorded fixtures under
 * `packages/core/fixtures/round-trip/github-pulls/`.
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/23-round-trip-test-harness.ts
 */

import { CodexModels } from '@agent-relay/config';
import { workflow } from '@agent-relay/sdk/workflows';

const CORE_PACKAGE_JSON = 'relayfile-adapters/packages/core/package.json';
const OPENAPI_INGESTER = 'relayfile-adapters/packages/core/src/ingest/openapi.ts';
const INGEST_INDEX = 'relayfile-adapters/packages/core/src/ingest/index.ts';
const MAPPING_PARSER = 'relayfile-adapters/packages/core/src/spec/parser.ts';
const MAPPING_TYPES = 'relayfile-adapters/packages/core/src/spec/types.ts';
const SCHEMA_ADAPTER = 'relayfile-adapters/packages/core/src/runtime/schema-adapter.ts';
const SDK_CONNECTION = 'relayfile/packages/sdk/typescript/src/connection.ts';
const SDK_CLIENT = 'relayfile/packages/sdk/typescript/src/client.ts';
const GITHUB_MAPPING = 'relayfile-adapters/packages/github/github.mapping.yaml';
const GITHUB_FIXTURE_INDEX =
  'relayfile-adapters/packages/github/src/__tests__/fixtures/index.ts';
const GITHUB_FIXTURE_PROVIDER =
  'relayfile-adapters/packages/github/src/__tests__/fixtures/mock-provider.ts';

const ROUND_TRIP_HARNESS =
  'relayfile-adapters/packages/core/tests/round-trip/harness.ts';
const ROUND_TRIP_FAKE_CONNECTION =
  'relayfile-adapters/packages/core/tests/round-trip/fake-connection.ts';
const ROUND_TRIP_VFS_SNAPSHOT =
  'relayfile-adapters/packages/core/tests/round-trip/vfs-snapshot.ts';
const ROUND_TRIP_TEST =
  'relayfile-adapters/packages/core/tests/round-trip/github-pulls.test.ts';

const ROUND_TRIP_MANIFEST =
  'relayfile-adapters/packages/core/fixtures/round-trip/github-pulls/manifest.json';
const ROUND_TRIP_OPENAPI =
  'relayfile-adapters/packages/core/fixtures/round-trip/github-pulls/openapi.json';
const ROUND_TRIP_HTTP =
  'relayfile-adapters/packages/core/fixtures/round-trip/github-pulls/http.json';
const ROUND_TRIP_GOLDEN =
  'relayfile-adapters/packages/core/fixtures/round-trip/github-pulls/expected.snapshot.jsonl';

const REVIEW_PATH =
  'relayfile-adapters/workflows/schema-adapter-migration/REVIEW_23.md';

const STANDARD_DENY = ['.env', '.env.*', '**/*.secret', '**/node_modules/**'];

const diffGate = (repoRelativePath: string): string =>
  `! git -C relayfile-adapters diff --quiet -- ${repoRelativePath}`;

async function main() {
  const result = await workflow('23-round-trip-test-harness')
    .description(
      'Adds the reusable adapter-core round-trip parity harness, GitHub exemplar fixtures, and deterministic build/test/review gates.',
    )
    .pattern('dag')
    .channel('wf-23-round-trip-test-harness')
    .maxConcurrency(6)
    .timeout(3_600_000)

    .agent('codex-config', {
      cli: 'codex',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'restricted',
        files: {
          read: [CORE_PACKAGE_JSON],
          write: [CORE_PACKAGE_JSON],
          deny: STANDARD_DENY,
        },
        exec: [],
      },
    })

    .agent('codex-round-trip-runtime', {
      cli: 'codex',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            OPENAPI_INGESTER,
            INGEST_INDEX,
            MAPPING_PARSER,
            MAPPING_TYPES,
            SCHEMA_ADAPTER,
            SDK_CONNECTION,
            SDK_CLIENT,
            GITHUB_MAPPING,
            GITHUB_FIXTURE_INDEX,
            GITHUB_FIXTURE_PROVIDER,
          ],
          write: [
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_VFS_SNAPSHOT,
            ROUND_TRIP_HARNESS,
            ROUND_TRIP_TEST,
          ],
          deny: STANDARD_DENY,
        },
        exec: [],
      },
    })

    .agent('codex-round-trip-fixtures', {
      cli: 'codex',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'restricted',
        files: {
          read: [GITHUB_MAPPING, GITHUB_FIXTURE_INDEX, GITHUB_FIXTURE_PROVIDER],
          write: [
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_HTTP,
            ROUND_TRIP_GOLDEN,
          ],
          deny: STANDARD_DENY,
        },
        exec: [],
      },
    })

    .agent('codex-reviewer', {
      cli: 'codex',
      preset: 'reviewer',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'readonly',
        files: {
          read: [REVIEW_PATH],
          write: [REVIEW_PATH],
          deny: STANDARD_DENY,
        },
        exec: [],
      },
    })

    .step('read-runtime-foundation-context', {
      type: 'deterministic',
      command: `printf '=== %s ===\n' ${OPENAPI_INGESTER} && cat ${OPENAPI_INGESTER} && printf '\n=== %s ===\n' ${INGEST_INDEX} && cat ${INGEST_INDEX} && printf '\n=== %s ===\n' ${SCHEMA_ADAPTER} && cat ${SCHEMA_ADAPTER} && printf '\n=== %s ===\n' ${SDK_CONNECTION} && cat ${SDK_CONNECTION} && printf '\n=== %s ===\n' ${SDK_CLIENT} && cat ${SDK_CLIENT}`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-round-trip-mapping-context', {
      type: 'deterministic',
      command: `printf '=== %s ===\n' ${MAPPING_PARSER} && cat ${MAPPING_PARSER} && printf '\n=== %s ===\n' ${MAPPING_TYPES} && cat ${MAPPING_TYPES} && printf '\n=== %s ===\n' ${GITHUB_MAPPING} && cat ${GITHUB_MAPPING} && printf '\n=== %s ===\n' ${GITHUB_FIXTURE_INDEX} && cat ${GITHUB_FIXTURE_INDEX}`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-github-fixture-context', {
      type: 'deterministic',
      command: `printf '=== %s ===\n' ${GITHUB_FIXTURE_PROVIDER} && cat ${GITHUB_FIXTURE_PROVIDER}`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-core-package-json', {
      type: 'deterministic',
      command: `cat ${CORE_PACKAGE_JSON}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('update-core-package-json', {
      agent: 'codex-config',
      dependsOn: ['read-core-package-json'],
      task: `Update only ${CORE_PACKAGE_JSON}.

Current package.json:
{{steps.read-core-package-json.output}}

Add exactly these focused changes:
- devDependencies.vitest with a current stable range
- scripts["test:round-trip"] = "vitest run tests/round-trip/**/*.test.ts"

Do not remove existing scripts or dependencies.
Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'exit_code' },
    })
    .step('verify-core-package-json', {
      type: 'deterministic',
      dependsOn: ['update-core-package-json'],
      command: diffGate('packages/core/package.json'),
      failOnError: true,
    })
    .step('sync-package-lock', {
      type: 'deterministic',
      dependsOn: ['verify-core-package-json'],
      command: '(cd relayfile-adapters && npm install --package-lock-only)',
      failOnError: true,
    })
    .step('verify-package-lock', {
      type: 'deterministic',
      dependsOn: ['sync-package-lock'],
      command: diffGate('package-lock.json'),
      failOnError: true,
    })

    .step('write-round-trip-fake-connection', {
      agent: 'codex-round-trip-runtime',
      dependsOn: [
        'read-runtime-foundation-context',
        'read-round-trip-mapping-context',
        'read-github-fixture-context',
      ],
      task: `Create exactly this file: ${ROUND_TRIP_FAKE_CONNECTION}

Runtime foundation context:
{{steps.read-runtime-foundation-context.output}}

Round-trip mapping context:
{{steps.read-round-trip-mapping-context.output}}

GitHub fixture context:
{{steps.read-github-fixture-context.output}}

Requirements:
- replay recorded HTTP requests deterministically and fail on unexpected calls
- keep the API test-only and minimal

Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'file_exists', value: ROUND_TRIP_FAKE_CONNECTION },
    })
    .step('verify-round-trip-fake-connection', {
      type: 'deterministic',
      dependsOn: ['write-round-trip-fake-connection'],
      command: diffGate('packages/core/tests/round-trip/fake-connection.ts'),
      failOnError: true,
    })
    .step('read-round-trip-fake-connection', {
      type: 'deterministic',
      dependsOn: ['verify-round-trip-fake-connection'],
      command: `cat ${ROUND_TRIP_FAKE_CONNECTION}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('write-round-trip-vfs-snapshot', {
      agent: 'codex-round-trip-runtime',
      dependsOn: [
        'read-runtime-foundation-context',
        'read-round-trip-mapping-context',
        'read-github-fixture-context',
      ],
      task: `Create exactly this file: ${ROUND_TRIP_VFS_SNAPSHOT}

Runtime foundation context:
{{steps.read-runtime-foundation-context.output}}

Round-trip mapping context:
{{steps.read-round-trip-mapping-context.output}}

GitHub fixture context:
{{steps.read-github-fixture-context.output}}

Requirements:
- expose a tiny fake VFS client that records writeFile calls for assertions
- emit sorted JSONL lines with only { path, semantics, recordHash }
- strip runtime-only fields before hashing so snapshots stay stable
- keep the API test-only and minimal

Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'file_exists', value: ROUND_TRIP_VFS_SNAPSHOT },
    })
    .step('verify-round-trip-vfs-snapshot', {
      type: 'deterministic',
      dependsOn: ['write-round-trip-vfs-snapshot'],
      command: diffGate('packages/core/tests/round-trip/vfs-snapshot.ts'),
      failOnError: true,
    })
    .step('read-round-trip-vfs-snapshot', {
      type: 'deterministic',
      dependsOn: ['verify-round-trip-vfs-snapshot'],
      command: `cat ${ROUND_TRIP_VFS_SNAPSHOT}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('write-round-trip-harness', {
      agent: 'codex-round-trip-runtime',
      dependsOn: [
        'read-round-trip-fake-connection',
        'read-round-trip-vfs-snapshot',
        'read-runtime-foundation-context',
        'read-round-trip-mapping-context',
      ],
      task: `Create exactly this file: ${ROUND_TRIP_HARNESS}

Runtime foundation context:
{{steps.read-runtime-foundation-context.output}}

Round-trip mapping context:
{{steps.read-round-trip-mapping-context.output}}

Fake connection helper:
{{steps.read-round-trip-fake-connection.output}}

Fake VFS snapshot helper:
{{steps.read-round-trip-vfs-snapshot.output}}

Build a reusable Vitest harness that ingests the vendored OpenAPI fixture with src/ingest/openapi.ts, loads the mapping YAML, validates it against the ingested service spec for Phase 1, instantiates SchemaAdapter with the fake connection and fake VFS client, runs SchemaAdapter.sync() using the sync key named by the fixture manifest, and compares sorted JSONL output against the golden snapshot file.

Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'file_exists', value: ROUND_TRIP_HARNESS },
    })
    .step('verify-round-trip-harness', {
      type: 'deterministic',
      dependsOn: ['write-round-trip-harness'],
      command: diffGate('packages/core/tests/round-trip/harness.ts'),
      failOnError: true,
    })
    .step('read-round-trip-harness', {
      type: 'deterministic',
      dependsOn: ['verify-round-trip-harness'],
      command: `cat ${ROUND_TRIP_HARNESS}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('write-round-trip-github-pulls-test', {
      agent: 'codex-round-trip-runtime',
      dependsOn: ['read-round-trip-harness', 'read-round-trip-mapping-context'],
      task: `Create exactly this file: ${ROUND_TRIP_TEST}

Round-trip mapping context:
{{steps.read-round-trip-mapping-context.output}}

Harness file:
{{steps.read-round-trip-harness.output}}

Write the GitHub pull-request listing Vitest that uses the reusable harness, covers the exemplar fixture, and includes the phrase "snapshot matches" in the test name.

Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'file_exists', value: ROUND_TRIP_TEST },
    })
    .step('verify-round-trip-github-pulls-test', {
      type: 'deterministic',
      dependsOn: ['write-round-trip-github-pulls-test'],
      command: diffGate('packages/core/tests/round-trip/github-pulls.test.ts'),
      failOnError: true,
    })

    .step('write-fixture-manifest', {
      agent: 'codex-round-trip-fixtures',
      dependsOn: ['read-round-trip-mapping-context', 'read-github-fixture-context'],
      task: `Create exactly this file: ${ROUND_TRIP_MANIFEST}

Round-trip mapping context:
{{steps.read-round-trip-mapping-context.output}}

GitHub fixture context:
{{steps.read-github-fixture-context.output}}

Requirements:
- fixture models GitHub PR listing with deterministic request/response replay
- point at the existing github.mapping.yaml and name the sync resource to run
- reuse the existing GitHub test fixture data shape so the example is realistic

Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'file_exists', value: ROUND_TRIP_MANIFEST },
    })
    .step('verify-fixture-manifest', {
      type: 'deterministic',
      dependsOn: ['write-fixture-manifest'],
      command: diffGate('packages/core/fixtures/round-trip/github-pulls/manifest.json'),
      failOnError: true,
    })

    .step('write-fixture-openapi', {
      agent: 'codex-round-trip-fixtures',
      dependsOn: ['read-round-trip-mapping-context', 'read-github-fixture-context'],
      task: `Create exactly this file: ${ROUND_TRIP_OPENAPI}

Round-trip mapping context:
{{steps.read-round-trip-mapping-context.output}}

GitHub fixture context:
{{steps.read-github-fixture-context.output}}

Requirements:
- fixture models GitHub PR listing with deterministic request/response replay
- vendored JSON, minimal but complete for the exercised endpoint
- reuse the existing GitHub test fixture data shape so the example is realistic

Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'file_exists', value: ROUND_TRIP_OPENAPI },
    })
    .step('verify-fixture-openapi', {
      type: 'deterministic',
      dependsOn: ['write-fixture-openapi'],
      command: diffGate('packages/core/fixtures/round-trip/github-pulls/openapi.json'),
      failOnError: true,
    })

    .step('write-fixture-http', {
      agent: 'codex-round-trip-fixtures',
      dependsOn: ['read-round-trip-mapping-context', 'read-github-fixture-context'],
      task: `Create exactly this file: ${ROUND_TRIP_HTTP}

Round-trip mapping context:
{{steps.read-round-trip-mapping-context.output}}

GitHub fixture context:
{{steps.read-github-fixture-context.output}}

Requirements:
- fixture models GitHub PR listing with deterministic request/response replay
- capture the deterministic request/response replay data the fake connection consumes
- reuse the existing GitHub test fixture data shape so the example is realistic

Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'file_exists', value: ROUND_TRIP_HTTP },
    })
    .step('verify-fixture-http', {
      type: 'deterministic',
      dependsOn: ['write-fixture-http'],
      command: diffGate('packages/core/fixtures/round-trip/github-pulls/http.json'),
      failOnError: true,
    })

    .step('write-fixture-snapshot', {
      agent: 'codex-round-trip-fixtures',
      dependsOn: ['read-round-trip-mapping-context', 'read-github-fixture-context'],
      task: `Create exactly this file: ${ROUND_TRIP_GOLDEN}

Round-trip mapping context:
{{steps.read-round-trip-mapping-context.output}}

GitHub fixture context:
{{steps.read-github-fixture-context.output}}

Requirements:
- fixture models GitHub PR listing with deterministic request/response replay
- sorted JSONL with { path, semantics, recordHash } per line
- reuse the existing GitHub test fixture data shape so the example is realistic

Do NOT run tsc, tsx, agent-relay, npm, git, or node.
Write the file to disk. Do NOT output code to stdout.`,
      verification: { type: 'file_exists', value: ROUND_TRIP_GOLDEN },
    })
    .step('verify-fixture-snapshot', {
      type: 'deterministic',
      dependsOn: ['write-fixture-snapshot'],
      command: diffGate('packages/core/fixtures/round-trip/github-pulls/expected.snapshot.jsonl'),
      failOnError: true,
    })

    .step('build-adapter-core', {
      type: 'deterministic',
      dependsOn: [
        'verify-package-lock',
        'verify-round-trip-github-pulls-test',
        'verify-fixture-manifest',
        'verify-fixture-openapi',
        'verify-fixture-http',
        'verify-fixture-snapshot',
      ],
      command: '(cd relayfile-adapters/packages/core && npm run build)',
      captureOutput: true,
      failOnError: true,
    })
    .step('test-round-trip-harness', {
      type: 'deterministic',
      dependsOn: ['build-adapter-core'],
      command: '(cd relayfile-adapters/packages/core && npm run test:round-trip)',
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-round-trip-test-output', {
      type: 'deterministic',
      dependsOn: ['test-round-trip-harness'],
      command: `printf '%s' "{{steps.test-round-trip-harness.output}}" | grep -q "snapshot matches"`,
      failOnError: true,
    })

    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: ['verify-round-trip-test-output', 'test-round-trip-harness'],
      command: `printf '=== package diff ===\\n' && git -C relayfile-adapters diff -- packages/core/package.json package-lock.json && printf '\\n=== %s ===\\n' ${ROUND_TRIP_FAKE_CONNECTION} && cat ${ROUND_TRIP_FAKE_CONNECTION} && printf '\\n=== %s ===\\n' ${ROUND_TRIP_VFS_SNAPSHOT} && cat ${ROUND_TRIP_VFS_SNAPSHOT} && printf '\\n=== %s ===\\n' ${ROUND_TRIP_HARNESS} && cat ${ROUND_TRIP_HARNESS} && printf '\\n=== %s ===\\n' ${ROUND_TRIP_TEST} && cat ${ROUND_TRIP_TEST} && printf '\\n=== %s ===\\n' ${ROUND_TRIP_MANIFEST} && cat ${ROUND_TRIP_MANIFEST} && printf '\\n=== %s ===\\n' ${ROUND_TRIP_OPENAPI} && cat ${ROUND_TRIP_OPENAPI} && printf '\\n=== %s ===\\n' ${ROUND_TRIP_HTTP} && cat ${ROUND_TRIP_HTTP} && printf '\\n=== %s ===\\n' ${ROUND_TRIP_GOLDEN} && cat ${ROUND_TRIP_GOLDEN} && printf '\\n=== test output ===\\n%s\\n' "{{steps.test-round-trip-harness.output}}"`,
      captureOutput: true,
      failOnError: true,
    })
    .step('review-round-trip-harness', {
      agent: 'codex-reviewer',
      dependsOn: ['bundle-review-context'],
      task: `Review workflow 23's implementation bundle below.

{{steps.bundle-review-context.output}}

Check only for:
- missing immediate verify gates after each file write or create
- package validation not using npm subshell commands
- fixture replay or VFS snapshot format diverging from the parity contract
- GitHub exemplar not actually exercising OpenAPI -> mapping -> SchemaAdapter.sync -> VFS

Write your verdict to ${REVIEW_PATH}.
First line must be exactly "approved" or start with "blocked:".
Do NOT run shell commands. Do NOT output the verdict to stdout.`,
      verification: { type: 'file_exists', value: REVIEW_PATH },
    })
    .step('verify-review-round-trip-harness', {
      type: 'deterministic',
      dependsOn: ['review-round-trip-harness'],
      command: diffGate('workflows/schema-adapter-migration/REVIEW_23.md'),
      failOnError: true,
    })
    .step('gate-review-verdict', {
      type: 'deterministic',
      dependsOn: ['verify-review-round-trip-harness'],
      command: `test -s ${REVIEW_PATH} && head -n 1 ${REVIEW_PATH} | grep -Eq "^approved$"`,
      failOnError: true,
    })
    .run({ cwd: process.cwd() });

  console.log('Result:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
