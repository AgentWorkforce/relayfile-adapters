/**
 * 044-tier1-verify.ts
 *
 * Verify Tier-1 SaaS adapter implementations against the actual provider
 * webhook documentation and NangoHQ integration templates. Produces a
 * structured drift report per adapter so we can fix bugs before merging.
 *
 * Why this exists: 043-tier1-adapters-scaffold.ts asks the agent to
 * implement signature schemes from a paraphrased description. The agent's
 * own tests pass against the agent's own invented payloads, so signature
 * scheme bugs (wrong header name, wrong concat order, wrong tolerance) won't
 * be caught. This workflow grounds each adapter against external sources.
 *
 * Usage:
 *   TIER1_VERIFY_BATCH=1 ricky run workflows/044-tier1-verify.ts
 *   TIER1_VERIFY_BATCH=2 ricky run workflows/044-tier1-verify.ts
 *   TIER1_VERIFY_BATCH=3 ricky run workflows/044-tier1-verify.ts
 *   TIER1_VERIFY_BATCH=4 ricky run workflows/044-tier1-verify.ts
 *
 * For each adapter, an agent with WebFetch access:
 *   1. Reads our packages/<slug>/src/webhook-normalizer.ts and queries.ts
 *   2. Fetches the provider's webhook signing reference doc
 *   3. Fetches the matching NangoHQ template if one exists
 *   4. Compares 6 axes: header name, algorithm, signed-input format,
 *      encoding, comparison method, time tolerance
 *   5. Emits .workflow-artifacts/verify/<slug>-drift.json with verdict
 *      VERIFY_<SLUG>_PASS or VERIFY_<SLUG>_DRIFT plus findings list
 *
 * A final summary step aggregates the drift reports and fails the workflow
 * if any adapter has DRIFT findings of severity blocker.
 */

import { workflow } from '@agent-relay/sdk/workflows';

interface VerifyTarget {
  slug: string;
  pkgName: string;
  webhookDocUrl: string;
  apiDocUrl: string;
  nangoTemplateHint: string;
  signatureScheme: string;
  expectedHeaderName: string;
  expectedAlgorithm: string;
}

