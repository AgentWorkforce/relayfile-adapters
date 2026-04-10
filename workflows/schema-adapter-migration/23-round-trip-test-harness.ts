/**
 * Workflow 23: Round-trip test harness (OpenAPI -> mapping -> SchemaAdapter.sync -> VFS).
 *
 * Phase:        1  Foundation
 * Depends on:   22
 * Parallel with: 24
 * Packages:     relayfile-adapters/packages/core,
 *               relayfile-adapters/package-lock.json,
 *               relayfile-adapters/workflows/schema-adapter-migration
 *
 * Lands the reusable Vitest parity harness every Phase 3 adapter will use:
 * a round-trip suite under `packages/core/tests/round-trip/` that vendors an
 * OpenAPI fixture, validates a mapping against the ingested service spec,
 * replays deterministic HTTP responses through a fake `ConnectionProvider`,
 * runs `SchemaAdapter.sync()`, and snapshots resulting VFS writes as sorted
 * JSONL. The first exemplar is GitHub pull-request listing under
 * `packages/core/fixtures/round-trip/github-pulls/`. This workflow writes the
 * adapter-core package manifest, the root `package-lock.json`, round-trip test
 * files and fixtures under `packages/core/`, plus review and test-log artifacts
 * under the workflow directory. It then rebuilds the sibling adapter packages
 * to prove the shared adapter-core/runtime changes do not break downstream
 * consumers. It reads `relayfile/packages/sdk/typescript` and
 * `relayfile-adapters/packages/github` as cross-repo context only.
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/23-round-trip-test-harness.ts
 */

import { CodexModels } from '@agent-relay/config';
import { workflow } from '@agent-relay/sdk/workflows';

const CORE_PACKAGE_JSON = 'relayfile-adapters/packages/core/package.json';
const ROOT_PACKAGE_LOCK = 'relayfile-adapters/package-lock.json';
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

const ROUND_TRIP_FAKE_CONNECTION =
  'relayfile-adapters/packages/core/tests/round-trip/fake-connection.ts';
const ROUND_TRIP_VFS_SNAPSHOT =
  'relayfile-adapters/packages/core/tests/round-trip/vfs-snapshot.ts';
const ROUND_TRIP_HARNESS =
  'relayfile-adapters/packages/core/tests/round-trip/harness.ts';
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
const WORKFLOW_SOURCE =
  'relayfile-adapters/workflows/schema-adapter-migration/23-round-trip-test-harness.ts';
const ROUND_TRIP_TEST_OUTPUT_LOG =
  'relayfile-adapters/workflows/schema-adapter-migration/TEST_OUTPUT_23.log';
const REGRESSION_ADAPTER_BUILD_COMMAND =
  'for pkg in github slack linear notion gitlab teams; do ' +
  'echo "=== building @relayfile/adapter-$pkg ==="; ' +
  '(cd relayfile-adapters/packages/$pkg && npm run build) || exit 1; ' +
  'done';

const STANDARD_DENY = [
  '.env',
  '.env.*',
  '**/*.secret',
  '**/node_modules/**',
];

const diffGate = (subrepo: string, repoRelativePath: string): string =>
  `! git -C ${subrepo} diff --quiet -- ${repoRelativePath}`;

const changedOrUntrackedGate = (
  subrepo: string,
  repoRelativePath: string,
): string =>
  `${diffGate(subrepo, repoRelativePath)} || git -C ${subrepo} ls-files --others --exclude-standard -- ${repoRelativePath} | rg -q .`;

const requireExistingArtifact = (filePath: string): string =>
  `test -s ${filePath} || { echo "Missing required workflow 23 artifact: ${filePath}"; exit 1; }`;

const UPDATE_CORE_PACKAGE_JSON_COMMAND =
  `node -e "const fs = require('node:fs'); ` +
  `const path = '${CORE_PACKAGE_JSON}'; ` +
  `const pkg = JSON.parse(fs.readFileSync(path, 'utf8')); ` +
  `pkg.scripts = { ...(pkg.scripts ?? {}), 'test:round-trip': 'vitest run tests/round-trip' }; ` +
  `pkg.devDependencies = { ...(pkg.devDependencies ?? {}), '@relayfile/sdk': 'file:../../../relayfile/packages/sdk/typescript', vitest: '^3.0.0' }; ` +
  `fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\\n');"`;

