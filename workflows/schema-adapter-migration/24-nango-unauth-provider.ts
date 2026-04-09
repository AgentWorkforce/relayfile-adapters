/**
 * Workflow 24: @relayfile/provider-nango-unauth package with metadata-based credentials.
 *
 * Phase:        1  Foundation
 * Depends on:   20, 22
 * Parallel with: 23
 * Packages:     relayfile-providers/packages/nango-unauth,
 *               relayfile-adapters/workflows/schema-adapter-migration
 *
 * Creates a new `@relayfile/provider-nango-unauth` package under
 * `relayfile-providers/packages/nango-unauth/` by mirroring the existing
 * `relayfile-providers/packages/nango/` layout and swapping in a thin
 * `NangoUnauthProvider` subclass. The provider reads auth headers from Nango
 * connection metadata on each `proxy()` call, exposes deterministic
 * metadata-update helpers, and stays compatible with the `ConnectionProvider`
 * contract that `SchemaAdapter` already consumes.
 *
 * Run from the AgentWorkforce root (cross-repo workflow):
 *   agent-relay run relayfile-adapters/workflows/schema-adapter-migration/24-nango-unauth-provider.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { CodexModels } from '@agent-relay/config';

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
const SDK_CONNECTION = 'relayfile/packages/sdk/typescript/src/connection.ts';

const REVIEW_PATH =
  'relayfile-adapters/workflows/schema-adapter-migration/REVIEW_24.md';

const STANDARD_DENY = ['.env', '.env.*', '**/*.secret', '**/node_modules/**'];

async function main() {
  const result = await workflow('24-nango-unauth-provider')
    .description(
      'Create the @relayfile/provider-nango-unauth package as a thin NangoProvider subclass that injects proxy auth headers from connection metadata.',
    )
    .pattern('dag')
    .channel('wf-24-nango-unauth-provider')
    .maxConcurrency(6)
    .timeout(3_600_000)

    .agent('codex-impl', {
      cli: 'codex',
      role: 'Creates the nango-unauth package one file at a time by mirroring the existing nango package and keeping the implementation metadata-backed only.',
      preset: 'worker',
      model: CodexModels.GPT_5_4,
      retries: 1,
      permissions: {
        access: 'restricted',
        files: {
          read: [
            REFERENCE_PACKAGE_JSON,
            ROOT_PACKAGE_JSON,
            REFERENCE_TSCONFIG,
            REFERENCE_INDEX,
            REFERENCE_PROVIDER,
            REFERENCE_TYPES,
            REFERENCE_TEST,
            SDK_CONNECTION,
          ],
          write: [
            TARGET_PACKAGE_JSON,
            TARGET_TSCONFIG,
            TARGET_INDEX,
            TARGET_PROVIDER,
            TARGET_TEST,
          ],
          deny: STANDARD_DENY,
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
          deny: STANDARD_DENY,
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

    .step('read-reference-package-json', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories'],
      command: `cat ${REFERENCE_PACKAGE_JSON}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-root-package-json', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories'],
      command: `cat ${ROOT_PACKAGE_JSON}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-reference-tsconfig', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories'],
      command: `cat ${REFERENCE_TSCONFIG}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-reference-provider', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories'],
      command: `cat ${REFERENCE_PROVIDER}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-reference-types', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories'],
      command: `cat ${REFERENCE_TYPES}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-sdk-connection', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories'],
      command: `cat ${SDK_CONNECTION}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-reference-index', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories'],
      command: `cat ${REFERENCE_INDEX}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('read-reference-test', {
      type: 'deterministic',
      dependsOn: ['verify-target-directories'],
      command: `cat ${REFERENCE_TEST}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('create-package-json', {
      agent: 'codex-impl',
      dependsOn: ['read-reference-package-json', 'read-root-package-json'],
      task: `Create ${TARGET_PACKAGE_JSON}. Reference nango package.json:
{{steps.read-reference-package-json.output}}

Workspace root package.json:
{{steps.read-root-package-json.output}}

Mirror the existing package structure and scripts. Rename the package to \`@relayfile/provider-nango-unauth\`, update description, keywords, and repository directory for \`packages/nango-unauth\`, and depend on \`@relayfile/provider-nango\` plus \`@relayfile/sdk\`.
Only write this one file.
IMPORTANT: Write the file to disk. Do NOT output to stdout.
Do NOT run npm, git, node, tsc, tsx, or agent-relay.`,
      verification: { type: 'file_exists', value: TARGET_PACKAGE_JSON },
    })

    .step('verify-package-json', {
      type: 'deterministic',
      dependsOn: ['create-package-json'],
      command: `! git diff --quiet ${TARGET_PACKAGE_JSON}`,
      failOnError: true,
    })

    .step('create-tsconfig', {
      agent: 'codex-impl',
      dependsOn: ['read-reference-tsconfig'],
      task: `Create ${TARGET_TSCONFIG}. Reference:
{{steps.read-reference-tsconfig.output}}

Mirror relayfile-providers/packages/nango/tsconfig.json exactly.
Only write this one file.
IMPORTANT: Write the file to disk. Do NOT output to stdout.
Do NOT run npm, git, node, tsc, tsx, or agent-relay.`,
      verification: { type: 'file_exists', value: TARGET_TSCONFIG },
    })

    .step('verify-tsconfig', {
      type: 'deterministic',
      dependsOn: ['create-tsconfig'],
      command: `! git diff --quiet ${TARGET_TSCONFIG}`,
      failOnError: true,
    })

    .step('create-provider', {
      agent: 'codex-impl',
      dependsOn: [
        'read-reference-provider',
        'read-reference-types',
        'read-sdk-connection',
      ],
      task: `Create ${TARGET_PROVIDER}. Reference NangoProvider:
{{steps.read-reference-provider.output}}

Reference Nango types:
{{steps.read-reference-types.output}}

SDK ConnectionProvider contract:
{{steps.read-sdk-connection.output}}

Implement a thin \`NangoUnauthProvider extends NangoProvider\`.
Requirements:
- \`name\` is \`"nango-unauth"\`
- accept the base Nango config plus \`metadataKey?: string\`
- on every \`proxy()\`, read the connection metadata for the request's \`connectionId\`, extract auth headers from \`metadata[metadataKey]\`, merge them into \`request.headers\`, then call \`super.proxy()\`
- expose \`setConnectionCredentials(connectionId, credentials)\` and \`refreshConnectionCredentials(connectionId, refreshFn)\`
- keep the package metadata-only: no OAuth exchange and no plaintext credential logging
Add a small factory and only the local helpers needed. Only write this file.
IMPORTANT: Write the file to disk. Do NOT output to stdout.
Do NOT run npm, git, node, tsc, tsx, or agent-relay.`,
      verification: { type: 'file_exists', value: TARGET_PROVIDER },
    })

    .step('verify-provider', {
      type: 'deterministic',
      dependsOn: ['create-provider'],
      command: `! git diff --quiet ${TARGET_PROVIDER}`,
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
      agent: 'codex-impl',
      dependsOn: ['read-reference-index', 'verify-provider'],
      task: `Create ${TARGET_INDEX}. Reference nango index:
{{steps.read-reference-index.output}}

Export \`NangoUnauthProvider\` and \`createNangoUnauthProvider\` from \`./nango-unauth-provider.js\`. Re-export \`ConnectionProvider\` from \`@relayfile/sdk\` and any public config or types introduced by the provider file.
Keep the barrel minimal and package-focused. Only write this one file.
IMPORTANT: Write the file to disk. Do NOT output to stdout.
Do NOT run npm, git, node, tsc, tsx, or agent-relay.`,
      verification: { type: 'file_exists', value: TARGET_INDEX },
    })

    .step('verify-index', {
      type: 'deterministic',
      dependsOn: ['create-index'],
      command: `! git diff --quiet ${TARGET_INDEX}`,
      failOnError: true,
    })

    .step('create-test', {
      agent: 'codex-impl',
      dependsOn: ['read-reference-test', 'read-created-provider'],
      task: `Create ${TARGET_TEST}. Reference nango provider test:
{{steps.read-reference-test.output}}

Created provider source:
{{steps.read-created-provider.output}}

Write focused node:test coverage for:
- reads credential headers from \`metadataKey\` during \`proxy()\`
- \`setConnectionCredentials()\` updates the metadata payload shape
- \`refreshConnectionCredentials()\` persists refreshed credentials
- errors do not leak plaintext credentials
Use deterministic stubs only. No real network or Nango calls. Only write this file.
IMPORTANT: Write the file to disk. Do NOT output to stdout.
Do NOT run npm, git, node, tsc, tsx, or agent-relay.`,
      verification: { type: 'file_exists', value: TARGET_TEST },
    })

    .step('verify-test', {
      type: 'deterministic',
      dependsOn: ['create-test'],
      command: `! git diff --quiet ${TARGET_TEST}`,
      failOnError: true,
    })

    .step('verify-package-config', {
      type: 'deterministic',
      dependsOn: ['verify-package-json', 'verify-tsconfig'],
      command: 'true',
      failOnError: true,
    })

    .step('verify-package-implementation', {
      type: 'deterministic',
      dependsOn: ['verify-provider', 'verify-index', 'verify-test'],
      command: 'true',
      failOnError: true,
    })

    .step('build-package', {
      type: 'deterministic',
      dependsOn: ['verify-package-config', 'verify-package-implementation'],
      command: '(cd relayfile-providers/packages/nango-unauth && npm run build)',
      failOnError: true,
    })

    .step('test-package', {
      type: 'deterministic',
      dependsOn: ['build-package'],
      command: '(cd relayfile-providers/packages/nango-unauth && npm test)',
      failOnError: true,
    })

    .step('bundle-review-context', {
      type: 'deterministic',
      dependsOn: ['test-package'],
      command: `printf '=== %s ===\\n' ${TARGET_PACKAGE_JSON} && cat ${TARGET_PACKAGE_JSON} && printf '\\n=== %s ===\\n' ${TARGET_TSCONFIG} && cat ${TARGET_TSCONFIG} && printf '\\n=== %s ===\\n' ${TARGET_INDEX} && cat ${TARGET_INDEX} && printf '\\n=== %s ===\\n' ${TARGET_PROVIDER} && cat ${TARGET_PROVIDER} && printf '\\n=== %s ===\\n' ${TARGET_TEST} && cat ${TARGET_TEST}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-package', {
      agent: 'codex-reviewer',
      dependsOn: ['bundle-review-context'],
      task: `Review workflow 24's nango-unauth package bundle:
{{steps.bundle-review-context.output}}

Approve only if:
1. the package mirrors relayfile-providers/packages/nango cleanly
2. the provider is a thin NangoProvider subclass, not a new auth abstraction
3. proxy auth headers come from connection metadata on each call
4. helper methods exist for credential set and refresh without OAuth flow leakage
5. index exports and tests match the new public surface

IMPORTANT: Write the file to disk. Do NOT output to stdout.
Write your verdict to ${REVIEW_PATH}. The first line MUST be exactly \`approved\` or start with \`blocked:\`.`,
      verification: { type: 'file_exists', value: REVIEW_PATH },
    })

    .step('verify-review-file', {
      type: 'deterministic',
      dependsOn: ['review-package'],
      command: `! git diff --quiet ${REVIEW_PATH}`,
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
