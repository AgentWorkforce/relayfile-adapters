/**
 * Workflow 24: @relayfile/provider-nango-unauth package with metadata-based credentials.
 *
 * Phase:        1  Foundation
 * Depends on:   20, 22
 * Parallel with: 23
 * Packages:     relayfile-providers/packages/nango-unauth,
 *               relayfile-providers/package-lock.json,
 *               relayfile-adapters/workflows/schema-adapter-migration
 *
 * Creates a new `@relayfile/provider-nango-unauth` package under
 * `relayfile-providers/packages/nango-unauth/` by mirroring the existing
 * `relayfile-providers/packages/nango/` layout and swapping in a thin
 * `NangoUnauthProvider` subclass. The workflow reads reference inputs from
 * `relayfile-providers/packages/nango/` and `relayfile/packages/sdk/typescript/`,
 * injects credentials from connection metadata on every `proxy()` call,
 * exposes deterministic metadata update helpers, and writes a reviewer verdict
 * to `REVIEW_24.md` under the migration directory.
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/24-nango-unauth-provider.ts
 */

import { CodexModels } from '@agent-relay/config';
import { workflow } from '@agent-relay/sdk/workflows';

const SLUG = '24-nango-unauth-provider';
const CHANNEL = 'wf-24-nango-unauth-provider';

const TARGET_DIR = 'relayfile-providers/packages/nango-unauth';
const TARGET_SRC_DIR = `${TARGET_DIR}/src`;
const TARGET_TEST_DIR = `${TARGET_SRC_DIR}/__tests__`;
const TARGET_PACKAGE_JSON = `${TARGET_DIR}/package.json`;
const TARGET_TSCONFIG = `${TARGET_DIR}/tsconfig.json`;
const TARGET_INDEX = `${TARGET_SRC_DIR}/index.ts`;
const TARGET_PROVIDER = `${TARGET_SRC_DIR}/nango-unauth-provider.ts`;
const TARGET_TEST = `${TARGET_TEST_DIR}/nango-unauth-provider.test.ts`;

const REFERENCE_DIR = 'relayfile-providers/packages/nango';
const REFERENCE_PACKAGE_JSON = `${REFERENCE_DIR}/package.json`;
const REFERENCE_TSCONFIG = `${REFERENCE_DIR}/tsconfig.json`;
const REFERENCE_INDEX = `${REFERENCE_DIR}/src/index.ts`;
const REFERENCE_PROVIDER = `${REFERENCE_DIR}/src/nango-provider.ts`;
const REFERENCE_TYPES = `${REFERENCE_DIR}/src/types.ts`;
const REFERENCE_TEST = `${REFERENCE_DIR}/src/__tests__/nango-provider.test.ts`;

const ROOT_PACKAGE_JSON = 'relayfile-providers/package.json';
const ROOT_PACKAGE_LOCK = 'relayfile-providers/package-lock.json';
const SDK_CONNECTION = 'relayfile/packages/sdk/typescript/src/connection.ts';
const REVIEW_PATH =
  'relayfile-adapters/workflows/schema-adapter-migration/REVIEW_24.md';

const STANDARD_DENY = ['.env', '.env.*', '**/*.secret', '**/node_modules/**'];

const changedOrUntrackedGate = (
  subrepo: string,
  repoRelativePath: string,
): string =>
  `! git -C ${subrepo} diff --quiet -- ${repoRelativePath} || git -C ${subrepo} ls-files --others --exclude-standard -- ${repoRelativePath} | grep -q .`;

const requireExistingArtifact = (filePath: string): string =>
  `test -s ${filePath} || { echo "Missing required workflow 24 artifact: ${filePath}"; exit 1; }`;

const INSTALL_PROVIDER_WORKSPACE_COMMAND = '(cd relayfile-providers && npm install)';

const BUILD_PROVIDER_PACKAGE_COMMAND =
  '(cd relayfile-providers && npm run build --workspace @relayfile/provider-nango && npm run build --workspace @relayfile/provider-nango-unauth)';