const TARGETS: VerifyTarget[] = [
  // Batch 1
  {
    slug: 'hubspot',
    pkgName: '@relayfile/adapter-hubspot',
    webhookDocUrl: 'https://developers.hubspot.com/docs/api/webhooks/validating-requests',
    apiDocUrl: 'https://developers.hubspot.com/docs/api/crm/contacts',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/hubspot',
    signatureScheme: 'X-HubSpot-Signature-v3 = base64(HMAC-SHA256(http_method + request_uri + body + timestamp, client_secret)); reject if timestamp older than 5 min',
    expectedHeaderName: 'X-HubSpot-Signature-v3',
    expectedAlgorithm: 'HMAC-SHA256',
  },
  {
    slug: 'salesforce',
    pkgName: '@relayfile/adapter-salesforce',
    webhookDocUrl: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_callouts_outbound_messaging.htm',
    apiDocUrl: 'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_what_is_rest_api.htm',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/salesforce',
    signatureScheme: 'Outbound Messages SOAP signed via mTLS at org level; application-layer X-SFDC-Webhook-Secret shared secret compare',
    expectedHeaderName: 'X-SFDC-Webhook-Secret',
    expectedAlgorithm: 'shared-secret-compare (mTLS at deployment)',
  },
  {
    slug: 'pipedrive',
    pkgName: '@relayfile/adapter-pipedrive',
    webhookDocUrl: 'https://developers.pipedrive.com/docs/api/v1/Webhooks',
    apiDocUrl: 'https://developers.pipedrive.com/docs/api/v1',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/pipedrive',
    signatureScheme: 'HTTP Basic auth on the webhook URL — Authorization: Basic base64(user:pass) with timingSafeEqual',
    expectedHeaderName: 'Authorization',
    expectedAlgorithm: 'HTTP Basic',
  },
  {
    slug: 'jira',
    pkgName: '@relayfile/adapter-jira',
    webhookDocUrl: 'https://developer.atlassian.com/cloud/jira/platform/understanding-jwt-for-connect-apps/',
    apiDocUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/jira',
    signatureScheme: 'Atlassian Connect HS256 JWT in Authorization header; verify exp + qsh claims; qsh = SHA-256 of canonical request',
    expectedHeaderName: 'Authorization',
    expectedAlgorithm: 'JWT HS256',
  },
  // Batch 2
  {
    slug: 'asana',
    pkgName: '@relayfile/adapter-asana',
    webhookDocUrl: 'https://developers.asana.com/docs/webhooks-guide',
    apiDocUrl: 'https://developers.asana.com/reference/rest-api-reference',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/asana',
    signatureScheme: 'Two-phase: handshake X-Hook-Secret echoed back; subsequent X-Hook-Signature = HMAC-SHA256 hex of body using stored secret',
    expectedHeaderName: 'X-Hook-Signature',
    expectedAlgorithm: 'HMAC-SHA256',
  },
  {
    slug: 'clickup',
    pkgName: '@relayfile/adapter-clickup',
    webhookDocUrl: 'https://clickup.com/api/developer-portal/webhooks/',
    apiDocUrl: 'https://clickup.com/api',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/clickup',
    signatureScheme: 'X-Signature = HMAC-SHA256 hex of raw body using webhook secret returned at creation',
    expectedHeaderName: 'X-Signature',
    expectedAlgorithm: 'HMAC-SHA256',
  },
  {
    slug: 'zendesk',
    pkgName: '@relayfile/adapter-zendesk',
    webhookDocUrl: 'https://developer.zendesk.com/documentation/event-connectors/webhooks/verifying/',
    apiDocUrl: 'https://developer.zendesk.com/api-reference/',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/zendesk',
    signatureScheme: 'X-Zendesk-Webhook-Signature-256 = base64 HMAC-SHA256 of (X-Zendesk-Webhook-Signature-Timestamp + raw body); 5-min tolerance',
    expectedHeaderName: 'X-Zendesk-Webhook-Signature-256',
    expectedAlgorithm: 'HMAC-SHA256',
  },
  {
    slug: 'intercom',
    pkgName: '@relayfile/adapter-intercom',
    webhookDocUrl: 'https://developers.intercom.com/docs/references/webhooks/webhook-models',
    apiDocUrl: 'https://developers.intercom.com/docs/references/2.10/rest-api/',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/intercom',
    signatureScheme: 'X-Hub-Signature = sha1=<hex HMAC-SHA1 of body using client secret>',
    expectedHeaderName: 'X-Hub-Signature',
    expectedAlgorithm: 'HMAC-SHA1',
  },
  // Batch 3
  {
    slug: 'stripe',
    pkgName: '@relayfile/adapter-stripe',
    webhookDocUrl: 'https://stripe.com/docs/webhooks/signatures',
    apiDocUrl: 'https://stripe.com/docs/api',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/stripe',
    signatureScheme: 'Stripe-Signature = "t=<ts>,v1=<sig>" where v1 = hex HMAC-SHA256 of (timestamp + "." + body) using webhook secret; 5-min tolerance',
    expectedHeaderName: 'Stripe-Signature',
    expectedAlgorithm: 'HMAC-SHA256',
  },
  {
    slug: 'shopify',
    pkgName: '@relayfile/adapter-shopify',
    webhookDocUrl: 'https://shopify.dev/docs/apps/webhooks/configuration/https#step-5-verify-the-webhook',
    apiDocUrl: 'https://shopify.dev/docs/api/admin-rest',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/shopify',
    signatureScheme: 'X-Shopify-Hmac-Sha256 = base64 HMAC-SHA256 of raw body using webhook secret; timingSafeEqual on Buffer.from(header, "base64")',
    expectedHeaderName: 'X-Shopify-Hmac-Sha256',
    expectedAlgorithm: 'HMAC-SHA256',
  },
  {
    slug: 'sendgrid',
    pkgName: '@relayfile/adapter-sendgrid',
    webhookDocUrl: 'https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features',
    apiDocUrl: 'https://docs.sendgrid.com/api-reference',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/sendgrid',
    signatureScheme: 'X-Twilio-Email-Event-Webhook-Signature + -Timestamp; ECDSA verify (SHA256) of (timestamp + body) with public key',
    expectedHeaderName: 'X-Twilio-Email-Event-Webhook-Signature',
    expectedAlgorithm: 'ECDSA-SHA256',
  },
  {
    slug: 'mailgun',
    pkgName: '@relayfile/adapter-mailgun',
    webhookDocUrl: 'https://documentation.mailgun.com/en/latest/user_manual.html#securing-webhooks',
    apiDocUrl: 'https://documentation.mailgun.com/en/latest/api_reference.html',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/mailgun',
    signatureScheme: 'Payload contains signature.{timestamp,token,signature}; verify hex HMAC-SHA256(timestamp+token, api_key) == signature',
    expectedHeaderName: 'signature.signature (in body)',
    expectedAlgorithm: 'HMAC-SHA256',
  },
  // Batch 4
  {
    slug: 'airtable',
    pkgName: '@relayfile/adapter-airtable',
    webhookDocUrl: 'https://airtable.com/developers/web/api/webhooks-overview',
    apiDocUrl: 'https://airtable.com/developers/web/api/introduction',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/airtable',
    signatureScheme: 'X-Airtable-Content-MAC = "hmac-sha256=" + hex HMAC-SHA256 of body using MAC secret returned at webhook creation',
    expectedHeaderName: 'X-Airtable-Content-MAC',
    expectedAlgorithm: 'HMAC-SHA256',
  },
  {
    slug: 'segment',
    pkgName: '@relayfile/adapter-segment',
    webhookDocUrl: 'https://segment.com/docs/connections/destinations/catalog/webhooks/',
    apiDocUrl: 'https://segment.com/docs/connections/sources/',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/segment',
    signatureScheme: 'X-Signature = hex HMAC-SHA1 of raw body using shared webhook secret',
    expectedHeaderName: 'X-Signature',
    expectedAlgorithm: 'HMAC-SHA1',
  },
  {
    slug: 'mixpanel',
    pkgName: '@relayfile/adapter-mixpanel',
    webhookDocUrl: 'https://docs.mixpanel.com/docs/data-pipelines/integrations/webhook',
    apiDocUrl: 'https://developer.mixpanel.com/reference/overview',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/mixpanel',
    signatureScheme: 'HTTP Basic auth on webhook URL with configured user:pass',
    expectedHeaderName: 'Authorization',
    expectedAlgorithm: 'HTTP Basic',
  },
  {
    slug: 'calendly',
    pkgName: '@relayfile/adapter-calendly',
    webhookDocUrl: 'https://developer.calendly.com/api-docs/webhook-signatures',
    apiDocUrl: 'https://developer.calendly.com/api-docs',
    nangoTemplateHint: 'https://github.com/NangoHQ/integration-templates/tree/main/integrations/calendly',
    signatureScheme: 'Calendly-Webhook-Signature = "t=<ts>,v1=<sig>" where v1 = hex HMAC-SHA256 of (timestamp + "." + body) using signing key; 3-min tolerance',
    expectedHeaderName: 'Calendly-Webhook-Signature',
    expectedAlgorithm: 'HMAC-SHA256',
  },
];

