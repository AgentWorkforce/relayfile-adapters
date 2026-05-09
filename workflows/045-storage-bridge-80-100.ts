/**
 * 045-storage-bridge-80-100.ts
 *
 * Claude-led, Codex-implemented workflow for storage bridge adapters.
 *
 * This workflow is intentionally review-heavy:
 *   1. Claude leads write the acceptance contract and slice ownership.
 *   2. Codex implementers build disjoint file scopes.
 *   3. Each Codex implementer performs self review.
 *   4. Claude performs peer review.
 *   5. Claude owns the 80-to-100 loop: run real checks, fix or delegate fixes,
 *      re-run, and only finish when deterministic gates pass.
 *
 * Usage:
 *   STORAGE_BRIDGE_WAVE=all      ricky run workflows/045-storage-bridge-80-100.ts
 *   STORAGE_BRIDGE_WAVE=google   ricky run workflows/045-storage-bridge-80-100.ts
 *   STORAGE_BRIDGE_WAVE=database ricky run workflows/045-storage-bridge-80-100.ts
 *   STORAGE_BRIDGE_WAVE=finalize ricky run workflows/045-storage-bridge-80-100.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

type WaveKey = 'all' | 'google' | 'database' | 'finalize';

interface Wave {
  key: WaveKey;
  description: string;
  packages: string[];
  docs: string[];
  nangoTemplateHints: string[];
  coreScope: string;
  providerScope: string;
  testScope: string;
  targetedTestCommand: string;
}

const NANGO_TEMPLATE_ROOT = 'https://github.com/NangoHQ/integration-templates/tree/main/integrations';

const WAVES: Record<Exclude<WaveKey, 'finalize'>, Wave> = {
  all: {
    key: 'all',
    description:
      'All priority storage bridge adapters from the roadmap: Drive, GCS, SharePoint, OneDrive, Azure Blob, Dropbox, Gmail, S3, Box, Postgres, and Redis',
    packages: [
      'packages/google-drive',
      'packages/gcs',
      'packages/sharepoint',
      'packages/onedrive',
      'packages/azure-blob',
      'packages/dropbox',
      'packages/gmail',
      'packages/s3',
      'packages/box',
      'packages/postgres',
      'packages/redis',
      'packages/core',
    ],
    docs: ['../relayfile/docs/storage-bridge-spec.md', '../relayfile/docs/storage-bridge-priority.md'],
    nangoTemplateHints: [
      `${NANGO_TEMPLATE_ROOT}/google-drive`,
      `${NANGO_TEMPLATE_ROOT}/sharepoint-online`,
      `${NANGO_TEMPLATE_ROOT}/microsoft`,
      `${NANGO_TEMPLATE_ROOT}/dropbox`,
      `${NANGO_TEMPLATE_ROOT}/box`,
      `${NANGO_TEMPLATE_ROOT}/gmail`,
      `${NANGO_TEMPLATE_ROOT}/google`,
      `${NANGO_TEMPLATE_ROOT}/s3`,
    ],
    coreScope:
      'packages/core/src/storage-bridge*; packages/core/src/pubsub*; packages/core/src/writeback*; shared event envelope, idempotency, retry, dead-letter, content-fetch, auth/Nango fallback, and writeback contracts for all priority storage bridge adapters',
    providerScope:
      'packages/google-drive/**, packages/gcs/**, packages/sharepoint/**, packages/onedrive/**, packages/azure-blob/**, packages/dropbox/**, packages/gmail/**, packages/s3/**, packages/box/**, packages/postgres/**, and packages/redis/** including webhook/pubsub receivers, subscription managers, bridge runners, delta fetchers, metadata serialization, path mapping, writeback, config validation, and Nango fallback hooks',
    testScope:
      'tests under all priority storage bridge packages plus packages/core/tests/storage-bridge*; mocked Google Pub/Sub, Drive Changes API, GCS notifications, Microsoft Graph subscription/delta, Azure Event Grid, Dropbox webhook/list_folder, Gmail History API, S3 SQS, Box webhook/content fetch, PGlite Postgres, and mocked Redis keyspace tests',
    targetedTestCommand:
      'npm test --workspace=packages/google-drive && npm test --workspace=packages/gcs && npm test --workspace=packages/sharepoint && npm test --workspace=packages/onedrive && npm test --workspace=packages/azure-blob && npm test --workspace=packages/dropbox && npm test --workspace=packages/gmail && npm test --workspace=packages/s3 && npm test --workspace=packages/box && npm test --workspace=packages/postgres && npm test --workspace=packages/redis && npm test --workspace=packages/core -- --runInBand',
  },
  google: {
    key: 'google',
    description: 'Google Drive and GCS real-time storage bridge adapters',
    packages: ['packages/google-drive', 'packages/gcs', 'packages/core'],
    docs: ['../relayfile/docs/storage-bridge-spec.md', '../relayfile/docs/storage-bridge-priority.md'],
    nangoTemplateHints: [
      `${NANGO_TEMPLATE_ROOT}/google-drive`,
      `${NANGO_TEMPLATE_ROOT}/google`,
    ],
    coreScope:
      'packages/core/src/storage-bridge*; packages/core/src/pubsub*; shared event envelope, idempotency, retry, and writeback contracts',
    providerScope:
      'packages/google-drive/** and packages/gcs/** including webhook/pubsub receivers, delta fetchers, path mapping, writeback, and Nango fallback hooks',
    testScope:
      'packages/google-drive/src/__tests__/**; packages/gcs/src/__tests__/**; packages/core/tests/storage-bridge*; mock Google Pub/Sub, Drive Changes API, and GCS notifications',
    targetedTestCommand:
      'npm test --workspace=packages/google-drive && npm test --workspace=packages/gcs && npm test --workspace=packages/core -- --runInBand',
  },
  database: {
    key: 'database',
    description: 'Postgres LISTEN/NOTIFY and Redis keyspace storage bridge adapters',
    packages: ['packages/postgres', 'packages/redis', 'packages/core'],
    docs: ['../relayfile/docs/storage-bridge-spec.md'],
    nangoTemplateHints: [
      `${NANGO_TEMPLATE_ROOT}/postgres`,
      `${NANGO_TEMPLATE_ROOT}/redis`,
    ],
    coreScope:
      'packages/core/src/storage-bridge*; packages/core/src/writeback*; shared event metadata, content fetch, and conflict contracts',
    providerScope:
      'packages/postgres/** and packages/redis/** including bridge runners, metadata serialization, writeback, path mapping, and config validation',
    testScope:
      'packages/postgres/src/__tests__/**; packages/redis/src/__tests__/**; packages/core/tests/storage-bridge*; PGlite Postgres tests and mocked Redis keyspace tests',
    targetedTestCommand:
      'npm test --workspace=packages/postgres && npm test --workspace=packages/redis && npm test --workspace=packages/core -- --runInBand',
  },
};

const WAVE_KEY = (process.env.STORAGE_BRIDGE_WAVE ?? '') as WaveKey;

if (!WAVE_KEY || !['all', 'google', 'database', 'finalize'].includes(WAVE_KEY)) {
  throw new Error(
    'Set STORAGE_BRIDGE_WAVE=all|google|database|finalize.\n' +
      'Example: STORAGE_BRIDGE_WAVE=all ricky run workflows/045-storage-bridge-80-100.ts',
  );
}

const ARTIFACT_DIR = `.workflow-artifacts/storage-bridge-${WAVE_KEY}`;

const OPEN_PR_COMMAND = `branch=$(git branch --show-current)
test -n "$branch"
git add -A
if git diff --cached --quiet; then
  echo "NO_CHANGES_TO_COMMIT"
else
  git commit -m "implement storage bridge adapter wave"
fi
git push -u origin "$branch"
if gh pr view "$branch" >/dev/null 2>&1; then
  gh pr view "$branch" --json url --jq .url
else
  gh pr create --fill --base main --head "$branch"
fi`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function docsList(wave: Wave): string {
  return wave.docs.map((doc) => `  - ${doc}`).join('\n');
}

function nangoTemplateList(wave: Wave): string {
  return wave.nangoTemplateHints.map((url) => `  - ${url}`).join('\n');
}

function packagesList(wave: Wave): string {
  return wave.packages.map((pkg) => `  - ${pkg}`).join('\n');
}

function acceptanceTask(wave: Wave): string {
  return `You are the Claude lead for ${wave.description}.

Read the repository conventions in AGENTS.md, inspect the current adapter patterns under packages/linear and packages/github, and read these source specs:
${docsList(wave)}

Use the NangoHQ integration templates as implementation hints for object structure, sync/action wiring, provider config keys, scopes, and model names. Start from:
${nangoTemplateList(wave)}

If a template URL does not exist, search https://github.com/NangoHQ/integration-templates for the nearest provider slug and record the result in the acceptance contract. Do not invent object structures when Nango has a template, model, sync, or action that can anchor the shape.

Write ${ARTIFACT_DIR}/acceptance-contract.md with:
  - exact user-visible behavior for this wave
  - owned file scopes for each Codex implementer
  - deterministic commands that prove the feature works
  - at least one real end-to-end scenario using mocked provider input
  - Nango template evidence for object schemas, syncs/actions, scopes, and wiring decisions
  - residual risks and explicit non-goals

Also write ${ARTIFACT_DIR}/ownership.json with keys core, providers, tests, peer_review, eighty_to_one_hundred.

Do not implement code in this step. End with ACCEPTANCE_CONTRACT_READY.`;
}

function coreImplementTask(wave: Wave): string {
  return `You are a Codex implementer. You are not alone in the codebase: other agents may edit provider packages and tests in parallel, so keep to your ownership and do not revert others' work.

Wave: ${wave.description}

Owned scope:
${wave.coreScope}

Inputs:
  - ${ARTIFACT_DIR}/acceptance-contract.md
  - ${ARTIFACT_DIR}/ownership.json

Implement the shared storage bridge contracts needed by this wave:
  - typed StorageBridgeEvent envelope and source metadata helpers
  - idempotent ingest/writeback boundaries expected by adapter packages
  - retry/dead-letter abstractions where the package already has a local pattern
  - exports needed by provider packages

Do not edit provider package implementation files except imports required by the shared contract.
Run the most targeted typecheck or test command you can for your scope.
Then write ${ARTIFACT_DIR}/self-review-core.md with what changed, what you verified, and what still worries you.

End with CORE_IMPLEMENTED_AND_SELF_REVIEWED.`;
}

function providerImplementTask(wave: Wave): string {
  return `You are a Codex implementer. You are not alone in the codebase: another implementer owns core contracts and another owns tests, so keep to your provider package scope and do not revert others' work.

Wave: ${wave.description}

Owned scope:
${wave.providerScope}

Inputs:
  - ${ARTIFACT_DIR}/acceptance-contract.md
  - ${ARTIFACT_DIR}/ownership.json
  - Nango template hints:
${nangoTemplateList(wave)}

Implement production-shaped provider adapters, not metadata-only placeholders:
  - package.json, tsconfig, src/index.ts, typed config, path mapper, queries, writeback, webhook/pubsub normalizer, and adapter class
  - real signature/auth validation or explicit mocked-local equivalent where provider docs require cloud setup
  - Nango fallback hook if the acceptance contract marks it in scope
  - object types, field names, provider config keys, scopes, and sync/action wiring grounded in the NangoHQ templates where available
  - writeback metadata that follows AGENTS.md discovery rules

Run the targeted package typecheck/tests that exist or add focused tests where they do not.
Then write ${ARTIFACT_DIR}/self-review-providers.md with what changed, what you verified, and what still worries you.

End with PROVIDERS_IMPLEMENTED_AND_SELF_REVIEWED.`;
}

function testsImplementTask(wave: Wave): string {
  return `You are a Codex implementer. You are not alone in the codebase: keep to tests, mocks, and verification helpers unless a tiny source change is required to make a testable seam explicit.

Wave: ${wave.description}

Owned scope:
${wave.testScope}

Inputs:
  - ${ARTIFACT_DIR}/acceptance-contract.md
  - ${ARTIFACT_DIR}/ownership.json

Create tests that close the 80-to-100 gap:
  - provider webhook/pubsub payload normalization with realistic fixtures
  - Nango sync-complete fallback payloads using model names and object shapes from the NangoHQ templates where available
  - duplicate delivery/idempotency regression
  - content fetch and writeback path mapping
  - at least one end-to-end mocked provider event through relayfile adapter output
  - PGlite for Postgres when this wave touches Postgres; mocked Redis keyspace notifications when this wave touches Redis

Run the targeted test command or the closest subset that exists.
Then write ${ARTIFACT_DIR}/self-review-tests.md with what changed, what you verified, and what still worries you.

End with TESTS_IMPLEMENTED_AND_SELF_REVIEWED.`;
}

function peerReviewTask(wave: Wave): string {
  return `You are the Claude peer-review lead for ${wave.description}.

Review the current diff, the acceptance contract, and all implementer self-reviews:
  - ${ARTIFACT_DIR}/acceptance-contract.md
  - ${ARTIFACT_DIR}/self-review-core.md
  - ${ARTIFACT_DIR}/self-review-providers.md
  - ${ARTIFACT_DIR}/self-review-tests.md

Focus on bugs, missing tests, source/provider contract drift, writeback discovery gaps, idempotency, retry behavior, and anything that would fail in a real local run.

Also check drift against NangoHQ integration templates:
${nangoTemplateList(wave)}

For each available template, verify object field names, model names, sync/action wiring, provider config keys, and scopes are reflected accurately or explicitly adapted with a reason.

Write ${ARTIFACT_DIR}/peer-review.md with:
  - BLOCKER findings that must be fixed before final gates
  - MAJOR findings that should be fixed now
  - MINOR findings that can be deferred
  - exact files and commands for follow-up

If there are no blockers, say PEER_REVIEW_NO_BLOCKERS in the artifact.
End with PEER_REVIEW_COMPLETE.`;
}

function addressReviewTask(wave: Wave): string {
  return `You are a Codex implementer handling Claude peer-review findings for ${wave.description}.

Read ${ARTIFACT_DIR}/peer-review.md. Fix all BLOCKER and MAJOR findings. Keep changes scoped to the files already touched by this workflow unless the review explicitly calls for another file.

After fixes:
  - rerun the most relevant package tests
  - update ${ARTIFACT_DIR}/review-fix-notes.md with each finding and how it was resolved

End with PEER_REVIEW_FINDINGS_FIXED.`;
}

function eightyToHundredTask(wave: Wave): string {
  return `You are the Claude 80-to-100 lead for ${wave.description}. Your job is to move this from "code exists" to "known working".

Inputs:
  - acceptance contract: ${ARTIFACT_DIR}/acceptance-contract.md
  - peer review: ${ARTIFACT_DIR}/peer-review.md
  - Nango template hints:
${nangoTemplateList(wave)}
  - initial typecheck output: {{steps.typecheck-initial.output}}
  - initial test output: {{steps.tests-initial.output}}
  - initial build output: {{steps.build-initial.output}}
  - discovery output: {{steps.discovery-initial.output}}

If all commands passed, do a final source review and write ${ARTIFACT_DIR}/eighty-to-one-hundred.md with evidence.

If anything failed:
  1. Read the failing tests and source.
  2. Fix the issue or make a minimal delegation-style fix yourself.
  3. Re-run the failing command.
  4. Continue until targeted tests, typecheck, build, and discovery checks pass.

The final artifact must include exact commands run, before/after failure evidence, residual risks, and why the original acceptance contract is satisfied.
It must also include a short Nango evidence section naming which templates were used and which object/sync/action shapes they validated.
End with EIGHTY_TO_ONE_HUNDRED_COMPLETE.`;
}

function finalReviewTask(wave: Wave): string {
  return `You are the Claude release lead for ${wave.description}.

Perform a final review after deterministic gates have passed:
  - read ${ARTIFACT_DIR}/acceptance-contract.md
  - read ${ARTIFACT_DIR}/peer-review.md
  - read ${ARTIFACT_DIR}/eighty-to-one-hundred.md
  - inspect git diff

Write ${ARTIFACT_DIR}/final-review.md with:
  - PASS/FAIL verdict
  - evidence commands and results
  - any residual risk
  - a commit-ready summary

End with FINAL_REVIEW_PASS if the workflow is merge-ready, otherwise FINAL_REVIEW_FAIL.`;
}

const editGate = (name: string, paths: string[]): string => {
  const pathArgs = paths.map(shellQuote).join(' ');
  return `if [ -z "$(git status --short -- ${pathArgs})" ]; then echo "NO_${name.toUpperCase()}_CHANGES"; exit 1; fi
echo "${name.toUpperCase()}_EDIT_GATE_OK"`;
};

function editGateRepairTask(wave: Wave): string {
  return `You are a Codex repair implementer. You are not alone in the codebase: preserve existing edits and only add the missing artifacts required by failed edit gates.

Wave: ${wave.description}

Initial edit-gate outputs:

core-edit-gate:
{{steps.core-edit-gate.output}}

providers-edit-gate:
{{steps.providers-edit-gate.output}}

tests-edit-gate:
{{steps.tests-edit-gate.output}}

If every gate already reports *_EDIT_GATE_OK, do nothing.
If a gate reports NO_*_CHANGES:
  - inspect ${ARTIFACT_DIR}/acceptance-contract.md and ${ARTIFACT_DIR}/ownership.json
  - inspect current git status, including untracked files
  - make the smallest missing source/test/artifact edits for that ownership slice
  - do not delete or rewrite work from another implementer
  - write a short note to ${ARTIFACT_DIR}/edit-gate-repair.md with what was repaired

End with EDIT_GATES_REPAIRED.`;
}

const combinedEditGate = (wave: Wave): string =>
  [
    editGate('core', ['packages/core', ARTIFACT_DIR]),
    editGate('providers', wave.packages.filter((pkg) => pkg !== 'packages/core').concat([ARTIFACT_DIR])),
    editGate('tests', wave.packages.concat([ARTIFACT_DIR])),
    'echo EDIT_GATES_FINAL_OK',
  ].join('\n');

async function runFinalize() {
  const result = await workflow('storage-bridge-finalize-80-100')
    .description('Final monorepo gates and Claude release review for storage bridge adapter waves.')
    .pattern('dag')
    .channel('wf-storage-bridge-finalize-80-100')
    .maxConcurrency(2)
    .timeout(3_600_000)
    .agent('release-lead', {
      cli: 'claude',
      role: 'Final Claude release lead for storage bridge adapters',
    })
    .agent('fixer', {
      cli: 'codex',
      preset: 'worker',
      role: 'Codex implementer for final gate fixes',
    })
    .step('preflight', {
      type: 'deterministic',
      command: 'test -f package.json && test -d packages/core && mkdir -p .workflow-artifacts/storage-bridge-finalize && echo PREFLIGHT_OK',
      captureOutput: true,
      failOnError: true,
    })
    .step('typecheck-initial', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: 'npm run typecheck 2>&1 | tail -120',
      captureOutput: true,
      failOnError: false,
    })
    .step('tests-initial', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: 'npm run test 2>&1 | tail -160',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-final-gates', {
      agent: 'fixer',
      dependsOn: ['typecheck-initial', 'tests-initial'],
      task: `Fix final monorepo gate failures.

Typecheck output:
{{steps.typecheck-initial.output}}

Test output:
{{steps.tests-initial.output}}

If all gates already passed, do nothing and say FINAL_GATES_ALREADY_GREEN.
If failures exist, fix them, rerun the failing command, and write .workflow-artifacts/storage-bridge-finalize/fix-notes.md.

End with FINAL_GATES_FIXED_OR_GREEN.`,
      verification: { type: 'output_contains', value: 'FINAL_GATES_FIXED_OR_GREEN' },
      timeout: 1_200_000,
    })
    .step('typecheck-final', {
      type: 'deterministic',
      dependsOn: ['fix-final-gates'],
      command: 'npm run typecheck',
      captureOutput: true,
      failOnError: true,
    })
    .step('tests-final', {
      type: 'deterministic',
      dependsOn: ['typecheck-final'],
      command: 'npm run test',
      captureOutput: true,
      failOnError: true,
    })
    .step('build-final', {
      type: 'deterministic',
      dependsOn: ['tests-final'],
      command: 'npm run build',
      captureOutput: true,
      failOnError: true,
    })
    .step('release-review', {
      agent: 'release-lead',
      dependsOn: ['build-final'],
      task: `Review all storage bridge adapter changes and write .workflow-artifacts/storage-bridge-finalize/release-review.md.

Confirm:
  - implementation matches acceptance artifacts from prior waves
  - all tests/typecheck/build passed
  - no version bumps were introduced
  - publish.yml includes any new package directories
  - writeback discovery files are generated and validated

End with STORAGE_BRIDGE_RELEASE_REVIEW_PASS or STORAGE_BRIDGE_RELEASE_REVIEW_FAIL.`,
      verification: { type: 'output_contains', value: 'STORAGE_BRIDGE_RELEASE_REVIEW_PASS' },
      timeout: 900_000,
    })
    .step('open-pull-request', {
      type: 'deterministic',
      dependsOn: ['release-review'],
      command: OPEN_PR_COMMAND,
      captureOutput: true,
      failOnError: true,
    })
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log('Storage bridge finalize:', result.status);
}

async function runWave(wave: Wave) {
  const result = await workflow(`storage-bridge-${wave.key}-80-100`)
    .description(`${wave.description}: Claude leads, Codex implementers, self review, peer review, and Claude-owned 80-to-100 gates.`)
    .pattern('dag')
    .channel(`wf-storage-bridge-${wave.key}-80-100`)
    .maxConcurrency(4)
    .timeout(4_800_000)
    .agent('architect-lead', {
      cli: 'claude',
      role: 'Claude lead: acceptance contract, ownership, and architecture decisions',
      retries: 1,
    })
    .agent('core-implementer', {
      cli: 'codex',
      preset: 'worker',
      role: 'Codex implementer: shared core contracts and exports',
      retries: 1,
    })
    .agent('provider-implementer', {
      cli: 'codex',
      preset: 'worker',
      role: 'Codex implementer: provider adapters',
      retries: 1,
    })
    .agent('test-implementer', {
      cli: 'codex',
      preset: 'worker',
      role: 'Codex implementer: tests, fixtures, and local E2E proof',
      retries: 1,
    })
    .agent('edit-gate-repairer', {
      cli: 'codex',
      preset: 'worker',
      role: 'Codex repair implementer: fixes missing artifacts from repairable edit gates before hard verification',
      retries: 2,
    })
    .agent('peer-review-lead', {
      cli: 'claude',
      role: 'Claude lead: peer review and release risk assessment',
      retries: 1,
    })
    .agent('verification-lead', {
      cli: 'claude',
      role: 'Claude lead: 80-to-100 verification, test-fix-rerun loop, and final proof',
      retries: 1,
    })

    .step('preflight', {
      type: 'deterministic',
      command: `mkdir -p ${ARTIFACT_DIR} && test -f package.json && test -d packages/core && echo PREFLIGHT_OK`,
      captureOutput: true,
      failOnError: true,
    })
    .step('acceptance-contract', {
      agent: 'architect-lead',
      dependsOn: ['preflight'],
      task: acceptanceTask(wave),
      verification: { type: 'output_contains', value: 'ACCEPTANCE_CONTRACT_READY' },
      timeout: 900_000,
    })
    .step('acceptance-artifacts-gate', {
      type: 'deterministic',
      dependsOn: ['acceptance-contract'],
      command: `test -s ${ARTIFACT_DIR}/acceptance-contract.md && test -s ${ARTIFACT_DIR}/ownership.json && echo ACCEPTANCE_ARTIFACTS_OK`,
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-core', {
      agent: 'core-implementer',
      dependsOn: ['acceptance-artifacts-gate'],
      task: coreImplementTask(wave),
      verification: { type: 'output_contains', value: 'CORE_IMPLEMENTED_AND_SELF_REVIEWED' },
      timeout: 1_500_000,
    })
    .step('implement-providers', {
      agent: 'provider-implementer',
      dependsOn: ['acceptance-artifacts-gate'],
      task: providerImplementTask(wave),
      verification: { type: 'output_contains', value: 'PROVIDERS_IMPLEMENTED_AND_SELF_REVIEWED' },
      timeout: 1_800_000,
    })
    .step('implement-tests', {
      agent: 'test-implementer',
      dependsOn: ['acceptance-artifacts-gate'],
      task: testsImplementTask(wave),
      verification: { type: 'output_contains', value: 'TESTS_IMPLEMENTED_AND_SELF_REVIEWED' },
      timeout: 1_500_000,
    })
    .step('core-edit-gate', {
      type: 'deterministic',
      dependsOn: ['implement-core'],
      command: editGate('core', ['packages/core', ARTIFACT_DIR]),
      captureOutput: true,
      failOnError: false,
    })
    .step('providers-edit-gate', {
      type: 'deterministic',
      dependsOn: ['implement-providers'],
      command: editGate('providers', wave.packages.filter((pkg) => pkg !== 'packages/core').concat([ARTIFACT_DIR])),
      captureOutput: true,
      failOnError: false,
    })
    .step('tests-edit-gate', {
      type: 'deterministic',
      dependsOn: ['implement-tests'],
      command: editGate('tests', wave.packages.concat([ARTIFACT_DIR])),
      captureOutput: true,
      failOnError: false,
    })
    .step('repair-edit-gates', {
      agent: 'edit-gate-repairer',
      dependsOn: ['core-edit-gate', 'providers-edit-gate', 'tests-edit-gate'],
      task: editGateRepairTask(wave),
      verification: { type: 'output_contains', value: 'EDIT_GATES_REPAIRED' },
      timeout: 900_000,
    })
    .step('edit-gates-final', {
      type: 'deterministic',
      dependsOn: ['repair-edit-gates'],
      command: combinedEditGate(wave),
      captureOutput: true,
      failOnError: true,
    })
    .step('peer-review', {
      agent: 'peer-review-lead',
      dependsOn: ['edit-gates-final'],
      task: peerReviewTask(wave),
      verification: { type: 'output_contains', value: 'PEER_REVIEW_COMPLETE' },
      timeout: 900_000,
    })
    .step('peer-review-artifact-gate', {
      type: 'deterministic',
      dependsOn: ['peer-review'],
      command: `test -s ${ARTIFACT_DIR}/peer-review.md && echo PEER_REVIEW_ARTIFACT_OK`,
      captureOutput: true,
      failOnError: true,
    })
    .step('address-peer-review', {
      agent: 'provider-implementer',
      dependsOn: ['peer-review-artifact-gate'],
      task: addressReviewTask(wave),
      verification: { type: 'output_contains', value: 'PEER_REVIEW_FINDINGS_FIXED' },
      timeout: 1_200_000,
    })
    .step('typecheck-initial', {
      type: 'deterministic',
      dependsOn: ['address-peer-review'],
      command: 'npm run typecheck 2>&1 | tail -120',
      captureOutput: true,
      failOnError: false,
    })
    .step('tests-initial', {
      type: 'deterministic',
      dependsOn: ['address-peer-review'],
      command: `${wave.targetedTestCommand} 2>&1 | tail -160`,
      captureOutput: true,
      failOnError: false,
    })
    .step('build-initial', {
      type: 'deterministic',
      dependsOn: ['address-peer-review'],
      command: 'npm run build 2>&1 | tail -120',
      captureOutput: true,
      failOnError: false,
    })
    .step('discovery-initial', {
      type: 'deterministic',
      dependsOn: ['address-peer-review'],
      command: 'npm run test:writeback-discovery 2>&1 | tail -120',
      captureOutput: true,
      failOnError: false,
    })
    .step('eighty-to-one-hundred', {
      agent: 'verification-lead',
      dependsOn: ['typecheck-initial', 'tests-initial', 'build-initial', 'discovery-initial'],
      task: eightyToHundredTask(wave),
      verification: { type: 'output_contains', value: 'EIGHTY_TO_ONE_HUNDRED_COMPLETE' },
      timeout: 1_800_000,
    })
    .step('typecheck-final', {
      type: 'deterministic',
      dependsOn: ['eighty-to-one-hundred'],
      command: 'npm run typecheck',
      captureOutput: true,
      failOnError: true,
    })
    .step('tests-final', {
      type: 'deterministic',
      dependsOn: ['typecheck-final'],
      command: wave.targetedTestCommand,
      captureOutput: true,
      failOnError: true,
    })
    .step('build-final', {
      type: 'deterministic',
      dependsOn: ['tests-final'],
      command: 'npm run build',
      captureOutput: true,
      failOnError: true,
    })
    .step('discovery-final', {
      type: 'deterministic',
      dependsOn: ['build-final'],
      command: 'npm run test:writeback-discovery',
      captureOutput: true,
      failOnError: true,
    })
    .step('publish-registration-gate', {
      type: 'deterministic',
      dependsOn: ['discovery-final'],
      command:
        "bash -lc \"diff <(ls packages/ | grep -v '^webhook-server$' | sort) <(sed -n '/^      package:/,/^      version:/p' .github/workflows/publish.yml | grep -oE '^ *- [a-z0-9-]+' | sed 's/^ *- //' | grep -v '^all$' | sort -u)\"",
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review', {
      agent: 'verification-lead',
      dependsOn: ['publish-registration-gate'],
      task: finalReviewTask(wave),
      verification: { type: 'output_contains', value: 'FINAL_REVIEW_PASS' },
      timeout: 900_000,
    })
    .step('commit-ready-summary', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: `git status --short && echo STORAGE_BRIDGE_${wave.key.toUpperCase()}_80_100_READY packages="${packagesList(wave).replace(/\n/g, ', ')}"`,
      captureOutput: true,
      failOnError: true,
    })
    .step('open-pull-request', {
      type: 'deterministic',
      dependsOn: ['commit-ready-summary'],
      command: OPEN_PR_COMMAND,
      captureOutput: true,
      failOnError: true,
    })
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log(`Storage bridge ${wave.key}:`, result.status);
}

async function main() {
  if (WAVE_KEY === 'finalize') {
    await runFinalize();
    return;
  }

  await runWave(WAVES[WAVE_KEY]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