async function main() {
  const result = await workflow(SLUG)
    .description(
      'Create the @relayfile/provider-nango-unauth package as a thin metadata-backed subclass of @relayfile/provider-nango.',
    )
    .pattern('dag')
    .channel(CHANNEL)
    .maxConcurrency(5)
    .timeout(3_600_000)

    .agent('codex-package-json', {
      cli: 'codex',
      role: 'Creates the nango-unauth package.json by mirroring the nango package metadata.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [],
          write: [TARGET_PACKAGE_JSON],
          deny: [
            ...STANDARD_DENY,
            TARGET_TSCONFIG,
            TARGET_INDEX,
            TARGET_PROVIDER,
            TARGET_TEST,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-tsconfig', {
      cli: 'codex',
      role: 'Creates the nango-unauth tsconfig by mirroring the nango package config.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [],
          write: [TARGET_TSCONFIG],
          deny: [
            ...STANDARD_DENY,
            TARGET_PACKAGE_JSON,
            TARGET_INDEX,
            TARGET_PROVIDER,
            TARGET_TEST,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-provider', {
      cli: 'codex',
      role: 'Creates only the metadata-backed NangoUnauthProvider implementation.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [],
          write: [TARGET_PROVIDER],
          deny: [
            ...STANDARD_DENY,
            TARGET_PACKAGE_JSON,
            TARGET_TSCONFIG,
            TARGET_INDEX,
            TARGET_TEST,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-index', {
      cli: 'codex',
      role: 'Creates only the nango-unauth package barrel export.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [],
          write: [TARGET_INDEX],
          deny: [
            ...STANDARD_DENY,
            TARGET_PACKAGE_JSON,
            TARGET_TSCONFIG,
            TARGET_PROVIDER,
            TARGET_TEST,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-test', {
      cli: 'codex',
      role: 'Creates only the nango-unauth provider unit test.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [],
          write: [TARGET_TEST],
          deny: [
            ...STANDARD_DENY,
            TARGET_PACKAGE_JSON,
            TARGET_TSCONFIG,
            TARGET_INDEX,
            TARGET_PROVIDER,
            REVIEW_PATH,
          ],
        },
        exec: [],
      },
    })

    .agent('codex-reviewer', {
      cli: 'codex',
      role: 'Reviews the finished nango-unauth package bundle and writes a one-line approval or block verdict.',
      preset: 'reviewer',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'readonly',
        files: {
          read: [],
          write: [REVIEW_PATH],
          deny: [
            ...STANDARD_DENY,
            TARGET_PACKAGE_JSON,
            TARGET_TSCONFIG,
            TARGET_INDEX,
            TARGET_PROVIDER,
            TARGET_TEST,
          ],
        },
        exec: [],
      },
    })

    .step('ensure-target-directories', {
      type: 'deterministic',
      command: `mkdir -p ${TARGET_TEST_DIR}`,
      failOnError: true,
    })

    .step('verify-target-directories', {
      type: 'deterministic',
      dependsOn: ['ensure-target-directories'],
      command: `test -d ${TARGET_DIR} && test -d ${TARGET_SRC_DIR} && test -d ${TARGET_TEST_DIR}`,
      failOnError: true,
    })

    .step('read-package-json-context', {
      type: 'deterministic',
      command: `printf '=== %s ===\\n' ${REFERENCE_PACKAGE_JSON} && cat ${REFERENCE_PACKAGE_JSON} && printf '\\n=== %s ===\\n' ${ROOT_PACKAGE_JSON} && cat ${ROOT_PACKAGE_JSON}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-reference-tsconfig', {
      type: 'deterministic',
      command: `cat ${REFERENCE_TSCONFIG}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-provider-context', {
      type: 'deterministic',
      command: `printf '=== %s ===\\n' ${REFERENCE_PROVIDER} && cat ${REFERENCE_PROVIDER} && printf '\\n=== %s ===\\n' ${REFERENCE_TYPES} && cat ${REFERENCE_TYPES} && printf '\\n=== %s ===\\n' ${SDK_CONNECTION} && cat ${SDK_CONNECTION}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-export-test-context', {
      type: 'deterministic',
      command: `printf '=== %s ===\\n' ${REFERENCE_INDEX} && cat ${REFERENCE_INDEX} && printf '\\n=== %s ===\\n' ${REFERENCE_TEST} && cat ${REFERENCE_TEST}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('create-package-json', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories', 'read-package-json-context'],
      command: requireExistingArtifact(TARGET_PACKAGE_JSON),
      failOnError: true,
    })

    .step('verify-package-json', {
      type: 'deterministic',
      dependsOn: ['create-package-json'],
      command: changedOrUntrackedGate(
        'relayfile-providers',
        'packages/nango-unauth/package.json',
      ),
      failOnError: true,
    })

    .step('sync-provider-lockfile', {
      type: 'deterministic',
      dependsOn: ['verify-package-json'],
      command: INSTALL_PROVIDER_WORKSPACE_COMMAND,
      failOnError: true,
    })

    .step('verify-provider-lockfile', {
      type: 'deterministic',
      dependsOn: ['sync-provider-lockfile'],
      command: changedOrUntrackedGate('relayfile-providers', 'package-lock.json'),
      failOnError: true,
    })

    .step('create-tsconfig', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories', 'read-reference-tsconfig'],
      command: requireExistingArtifact(TARGET_TSCONFIG),
      failOnError: true,
    })

    .step('verify-tsconfig', {
      type: 'deterministic',
      dependsOn: ['create-tsconfig'],
      command: changedOrUntrackedGate(
        'relayfile-providers',
        'packages/nango-unauth/tsconfig.json',
      ),
      failOnError: true,
    })

    .step('create-provider', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories', 'read-provider-context'],
      command: requireExistingArtifact(TARGET_PROVIDER),
      failOnError: true,
    })

    .step('verify-provider', {
      type: 'deterministic',
      dependsOn: ['create-provider'],
      command: changedOrUntrackedGate(
        'relayfile-providers',
        'packages/nango-unauth/src/nango-unauth-provider.ts',
      ),
      failOnError: true,
    })

    .step('read-created-provider', {
      type: 'deterministic',
      dependsOn: ['verify-provider'],
      command: `cat ${TARGET_PROVIDER}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('create-index', {
      type: 'deterministic',
      dependsOn: [
        'verify-target-directories',
        'read-export-test-context',
        'read-created-provider',
      ],
      command: requireExistingArtifact(TARGET_INDEX),
      failOnError: true,
    })

    .step('verify-index', {
      type: 'deterministic',
      dependsOn: ['create-index'],
      command: changedOrUntrackedGate(
        'relayfile-providers',
        'packages/nango-unauth/src/index.ts',
      ),
      failOnError: true,
    })

    .step('create-test', {
      type: 'deterministic',
      dependsOn: [
        'verify-target-directories',
        'read-export-test-context',
        'read-created-provider',
      ],
      command: requireExistingArtifact(TARGET_TEST),
      failOnError: true,
    })

    .step('verify-test', {
      type: 'deterministic',
      dependsOn: ['create-test'],
      command: changedOrUntrackedGate(
        'relayfile-providers',
        'packages/nango-unauth/src/__tests__/nango-unauth-provider.test.ts',
      ),
      failOnError: true,
    })

    .step('verify-package-config', {
      type: 'deterministic',
      dependsOn: ['verify-package-json', 'verify-provider-lockfile', 'verify-tsconfig'],
      command: `test -f ${TARGET_PACKAGE_JSON} && test -f ${ROOT_PACKAGE_LOCK} && test -f ${TARGET_TSCONFIG}`,
      failOnError: true,
    })

    .step('verify-package-implementation', {
      type: 'deterministic',
      dependsOn: ['verify-provider', 'verify-index', 'verify-test'],
      command: `test -f ${TARGET_PROVIDER} && test -f ${TARGET_INDEX} && test -f ${TARGET_TEST}`,
      failOnError: true,
    })

    .step('build-package', {
      type: 'deterministic',
      dependsOn: ['verify-package-config', 'verify-package-implementation'],
      command: BUILD_PROVIDER_PACKAGE_COMMAND,
      failOnError: true,
    })

    .step('test-package', {
      type: 'deterministic',
      dependsOn: ['build-package'],
      command: '(cd relayfile-providers && npm test --workspace @relayfile/provider-nango-unauth)',
      failOnError: true,
    })

    .step('regression-build-providers', {
      type: 'deterministic',
      dependsOn: ['test-package'],
      command: '(cd relayfile-providers/packages/nango && npm run build)',
      failOnError: true,
    })

    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: ['regression-build-providers'],
      command:
        `printf '=== %s ===\\n' ${REFERENCE_PACKAGE_JSON} && cat ${REFERENCE_PACKAGE_JSON}` +
        ` && printf '\\n=== %s ===\\n' ${ROOT_PACKAGE_JSON} && cat ${ROOT_PACKAGE_JSON}` +
        ` && printf '\\n=== %s diff ===\\n' ${ROOT_PACKAGE_LOCK} && git -C relayfile-providers diff -- package-lock.json` +
        ` && printf '\\n=== %s ===\\n' ${REFERENCE_TSCONFIG} && cat ${REFERENCE_TSCONFIG}` +
        ` && printf '\\n=== %s ===\\n' ${REFERENCE_PROVIDER} && cat ${REFERENCE_PROVIDER}` +
        ` && printf '\\n=== %s ===\\n' ${REFERENCE_TYPES} && cat ${REFERENCE_TYPES}` +
        ` && printf '\\n=== %s ===\\n' ${SDK_CONNECTION} && cat ${SDK_CONNECTION}` +
        ` && printf '\\n=== %s ===\\n' ${REFERENCE_INDEX} && cat ${REFERENCE_INDEX}` +
        ` && printf '\\n=== %s ===\\n' ${REFERENCE_TEST} && cat ${REFERENCE_TEST}` +
        ` && printf '\\n=== %s ===\\n' ${TARGET_PACKAGE_JSON} && cat ${TARGET_PACKAGE_JSON}` +
        ` && printf '\\n=== %s ===\\n' ${TARGET_TSCONFIG} && cat ${TARGET_TSCONFIG}` +
        ` && printf '\\n=== %s ===\\n' ${TARGET_INDEX} && cat ${TARGET_INDEX}` +
        ` && printf '\\n=== %s ===\\n' ${TARGET_PROVIDER} && cat ${TARGET_PROVIDER}` +
        ` && printf '\\n=== %s ===\\n' ${TARGET_TEST} && cat ${TARGET_TEST}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-package', {
      type: 'deterministic',
      dependsOn: ['bundle-review-context'],
      command: requireExistingArtifact(REVIEW_PATH),
      failOnError: true,
    })

    .step('verify-review-file', {
      type: 'deterministic',
      dependsOn: ['review-package'],
      command: changedOrUntrackedGate(
        'relayfile-adapters',
        'workflows/schema-adapter-migration/REVIEW_24.md',
      ),
      failOnError: true,
    })

    .step('gate-review-verdict', {
      type: 'deterministic',
      dependsOn: ['verify-review-file'],
      command: `test -s ${REVIEW_PATH} && head -n 1 ${REVIEW_PATH} | grep -Eq '^approved$'`,
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
