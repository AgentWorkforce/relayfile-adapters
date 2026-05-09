/**
 * repeatable/research-integration-scopes.ts
 *
 * Deterministically fills docs/integration-scopes.yaml with OAuth scopes,
 * API-key permissions, or cloud IAM requirements for Relayfile eval
 * integrations.
 *
 * The workflow reads the YAML once at startup, sorts every entry whose
 * scope_status is pending or needs_review, and creates one sequential research
 * step per integration. Each agent edits only that integration's YAML entry and
 * writes a short evidence artifact.
 *
 * Usage:
 *   ricky run workflows/repeatable/research-integration-scopes.ts
 *   agent-relay run workflows/repeatable/research-integration-scopes.ts
 *
 * Optional:
 *   SCOPE_RESEARCH_LIMIT=5 ricky run workflows/repeatable/research-integration-scopes.ts
 *   SCOPE_RESEARCH_ALLOW_PENDING=1 ricky run workflows/repeatable/research-integration-scopes.ts
 */

import { readFileSync } from 'node:fs';
import { workflow } from '@agent-relay/sdk/workflows';
import { parse as parseYaml } from 'yaml';

const SCOPE_FILE = 'docs/integration-scopes.yaml';
const ARTIFACT_DIR = '.workflow-artifacts/integration-scope-research';
const NANGO_OVERVIEW = 'https://nango.dev/docs/integrations/overview';
const NANGO_CATALOG = 'https://nango.dev/api-integrations';
const NANGO_PROVIDERS =
  'https://github.com/NangoHQ/nango/blob/master/packages/providers/providers.yaml';
const NANGO_PROVIDER_RAW =
  'https://raw.githubusercontent.com/NangoHQ/nango/master/packages/providers/providers.yaml';
const NANGO_TEMPLATES = 'https://github.com/NangoHQ/integration-templates/tree/main/integrations';
const SCOPE_RESEARCH_LIMIT = Number.parseInt(process.env.SCOPE_RESEARCH_LIMIT ?? '', 10);

type ScopeStatus = 'verified' | 'needs_review' | 'pending' | 'not_applicable';

interface IntegrationScopeEntry {
  slug: string;
  display_name: string;
  category: string;
  status: 'implemented' | 'gap';
  package?: string | null;
  nango_slug?: string | null;
  auth_model: string;
  scope_status: ScopeStatus;
  required_scopes?: string[];
  candidate_scopes?: string[];
  sources?: string[];
  notes?: string;
}

interface ScopeCatalog {
  integrations: IntegrationScopeEntry[];
}

function loadCatalog(): ScopeCatalog {
  const parsed = parseYaml(readFileSync(SCOPE_FILE, 'utf8')) as ScopeCatalog;
  if (!parsed || !Array.isArray(parsed.integrations)) {
    throw new Error(`${SCOPE_FILE} must contain an integrations array`);
  }
  return parsed;
}

function researchTargets(): IntegrationScopeEntry[] {
  const targets = loadCatalog().integrations
    .filter((entry) => entry.scope_status === 'pending' || entry.scope_status === 'needs_review')
    .sort((a, b) => a.slug.localeCompare(b.slug));

  if (Number.isFinite(SCOPE_RESEARCH_LIMIT) && SCOPE_RESEARCH_LIMIT > 0) {
    return targets.slice(0, SCOPE_RESEARCH_LIMIT);
  }

  return targets;
}

function targetSummary(target: IntegrationScopeEntry): string {
  return [
    `slug: ${target.slug}`,
    `display_name: ${target.display_name}`,
    `category: ${target.category}`,
    `status: ${target.status}`,
    `package: ${target.package ?? ''}`,
    `nango_slug: ${target.nango_slug ?? ''}`,
    `auth_model: ${target.auth_model}`,
    `current_scope_status: ${target.scope_status}`,
    `candidate_scopes: ${(target.candidate_scopes ?? []).join(', ') || '(none)'}`,
    `notes: ${target.notes ?? ''}`,
  ].join('\n');
}

function artifactPath(target: IntegrationScopeEntry): string {
  return `${ARTIFACT_DIR}/${target.slug}.md`;
}

function researchTask(target: IntegrationScopeEntry): string {
  return `You are researching app scopes and permissions for one Relayfile integration.

Repository rules:
  - You are not alone in the codebase. Do not revert or rewrite unrelated edits.
  - Edit only ${SCOPE_FILE} and ${artifactPath(target)}.
  - Preserve YAML ordering and the surrounding structure.
  - Do not change package versions.

Integration to research:
${targetSummary(target)}

Goal:
  Update exactly this entry in ${SCOPE_FILE} with the minimum required scopes or permission grants for the Relayfile app/integration to support the adapter's eval surface.

Research order:
  1. Start at Nango overview/catalog and find the exact integration doc:
     - ${NANGO_OVERVIEW}
     - ${NANGO_CATALOG}
  2. Check the Nango provider registry for auth mode, provider slug, default scopes, and setup details:
     - ${NANGO_PROVIDERS}
     - ${NANGO_PROVIDER_RAW}
  3. Check Nango integration templates when available for action/sync-level scopes:
     - ${NANGO_TEMPLATES}/${target.nango_slug || target.slug}
  4. If Nango does not specify enough, use official provider docs only.

What to capture:
  - required_scopes: exact scope strings or permission names needed for read/write/webhook behavior.
  - candidate_scopes: empty once you are confident; otherwise put uncertain scopes here and set scope_status: needs_review.
  - scope_status:
      verified if official docs or user-provided evidence clearly support the required_scopes.
      needs_review if you found strong candidates but not enough certainty.
      not_applicable if this integration uses API keys, bot tokens, database credentials, or cloud IAM instead of OAuth scopes.
  - sources: URLs to the exact docs or source files used.
  - notes: short rationale, including whether permissions are OAuth scopes, app permissions, API key scopes, cloud IAM actions, or provider roles.

For Jira specifically, verify whether read:jira-work, write:jira-work, manage:jira-webhook, and offline_access are sufficient for issues/projects/sprints/comments plus webhooks. Do not assume the candidate list is complete.

Write ${artifactPath(target)} with:
  - final status
  - scope list or not-applicable permission model
  - source URLs
  - any uncertainty

Validation before exiting:
  - Run a YAML parse check for ${SCOPE_FILE}.
  - Confirm this slug appears exactly once.
  - Confirm the entry is no longer pending unless official docs are unavailable and you explain why.

End your final message with:
SCOPE_RESEARCH_COMPLETE:${target.slug}`;
}