if (TARGETS.length !== 16) {
  throw new Error(`Expected 16 verify targets, got ${TARGETS.length}`);
}

const BATCHES: Record<string, VerifyTarget[]> = {
  '1': TARGETS.slice(0, 4),
  '2': TARGETS.slice(4, 8),
  '3': TARGETS.slice(8, 12),
  '4': TARGETS.slice(12, 16),
};

const BATCH_KEY = process.env.TIER1_VERIFY_BATCH ?? '';
if (!BATCH_KEY || !BATCHES[BATCH_KEY]) {
  throw new Error(
    'Set TIER1_VERIFY_BATCH=1|2|3|4.\n' +
      'Example: TIER1_VERIFY_BATCH=1 ricky run workflows/044-tier1-verify.ts',
  );
}

const ARTIFACT_DIR = '.workflow-artifacts/verify';

function verifyTask(t: VerifyTarget): string {
  return `Verify our packages/${t.slug} adapter against the actual provider documentation and NangoHQ integration template. This is the gating check before we merge ${t.pkgName}.

Your task is to PRODUCE A STRUCTURED DRIFT REPORT — not to rewrite code.

Step 1 — Read our implementation:
  - packages/${t.slug}/src/webhook-normalizer.ts
  - packages/${t.slug}/src/queries.ts
  - packages/${t.slug}/src/writeback.ts
  - packages/${t.slug}/src/${t.slug}-adapter.ts

Step 2 — Fetch external sources (use WebFetch):
  - Provider webhook signature doc:  ${t.webhookDocUrl}
  - Provider API doc:                 ${t.apiDocUrl}
  - NangoHQ template (may 404):       ${t.nangoTemplateHint}

Step 3 — Compare on these 6 axes (this is what bugs hide in):

  1. HEADER NAME — does our code reference the exact header name the provider uses? (e.g. "X-HubSpot-Signature-v3" vs "X-HubSpot-Signature" vs "HubSpot-Signature"). Case sensitivity matters since Node lowercases headers.
  2. ALGORITHM — HMAC-SHA256 vs SHA1 vs ECDSA, etc. Must exactly match provider.
  3. SIGNED INPUT FORMAT — what bytes go into the HMAC? Order matters: is it (method+uri+body+ts) or (ts+"."+body) or just (body)? Includes raw body vs parsed JSON.
  4. ENCODING — hex vs base64. Many providers use one specific encoding; mixing them silently fails verification.
  5. COMPARISON METHOD — node:crypto timingSafeEqual on Buffers, or plain ===? Latter is a security bug, former must use buffers of equal length.
  6. TIME TOLERANCE — does provider require timestamp validation? What window (3min/5min/none)? Our code must match.

Also check:
  - Required object types (e.g. ${t.pkgName.replace('@relayfile/adapter-', '')}: are all primary objects in our path-mapper?)
  - Endpoint paths in our queries.ts/writeback.ts: do they match the provider's actual API paths and version?

Step 4 — Write the drift report to ${ARTIFACT_DIR}/${t.slug}-drift.json with this exact shape:

{
  "slug": "${t.slug}",
  "verdict": "PASS" | "DRIFT",
  "expected": {
    "header": "...",
    "algorithm": "...",
    "signed_input": "...",
    "encoding": "...",
    "comparison": "...",
    "time_tolerance_seconds": 300
  },
  "actual": {
    "header": "...",
    "algorithm": "...",
    "signed_input": "...",
    "encoding": "...",
    "comparison": "...",
    "time_tolerance_seconds": 300
  },
  "findings": [
    { "severity": "blocker" | "major" | "minor", "axis": "header|algorithm|...", "description": "..." }
  ],
  "sources": {
    "provider_docs": "${t.webhookDocUrl}",
    "nango_template": "${t.nangoTemplateHint}"
  }
}

Reference scheme to compare against: ${t.signatureScheme}
Expected header name: ${t.expectedHeaderName}
Expected algorithm: ${t.expectedAlgorithm}

Verdict rules:
  - PASS: zero blocker findings
  - DRIFT: any blocker or 2+ major findings

Step 5 — End your output with the exact line:
  VERIFY_${t.slug.toUpperCase()}_DONE verdict=<PASS|DRIFT> blockers=<N> majors=<N>

Be honest in the report. If you cannot fetch a doc URL, record that in findings as a minor and proceed using the inline reference scheme above. If the NangoHQ template URL 404s (some providers don't have one), record that too — it's not a failure.`;
}