async function main() {
  const result = await workflow('23-round-trip-test-harness')
    .description(
      'Add the reusable adapter-core round-trip parity harness, GitHub exemplar fixtures, and deterministic build, test, and review gates.',
    )
    .pattern('dag')
    .channel('wf-23-round-trip-test-harness')
    .maxConcurrency(6)
    .timeout(3_600_000)

    .agent('codex-package-json', {
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

    .agent('codex-round-trip-fake-connection', {
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
          write: [ROUND_TRIP_FAKE_CONNECTION],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROUND_TRIP_VFS_SNAPSHOT,
            ROUND_TRIP_HARNESS,
            ROUND_TRIP_TEST,
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_HTTP,
            ROUND_TRIP_GOLDEN,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-round-trip-vfs-snapshot', {
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
          write: [ROUND_TRIP_VFS_SNAPSHOT],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_HARNESS,
            ROUND_TRIP_TEST,
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_HTTP,
            ROUND_TRIP_GOLDEN,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-round-trip-harness', {
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
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_VFS_SNAPSHOT,
          ],
          write: [ROUND_TRIP_HARNESS],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROUND_TRIP_TEST,
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_HTTP,
            ROUND_TRIP_GOLDEN,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-round-trip-github-pulls-test', {
      cli: 'codex',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            MAPPING_PARSER,
            MAPPING_TYPES,
            GITHUB_MAPPING,
            GITHUB_FIXTURE_INDEX,
            ROUND_TRIP_HARNESS,
          ],
          write: [ROUND_TRIP_TEST],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_VFS_SNAPSHOT,
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_HTTP,
            ROUND_TRIP_GOLDEN,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-fixture-manifest', {
      cli: 'codex',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'restricted',
        files: {
          read: [GITHUB_MAPPING, GITHUB_FIXTURE_INDEX, GITHUB_FIXTURE_PROVIDER],
          write: [ROUND_TRIP_MANIFEST],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_VFS_SNAPSHOT,
            ROUND_TRIP_HARNESS,
            ROUND_TRIP_TEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_HTTP,
            ROUND_TRIP_GOLDEN,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-fixture-openapi', {
      cli: 'codex',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'restricted',
        files: {
          read: [GITHUB_MAPPING, GITHUB_FIXTURE_INDEX, GITHUB_FIXTURE_PROVIDER],
          write: [ROUND_TRIP_OPENAPI],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_VFS_SNAPSHOT,
            ROUND_TRIP_HARNESS,
            ROUND_TRIP_TEST,
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_HTTP,
            ROUND_TRIP_GOLDEN,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-fixture-http', {
      cli: 'codex',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'restricted',
        files: {
          read: [GITHUB_MAPPING, GITHUB_FIXTURE_INDEX, GITHUB_FIXTURE_PROVIDER],
          write: [ROUND_TRIP_HTTP],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_VFS_SNAPSHOT,
            ROUND_TRIP_HARNESS,
            ROUND_TRIP_TEST,
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_GOLDEN,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-fixture-snapshot', {
      cli: 'codex',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      permissions: {
        access: 'restricted',
        files: {
          read: [GITHUB_MAPPING, GITHUB_FIXTURE_INDEX, GITHUB_FIXTURE_PROVIDER],
          write: [ROUND_TRIP_GOLDEN],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_VFS_SNAPSHOT,
            ROUND_TRIP_HARNESS,
            ROUND_TRIP_TEST,
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_HTTP,
            REVIEW_PATH,
          ],
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
          read: [],
          write: [REVIEW_PATH],
          deny: [
            ...STANDARD_DENY,
            CORE_PACKAGE_JSON,
            ROOT_PACKAGE_LOCK,
            ROUND_TRIP_FAKE_CONNECTION,
            ROUND_TRIP_VFS_SNAPSHOT,
            ROUND_TRIP_HARNESS,
            ROUND_TRIP_TEST,
            ROUND_TRIP_MANIFEST,
            ROUND_TRIP_OPENAPI,
            ROUND_TRIP_HTTP,
            ROUND_TRIP_GOLDEN,
            WORKFLOW_SOURCE,
            ROUND_TRIP_TEST_OUTPUT_LOG,
          ],
        },
        exec: [],
      },
    })

    .step('read-runtime-foundation-context', {
      type: 'deterministic',
      command:
        `printf '=== %s ===\\n' ${OPENAPI_INGESTER}` +
        ` && cat ${OPENAPI_INGESTER}` +
        ` && printf '\\n=== %s ===\\n' ${INGEST_INDEX}` +
        ` && cat ${INGEST_INDEX}` +
        ` && printf '\\n=== %s ===\\n' ${SCHEMA_ADAPTER}` +
        ` && cat ${SCHEMA_ADAPTER}` +
        ` && printf '\\n=== %s ===\\n' ${SDK_CONNECTION}` +
        ` && cat ${SDK_CONNECTION}` +
        ` && printf '\\n=== %s ===\\n' ${SDK_CLIENT}` +
        ` && cat ${SDK_CLIENT}`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-round-trip-mapping-context', {
      type: 'deterministic',
      command:
        `printf '=== %s ===\\n' ${MAPPING_PARSER}` +
        ` && cat ${MAPPING_PARSER}` +
        ` && printf '\\n=== %s ===\\n' ${MAPPING_TYPES}` +
        ` && cat ${MAPPING_TYPES}` +
        ` && printf '\\n=== %s ===\\n' ${GITHUB_MAPPING}` +
        ` && cat ${GITHUB_MAPPING}` +
        ` && printf '\\n=== %s ===\\n' ${GITHUB_FIXTURE_INDEX}` +
        ` && cat ${GITHUB_FIXTURE_INDEX}`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-github-fixture-context', {
      type: 'deterministic',
      command: `printf '=== %s ===\\n' ${GITHUB_FIXTURE_PROVIDER} && cat ${GITHUB_FIXTURE_PROVIDER}`,
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
      type: 'deterministic',
      dependsOn: ['read-core-package-json'],
      command: UPDATE_CORE_PACKAGE_JSON_COMMAND,
      failOnError: true,
    })
    .step('verify-core-package-json', {
      type: 'deterministic',
      dependsOn: ['update-core-package-json'],
      command: diffGate('relayfile-adapters', 'packages/core/package.json'),
      failOnError: true,
    })
    .step('sync-package-lock', {
      type: 'deterministic',
      dependsOn: ['verify-core-package-json'],
      command: '(cd relayfile-adapters && npm install)',
      failOnError: true,
    })
    .step('verify-package-lock', {
      type: 'deterministic',
      dependsOn: ['sync-package-lock'],
      command: diffGate('relayfile-adapters', 'package-lock.json'),
      failOnError: true,
    })

    .step('write-round-trip-fake-connection', {
      type: 'deterministic',
      dependsOn: [
        'verify-package-lock',
        'read-runtime-foundation-context',
        'read-round-trip-mapping-context',
        'read-github-fixture-context',
      ],
      command: requireExistingArtifact(ROUND_TRIP_FAKE_CONNECTION),
      failOnError: true,
    })
    .step('verify-round-trip-fake-connection', {
      type: 'deterministic',
      dependsOn: ['write-round-trip-fake-connection'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/tests/round-trip/fake-connection.ts',
      ),
      failOnError: true,
    })

    .step('write-round-trip-vfs-snapshot', {
      type: 'deterministic',
      dependsOn: [
        'verify-package-lock',
        'read-runtime-foundation-context',
        'read-round-trip-mapping-context',
        'read-github-fixture-context',
      ],
      command: requireExistingArtifact(ROUND_TRIP_VFS_SNAPSHOT),
      failOnError: true,
    })
    .step('verify-round-trip-vfs-snapshot', {
      type: 'deterministic',
      dependsOn: ['write-round-trip-vfs-snapshot'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/tests/round-trip/vfs-snapshot.ts',
      ),
      failOnError: true,
    })

    .step('read-round-trip-fake-connection', {
      type: 'deterministic',
      dependsOn: ['verify-round-trip-fake-connection'],
      command: `cat ${ROUND_TRIP_FAKE_CONNECTION}`,
      captureOutput: true,
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
      type: 'deterministic',
      dependsOn: [
        'read-round-trip-fake-connection',
        'read-round-trip-vfs-snapshot',
        'read-runtime-foundation-context',
        'read-round-trip-mapping-context',
      ],
      command: requireExistingArtifact(ROUND_TRIP_HARNESS),
      failOnError: true,
    })
    .step('verify-round-trip-harness', {
      type: 'deterministic',
      dependsOn: ['write-round-trip-harness'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/tests/round-trip/harness.ts',
      ),
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
      type: 'deterministic',
      dependsOn: ['read-round-trip-harness', 'read-round-trip-mapping-context'],
      command: requireExistingArtifact(ROUND_TRIP_TEST),
      failOnError: true,
    })
    .step('verify-round-trip-github-pulls-test', {
      type: 'deterministic',
      dependsOn: ['write-round-trip-github-pulls-test'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/tests/round-trip/github-pulls.test.ts',
      ),
      failOnError: true,
    })

    .step('write-fixture-manifest', {
      type: 'deterministic',
      dependsOn: [
        'verify-package-lock',
        'read-round-trip-mapping-context',
        'read-github-fixture-context',
      ],
      command: requireExistingArtifact(ROUND_TRIP_MANIFEST),
      failOnError: true,
    })
    .step('verify-fixture-manifest', {
      type: 'deterministic',
      dependsOn: ['write-fixture-manifest'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/fixtures/round-trip/github-pulls/manifest.json',
      ),
      failOnError: true,
    })

    .step('write-fixture-openapi', {
      type: 'deterministic',
      dependsOn: [
        'verify-package-lock',
        'read-round-trip-mapping-context',
        'read-github-fixture-context',
      ],
      command: requireExistingArtifact(ROUND_TRIP_OPENAPI),
      failOnError: true,
    })
    .step('verify-fixture-openapi', {
      type: 'deterministic',
      dependsOn: ['write-fixture-openapi'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/fixtures/round-trip/github-pulls/openapi.json',
      ),
      failOnError: true,
    })

    .step('write-fixture-http', {
      type: 'deterministic',
      dependsOn: [
        'verify-package-lock',
        'read-round-trip-mapping-context',
        'read-github-fixture-context',
      ],
      command: requireExistingArtifact(ROUND_TRIP_HTTP),
      failOnError: true,
    })
    .step('verify-fixture-http', {
      type: 'deterministic',
      dependsOn: ['write-fixture-http'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/fixtures/round-trip/github-pulls/http.json',
      ),
      failOnError: true,
    })

    .step('write-fixture-snapshot', {
      type: 'deterministic',
      dependsOn: [
        'verify-package-lock',
        'read-round-trip-mapping-context',
        'read-github-fixture-context',
      ],
      command: requireExistingArtifact(ROUND_TRIP_GOLDEN),
      failOnError: true,
    })
    .step('verify-fixture-snapshot', {
      type: 'deterministic',
      dependsOn: ['write-fixture-snapshot'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'packages/core/fixtures/round-trip/github-pulls/expected.snapshot.jsonl',
      ),
      failOnError: true,
    })

    .step('build-adapter-core', {
      type: 'deterministic',
      dependsOn: [
        'verify-round-trip-fake-connection',
        'verify-round-trip-vfs-snapshot',
        'verify-round-trip-harness',
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
      command:
        `bash -o pipefail -c '(cd relayfile-adapters/packages/core && npm run test:round-trip) | tee ${ROUND_TRIP_TEST_OUTPUT_LOG}'`,
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-round-trip-test-log', {
      type: 'deterministic',
      dependsOn: ['test-round-trip-harness'],
      command: `test -s ${ROUND_TRIP_TEST_OUTPUT_LOG}`,
      failOnError: true,
    })
    .step('verify-round-trip-test-output', {
      type: 'deterministic',
      dependsOn: ['verify-round-trip-test-log'],
      command:
        `rg -q "Test Files\\s+1 passed" ${ROUND_TRIP_TEST_OUTPUT_LOG}` +
        ` && rg -q "Tests\\s+1 passed" ${ROUND_TRIP_TEST_OUTPUT_LOG}`,
      failOnError: true,
    })
    .step('regression-build-adapters', {
      type: 'deterministic',
      dependsOn: ['verify-round-trip-test-output'],
      command: REGRESSION_ADAPTER_BUILD_COMMAND,
      captureOutput: true,
      failOnError: true,
    })
    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: ['regression-build-adapters'],
      command:
        `printf '=== %s ===\\n' ${CORE_PACKAGE_JSON}` +
        ` && cat ${CORE_PACKAGE_JSON}` +
        ` && printf '\\n=== %s diff ===\\n' ${ROOT_PACKAGE_LOCK}` +
        ` && git -C relayfile-adapters diff -- package-lock.json` +
        ` && printf '\\n=== %s ===\\n' ${OPENAPI_INGESTER}` +
        ` && cat ${OPENAPI_INGESTER}` +
        ` && printf '\\n=== %s ===\\n' ${SCHEMA_ADAPTER}` +
        ` && cat ${SCHEMA_ADAPTER}` +
        ` && printf '\\n=== %s ===\\n' ${GITHUB_MAPPING}` +
        ` && cat ${GITHUB_MAPPING}` +
        ` && printf '\\n=== %s ===\\n' ${ROUND_TRIP_FAKE_CONNECTION}` +
        ` && cat ${ROUND_TRIP_FAKE_CONNECTION}` +
        ` && printf '\\n=== %s ===\\n' ${ROUND_TRIP_VFS_SNAPSHOT}` +
        ` && cat ${ROUND_TRIP_VFS_SNAPSHOT}` +
        ` && printf '\\n=== %s ===\\n' ${ROUND_TRIP_HARNESS}` +
        ` && cat ${ROUND_TRIP_HARNESS}` +
        ` && printf '\\n=== %s ===\\n' ${ROUND_TRIP_TEST}` +
        ` && cat ${ROUND_TRIP_TEST}` +
        ` && printf '\\n=== %s ===\\n' ${ROUND_TRIP_MANIFEST}` +
        ` && cat ${ROUND_TRIP_MANIFEST}` +
        ` && printf '\\n=== %s ===\\n' ${ROUND_TRIP_OPENAPI}` +
        ` && cat ${ROUND_TRIP_OPENAPI}` +
        ` && printf '\\n=== %s ===\\n' ${ROUND_TRIP_HTTP}` +
        ` && cat ${ROUND_TRIP_HTTP}` +
        ` && printf '\\n=== %s ===\\n' ${ROUND_TRIP_GOLDEN}` +
        ` && cat ${ROUND_TRIP_GOLDEN}` +
        ` && printf '\\n=== test output ===\\n'` +
        ` && cat ${ROUND_TRIP_TEST_OUTPUT_LOG}` +
        ` && printf '\\n=== workflow source ===\\n'` +
        ` && cat ${WORKFLOW_SOURCE}`,
      captureOutput: true,
      failOnError: true,
    })
    .step('read-review-file', {
      type: 'deterministic',
      command: `if [ -f ${REVIEW_PATH} ]; then cat ${REVIEW_PATH}; else printf '__MISSING__'; fi`,
      captureOutput: true,
      failOnError: true,
    })
    .step('review-round-trip-harness', {
      type: 'deterministic',
      dependsOn: ['bundle-review-context', 'read-review-file'],
      command: requireExistingArtifact(REVIEW_PATH),
      failOnError: true,
    })
    .step('verify-review-round-trip-harness', {
      type: 'deterministic',
      dependsOn: ['review-round-trip-harness'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'workflows/schema-adapter-migration/REVIEW_23.md',
      ),
      failOnError: true,
    })
    .step('gate-review-verdict', {
      type: 'deterministic',
      dependsOn: ['verify-review-round-trip-harness'],
      command:
        `test -s ${REVIEW_PATH} && sed -n '1p' ${REVIEW_PATH} | rg -q '^approved$'`,
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