function validationCommand(requireNoPending: boolean): string {
  const pendingCheck = requireNoPending
    ? `
const unresolved = integrations.filter((entry) => entry.scope_status === 'pending');
if (unresolved.length) {
  console.error('pending scope entries remain:', unresolved.map((entry) => entry.slug).join(', '));
  process.exit(1);
}
`
    : '';

  return `node <<'NODE'
const fs = require('fs');
const YAML = require('yaml');
const doc = YAML.parse(fs.readFileSync('${SCOPE_FILE}', 'utf8'));
if (!doc || !Array.isArray(doc.integrations)) {
  throw new Error('${SCOPE_FILE} must contain integrations[]');
}
const integrations = doc.integrations;
const statuses = new Set(['verified', 'needs_review', 'pending', 'not_applicable']);
const seen = new Set();
const duplicates = [];
for (const entry of integrations) {
  if (!entry.slug) throw new Error('integration entry missing slug');
  if (seen.has(entry.slug)) duplicates.push(entry.slug);
  seen.add(entry.slug);
  if (!statuses.has(entry.scope_status)) {
    throw new Error(entry.slug + ' has invalid scope_status: ' + entry.scope_status);
  }
  if (entry.scope_status === 'verified' && (!Array.isArray(entry.required_scopes) || entry.required_scopes.length === 0)) {
    throw new Error(entry.slug + ' is verified but has no required_scopes');
  }
  if (entry.scope_status === 'verified' && (!Array.isArray(entry.sources) || entry.sources.length === 0)) {
    throw new Error(entry.slug + ' is verified but has no sources');
  }
  if (entry.scope_status === 'needs_review') {
    const hasCandidates = Array.isArray(entry.candidate_scopes) && entry.candidate_scopes.length > 0;
    const hasRequired = Array.isArray(entry.required_scopes) && entry.required_scopes.length > 0;
    if (!hasCandidates && !hasRequired) {
      throw new Error(entry.slug + ' is needs_review but has no required_scopes or candidate_scopes');
    }
  }
}
if (duplicates.length) {
  throw new Error('duplicate slugs: ' + duplicates.join(', '));
}
${pendingCheck}
const counts = integrations.reduce((acc, entry) => {
  acc[entry.scope_status] = (acc[entry.scope_status] || 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({ total: integrations.length, counts }, null, 2));
NODE`;
}

async function main() {
  const targets = researchTargets();
  const firstDependency = 'validate-scope-yaml-initial';
  let previousStep = firstDependency;

  let builder = workflow('046-research-integration-scopes')
    .description('Research and fill Relayfile integration scopes for eval app registration')
    .pattern('dag')
    .channel('wf-integration-scope-research')
    .maxConcurrency(1)
    .timeout(7_200_000)
    .repairable()
    .agent('scope-researcher', {
      cli: 'codex',
      role:
        'Scope researcher. Uses Nango docs, provider registry, Nango templates, and official provider docs to update exactly one integration scope entry at a time.',
      retries: 2,
    })
    .step(firstDependency, {
      type: 'deterministic',
      command: validationCommand(false),
      captureOutput: true,
      failOnError: true,
    })
    .step('init-artifact-dir', {
      type: 'deterministic',
      dependsOn: [firstDependency],
      command: `mkdir -p ${ARTIFACT_DIR} && echo "targets=${targets.map((target) => target.slug).join(',')}"`,
      captureOutput: true,
      failOnError: true,
    });

  previousStep = 'init-artifact-dir';

  for (const target of targets) {
    const stepName = `research-${target.slug}`;
    builder = builder.step(stepName, {
      agent: 'scope-researcher',
      dependsOn: [previousStep],
      task: researchTask(target),
      verification: { type: 'output_contains', value: `SCOPE_RESEARCH_COMPLETE:${target.slug}` },
      timeout: 900_000,
    });
    previousStep = stepName;
  }

  const result = await builder
    .step('validate-scope-yaml-final', {
      type: 'deterministic',
      dependsOn: [previousStep],
      command: validationCommand(
        process.env.SCOPE_RESEARCH_ALLOW_PENDING !== '1' &&
          !(Number.isFinite(SCOPE_RESEARCH_LIMIT) && SCOPE_RESEARCH_LIMIT > 0),
      ),
      captureOutput: true,
      failOnError: true,
    })
    .step('scope-research-summary', {
      type: 'deterministic',
      dependsOn: ['validate-scope-yaml-final'],
      command: `git status --short ${SCOPE_FILE} ${ARTIFACT_DIR} && echo SCOPE_RESEARCH_WORKFLOW_COMPLETE`,
      captureOutput: true,
      failOnError: true,
    })
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log('Integration scope research:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