const ARTIFACT_GATE = (t: VerifyTarget): string =>
  `test -s '${ARTIFACT_DIR}/${t.slug}-drift.json' && node -e "const r = require('./${ARTIFACT_DIR}/${t.slug}-drift.json'); if (!r.verdict || !['PASS','DRIFT'].includes(r.verdict)) { console.error('bad verdict:', r.verdict); process.exit(1); } console.log('VERIFY_ARTIFACT_${t.slug.toUpperCase()}_OK verdict=' + r.verdict + ' findings=' + (r.findings||[]).length);"`;

const PACKAGE_PREFLIGHT_GATE = (targets: VerifyTarget[]): string => {
  const checks = targets
    .flatMap((t) => [
      `test -d packages/${t.slug} || { echo "missing package directory: packages/${t.slug}"; exit 1; }`,
      `test -f packages/${t.slug}/src/${t.slug}-adapter.ts || { echo "missing adapter file: packages/${t.slug}/src/${t.slug}-adapter.ts"; exit 1; }`,
      `test -f packages/${t.slug}/src/webhook-normalizer.ts || { echo "missing webhook normalizer: packages/${t.slug}/src/webhook-normalizer.ts"; exit 1; }`,
      `test -f packages/${t.slug}/src/queries.ts || { echo "missing queries file: packages/${t.slug}/src/queries.ts"; exit 1; }`,
      `test -f packages/${t.slug}/src/writeback.ts || { echo "missing writeback file: packages/${t.slug}/src/writeback.ts"; exit 1; }`,
    ])
    .join(' && ');

  return `${checks} && echo "PACKAGE_PREFLIGHT_BATCH_${BATCH_KEY}_OK adapters=${targets.map((t) => t.slug).join(',')}"`;
};

async function main() {
  const targets = BATCHES[BATCH_KEY]!;

  let wf = workflow(`tier1-verify-batch-${BATCH_KEY}`)
    .description(
      `Verify 4 Tier-1 adapters against provider docs + NangoHQ templates (batch ${BATCH_KEY}): ${targets.map((t) => t.slug).join(', ')}.`,
    )
    .pattern('dag')
    .channel(`wf-tier1-verify-batch-${BATCH_KEY}`)
    .maxConcurrency(4)
    .timeout(3_600_000) // 60 min
    .agent('verifier', {
      cli: 'claude',
      role: 'Verifies adapter implementation against provider docs and NangoHQ templates',
    });

  // Ensure artifact dir exists once at the start
  wf = wf.step('init-artifact-dir', {
    type: 'deterministic',
    command: `mkdir -p ${ARTIFACT_DIR} && echo "INIT_OK"`,
    captureOutput: true,
    failOnError: true,
  });

  wf = wf.step('package-preflight', {
    type: 'deterministic',
    dependsOn: ['init-artifact-dir'],
    command: PACKAGE_PREFLIGHT_GATE(targets),
    captureOutput: true,
    failOnError: true,
  });

  const artifactGates: string[] = [];
  for (const t of targets) {
    const VERIFY = `verify-${t.slug}`;
    const ARTIFACT = `artifact-${t.slug}`;

    wf = wf
      .step(VERIFY, {
        agent: 'verifier',
        dependsOn: ['package-preflight'],
        task: verifyTask(t),
        verification: { type: 'output_contains', value: `VERIFY_${t.slug.toUpperCase()}_DONE` },
        timeout: 900_000, // 15 min per adapter
      })
      .step(ARTIFACT, {
        type: 'deterministic',
        dependsOn: [VERIFY],
        command: ARTIFACT_GATE(t),
        captureOutput: true,
        failOnError: true,
      });

    artifactGates.push(ARTIFACT);
  }

  // Aggregate: delegate to scripts/verify-aggregate.mjs to avoid the shell-
  // quoting nightmare of inlining a node -e script alongside JSON.stringify
  // output. The script reads .workflow-artifacts/verify/*.json, prints a
  // summary table, and exits non-zero if any DRIFT or blocker findings exist.
  wf = wf.step('aggregate-drift', {
    type: 'deterministic',
    dependsOn: artifactGates,
    command: `node scripts/verify-aggregate.mjs ${BATCH_KEY}`,
    captureOutput: true,
    failOnError: true,
  });

  const result = await wf
    .onError('retry', { maxRetries: 0, retryDelayMs: 0 })
    .run({ cwd: process.cwd() });

  console.log(`Verify batch ${BATCH_KEY}:`, result.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
