/**
 * 043-tier1-adapters-scaffold.ts
 *
 * Scaffold 16 Tier-1 SaaS adapter packages with REAL implementation —
 * not metadata declarations. Run in 5 batches to fit ricky's 45-min
 * runtime-launch wallclock.
 *
 * Usage:
 *   TIER1_BATCH=1        ricky run workflows/043-tier1-adapters-scaffold.ts
 *   TIER1_BATCH=2        ricky run workflows/043-tier1-adapters-scaffold.ts
 *   TIER1_BATCH=3        ricky run workflows/043-tier1-adapters-scaffold.ts
 *   TIER1_BATCH=4        ricky run workflows/043-tier1-adapters-scaffold.ts
 *   TIER1_BATCH=finalize ricky run workflows/043-tier1-adapters-scaffold.ts
 *
 * Each batch (1-4) scaffolds 4 adapters in parallel with hard per-package gates:
 *   - tsc --noEmit must pass
 *   - npm test must show ≥10 passing
 *   - webhook-normalizer.test.ts must show ≥4 passing (accept-valid + reject-tampered)
 *   - Required route anchors present in code
 *   - Line floors: <slug>-adapter.ts ≥ 400, webhook-normalizer.ts ≥ 200
 *
 * Finalize batch (5):
 *   - npm run build (turbo) across the monorepo
 *   - npm run test (turbo) across the monorepo
 *   - Update scripts/launch-catalog.mjs (existing=true for new 16)
 *   - npm run catalog:audit
 *   - Final review pass
 */

import { workflow } from '@agent-relay/sdk/workflows';

// ---------------------------------------------------------------------------
// Adapter targets
// ---------------------------------------------------------------------------

interface AdapterTarget {
  slug: string;
  pkgName: string;
  className: string;
  category: string;
  primaryObjects: string[];
  oauthProvider: 'nango' | 'pipedream' | 'composio';
  signatureScheme: string;
  routeAnchors: string[];
}

const ADAPTERS: AdapterTarget[] = [
  // Batch 1 ----------------------------------------------------------------
  {
    slug: 'hubspot',
    pkgName: '@relayfile/adapter-hubspot',
    className: 'HubSpotAdapter',
    category: 'crm',
    primaryObjects: ['contact', 'company', 'deal', 'ticket'],
    oauthProvider: 'nango',
    signatureScheme:
      'X-HubSpot-Signature-v3: HMAC-SHA256 of (requestMethod + requestUri + body + X-HubSpot-Request-Timestamp), key = client secret. Reject if timestamp older than 5 minutes. Use timingSafeEqual.',
    routeAnchors: ['/crm/v3/objects/contacts', '/crm/v3/objects/companies', '/crm/v3/objects/deals'],
  },
  {
    slug: 'salesforce',
    pkgName: '@relayfile/adapter-salesforce',
    className: 'SalesforceAdapter',
    category: 'crm',
    primaryObjects: ['Account', 'Contact', 'Opportunity', 'Lead', 'Case'],
    oauthProvider: 'nango',
    signatureScheme:
      'Outbound Messages SOAP signed via mTLS at the org level — at the application layer verify X-SFDC-Webhook-Secret header against config.webhookSecret with timingSafeEqual. Document mTLS as a deployment concern.',
    routeAnchors: ['/services/data/v59.0/sobjects/Account', '/services/data/v59.0/sobjects/Contact'],
  },
  {
    slug: 'pipedrive',
    pkgName: '@relayfile/adapter-pipedrive',
    className: 'PipedriveAdapter',
    category: 'crm',
    primaryObjects: ['deal', 'person', 'organization', 'activity'],
    oauthProvider: 'nango',
    signatureScheme:
      'HTTP Basic auth on webhook URL — verify Authorization header equals "Basic <base64(user:pass)>" from config.webhookBasicAuth using timingSafeEqual. No HMAC.',
    routeAnchors: ['/v1/deals', '/v1/persons', '/v1/organizations'],
  },
  {
    slug: 'jira',
    pkgName: '@relayfile/adapter-jira',
    className: 'JiraAdapter',
    category: 'project-management',
    primaryObjects: ['issue', 'project', 'sprint', 'comment'],
    oauthProvider: 'nango',
    signatureScheme:
      'Atlassian Connect JWT in Authorization header. Verify HS256 against config.sharedSecret, check qsh and exp claims (±60s). Implement minimal HS256 verifier with createHmac (no jose dep).',
    routeAnchors: ['/rest/api/3/issue', '/rest/api/3/project'],
  },
  // Batch 2 ----------------------------------------------------------------
  {
    slug: 'asana',
    pkgName: '@relayfile/adapter-asana',
    className: 'AsanaAdapter',
    category: 'project-management',
    primaryObjects: ['task', 'project', 'section', 'workspace'],
    oauthProvider: 'nango',
    signatureScheme:
      'Two-phase: handshake request carries X-Hook-Secret which the receiver echoes back to confirm. Subsequent requests carry X-Hook-Signature: HMAC-SHA256 hex of body using stored secret. Implement both phases.',
    routeAnchors: ['/api/1.0/tasks', '/api/1.0/projects'],
  },
  {
    slug: 'clickup',
    pkgName: '@relayfile/adapter-clickup',
    className: 'ClickUpAdapter',
    category: 'project-management',
    primaryObjects: ['task', 'list', 'space', 'folder'],
    oauthProvider: 'nango',
    signatureScheme:
      'X-Signature: HMAC-SHA256 hex of raw body using webhook secret returned at webhook creation. Use timingSafeEqual on hex strings.',
    routeAnchors: ['/api/v2/task', '/api/v2/list'],
  },
  {
    slug: 'zendesk',
    pkgName: '@relayfile/adapter-zendesk',
    className: 'ZendeskAdapter',
    category: 'support',
    primaryObjects: ['ticket', 'user', 'organization'],
    oauthProvider: 'nango',
    signatureScheme:
      'X-Zendesk-Webhook-Signature-256: base64 HMAC-SHA256 of (X-Zendesk-Webhook-Signature-Timestamp + raw body) using signing secret. Verify timestamp within 5 minutes.',
    routeAnchors: ['/api/v2/tickets', '/api/v2/users'],
  },
  {
    slug: 'intercom',
    pkgName: '@relayfile/adapter-intercom',
    className: 'IntercomAdapter',
    category: 'support',
    primaryObjects: ['conversation', 'contact', 'company'],
    oauthProvider: 'nango',
    signatureScheme:
      'X-Hub-Signature: "sha1=" + HMAC-SHA1 hex of body using client secret. (Intercom still uses SHA1 per their docs.) Use timingSafeEqual on hex strings.',
    routeAnchors: ['/conversations', '/contacts'],
  },
  // Batch 3 ----------------------------------------------------------------
  {
    slug: 'stripe',
    pkgName: '@relayfile/adapter-stripe',
    className: 'StripeAdapter',
    category: 'payments',
    primaryObjects: ['customer', 'invoice', 'subscription', 'charge', 'payment_intent'],
    oauthProvider: 'nango',
    signatureScheme:
      'Stripe-Signature: "t=<timestamp>,v1=<sig>". HMAC-SHA256 of (timestamp + "." + body) with webhook signing secret, hex compare to v1 via timingSafeEqual. Reject if timestamp older than 5 minutes.',
    routeAnchors: ['/v1/customers', '/v1/invoices', '/v1/subscriptions'],
  },
  {
    slug: 'shopify',
    pkgName: '@relayfile/adapter-shopify',
    className: 'ShopifyAdapter',
    category: 'commerce',
    primaryObjects: ['order', 'product', 'customer', 'fulfillment'],
    oauthProvider: 'nango',
    signatureScheme:
      'X-Shopify-Hmac-Sha256: base64 HMAC-SHA256 of raw body using webhook secret. timingSafeEqual on Buffer.from(header, "base64") vs computed digest buffer.',
    routeAnchors: ['/admin/api/2024-01/orders.json', '/admin/api/2024-01/products.json'],
  },
  {
    slug: 'sendgrid',
    pkgName: '@relayfile/adapter-sendgrid',
    className: 'SendGridAdapter',
    category: 'email',
    primaryObjects: ['mail', 'event', 'contact'],
    oauthProvider: 'nango',
    signatureScheme:
      'X-Twilio-Email-Event-Webhook-Signature + -Timestamp. ECDSA via crypto.verify("SHA256") with public key (DER or PEM). Concat timestamp + body, decode signature from base64.',
    routeAnchors: ['/v3/mail/send', '/v3/marketing/contacts'],
  },
  {
    slug: 'mailgun',
    pkgName: '@relayfile/adapter-mailgun',
    className: 'MailgunAdapter',
    category: 'email',
    primaryObjects: ['message', 'event', 'list'],
    oauthProvider: 'nango',
    signatureScheme:
      'Payload contains signature.timestamp, signature.token, signature.signature. HMAC-SHA256 hex of (timestamp + token) with API key, timingSafeEqual against signature.signature.',
    routeAnchors: ['/v3/{domain}/messages', '/v3/{domain}/events'],
  },
  // Batch 4 ----------------------------------------------------------------
  {
    slug: 'airtable',
    pkgName: '@relayfile/adapter-airtable',
    className: 'AirtableAdapter',
    category: 'data',
    primaryObjects: ['record', 'table', 'base'],
    oauthProvider: 'nango',
    signatureScheme:
      'X-Airtable-Content-MAC: "hmac-sha256=" + hex HMAC-SHA256 of raw body using MAC secret. timingSafeEqual on hex strings.',
    routeAnchors: ['/v0/{baseId}/{tableId}'],
  },
  {
    slug: 'segment',
    pkgName: '@relayfile/adapter-segment',
    className: 'SegmentAdapter',
    category: 'analytics',
    primaryObjects: ['identify', 'track', 'page', 'group'],
    oauthProvider: 'nango',
    signatureScheme:
      'X-Signature: HMAC-SHA1 hex of raw body using shared webhook secret. timingSafeEqual on hex strings. Note Segment also supports per-source secrets.',
    routeAnchors: ['/v1/identify', '/v1/track', '/v1/page'],
  },
  {
    slug: 'mixpanel',
    pkgName: '@relayfile/adapter-mixpanel',
    className: 'MixpanelAdapter',
    category: 'analytics',
    primaryObjects: ['event', 'profile', 'cohort'],
    oauthProvider: 'nango',
    signatureScheme:
      'HTTP Basic auth on webhook URL. Verify Authorization equals "Basic <base64(config.webhookUser:config.webhookPass)>" with timingSafeEqual. No HMAC.',
    routeAnchors: ['/track', '/engage'],
  },
  {
    slug: 'calendly',
    pkgName: '@relayfile/adapter-calendly',
    className: 'CalendlyAdapter',
    category: 'scheduling',
    primaryObjects: ['scheduled_event', 'invitee', 'event_type'],
    oauthProvider: 'nango',
    signatureScheme:
      'Calendly-Webhook-Signature: "t=<ts>,v1=<sig>". HMAC-SHA256 hex of (timestamp + "." + body) with signing key, timingSafeEqual. Reject if timestamp older than 3 minutes.',
    routeAnchors: ['/scheduled_events', '/event_types'],
  },
];

if (ADAPTERS.length !== 16) {
  throw new Error(`Expected 16 adapters, got ${ADAPTERS.length}`);
}

const BATCHES: Record<string, AdapterTarget[]> = {
  '1': ADAPTERS.slice(0, 4),
  '2': ADAPTERS.slice(4, 8),
  '3': ADAPTERS.slice(8, 12),
  '4': ADAPTERS.slice(12, 16),
};

const BATCH_KEY = process.env.TIER1_BATCH ?? '';

if (!BATCH_KEY) {
  throw new Error(
    'Set TIER1_BATCH env var to 1, 2, 3, 4, or finalize.\n' +
      'Example: TIER1_BATCH=1 ricky run workflows/043-tier1-adapters-scaffold.ts',
  );
}

if (BATCH_KEY !== 'finalize' && !BATCHES[BATCH_KEY]) {
  throw new Error(`Invalid TIER1_BATCH=${BATCH_KEY}. Use 1-4 or finalize.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHARED_PREAMBLE = `You are scaffolding a real, working SaaS adapter package — not metadata.

Hard gates that follow this step (no metadata-only path through them):
  - tsc --noEmit must pass with strict mode
  - npm test must exit 0 with ≥10 passing tests
  - webhook-normalizer.test.ts must have ≥4 passing tests including
    a known-good HMAC accept case AND a tampered-body reject case
  - Required route anchor strings must appear in code
  - Line floors: <slug>-adapter.ts ≥ 400 lines, webhook-normalizer.ts ≥ 200 lines

Reference shape: study packages/linear/src/* for the exact pattern:
  - linear-adapter.ts: IntegrationAdapter subclass with ingestWebhook,
    computePath, computeSemantics, per-object helpers
  - path-mapper.ts: pure functions producing deterministic VFS paths
  - webhook-normalizer.ts: real HMAC via node:crypto createHmac +
    timingSafeEqual, header constants, NormalizedWebhook construction
  - types.ts: provider config + payload types
  - writeback.ts: writeback path → API verb mapping
  - queries.ts: read path → API GET mapping

The IntegrationAdapter abstract class is currently duplicated per package
(known smell). Mirror that convention — extend it as Linear does.`;

function implementTask(t: AdapterTarget): string {
  return `${SHARED_PREAMBLE}

Implement packages/${t.slug}/ end-to-end. Produce all of:
  - packages/${t.slug}/package.json (name=${t.pkgName}, exports for ".", "./path-mapper", "./writeback", "./webhook", "./types"; mirror packages/linear/package.json shape)
  - packages/${t.slug}/tsconfig.json (strict; extend parent if applicable)
  - packages/${t.slug}/src/index.ts (barrel exports)
  - packages/${t.slug}/src/types.ts (config type, payload types for: ${t.primaryObjects.join(', ')})
  - packages/${t.slug}/src/${t.slug}-adapter.ts (≥400 lines: ${t.className} extends IntegrationAdapter; ingestWebhook, computePath, computeSemantics, per-object helpers)
  - packages/${t.slug}/src/path-mapper.ts (deterministic VFS paths for every object type)
  - packages/${t.slug}/src/queries.ts (read path → API GET mapping)
  - packages/${t.slug}/src/writeback.ts (writeback path → API PUT/PATCH/POST mapping)
  - packages/${t.slug}/src/webhook-normalizer.ts (≥200 lines: signature scheme below, header constants, normalize<Provider>Webhook function)
  - packages/${t.slug}/src/__tests__/${t.slug}-adapter.test.ts (≥6 cases: ingestWebhook for each primary object, semantics extraction, path mapping)
  - packages/${t.slug}/src/__tests__/webhook-normalizer.test.ts (≥4 cases: accept-valid, reject-tampered-body, reject-missing-header, reject-expired-timestamp where applicable)

Signature scheme (implement EXACTLY this):
${t.signatureScheme}

Required route anchors (must appear as string literals in your code, typically queries.ts or writeback.ts):
${t.routeAnchors.map((a) => `  - ${a}`).join('\n')}

Use createHmac and timingSafeEqual from node:crypto. Do NOT copy Linear's
signature scheme — write the provider-specific one above.

Run \`cd packages/${t.slug} && npx tsc --noEmit && npm test\` yourself
before declaring done. End with IMPL_${t.slug.toUpperCase()}_COMPLETE.`;
}

const TYPECHECK_GATE = (t: AdapterTarget): string =>
  `cd packages/${t.slug} && npx tsc --noEmit -p tsconfig.json && echo "TYPECHECK_${t.slug.toUpperCase()}_OK"`;

const TEST_GATE = (t: AdapterTarget): string =>
  `cd packages/${t.slug} && npm test 2>&1 | tee /tmp/test-${t.slug}.log; pass=$(grep -E '^# pass [0-9]+' /tmp/test-${t.slug}.log | grep -oE '[0-9]+' | head -1); [ -n "$pass" ] && [ "$pass" -ge 10 ] || { echo "test gate ${t.slug}: expected >=10 passes, got $pass"; exit 1; }; echo "TEST_GATE_${t.slug.toUpperCase()}_OK"`;

const FIXTURE_GATE = (t: AdapterTarget): string =>
  `cd packages/${t.slug} && node --import tsx --test 'src/__tests__/webhook-normalizer.test.ts' 2>&1 | tee /tmp/webhook-${t.slug}.log; pass=$(grep -E '^# pass [0-9]+' /tmp/webhook-${t.slug}.log | grep -oE '[0-9]+' | head -1); [ -n "$pass" ] && [ "$pass" -ge 4 ] || { echo "webhook fixture ${t.slug}: expected >=4 passes, got $pass"; exit 1; }; echo "WEBHOOK_FIXTURE_${t.slug.toUpperCase()}_OK"`;

const ANCHOR_GATE = (t: AdapterTarget): string => {
  const checks = t.routeAnchors
    .map(
      (a) =>
        `grep -Rq -F -- '${a.replace(/'/g, "'\\''")}' packages/${t.slug}/src/ || { echo "missing anchor in ${t.slug}: ${a}"; exit 1; }`,
    )
    .join('; ');
  return `${checks}; echo "ANCHOR_GATE_${t.slug.toUpperCase()}_OK"`;
};

const LINE_FLOOR_GATE = (t: AdapterTarget): string =>
  `a=$(wc -l < packages/${t.slug}/src/${t.slug}-adapter.ts); w=$(wc -l < packages/${t.slug}/src/webhook-normalizer.ts); [ "$a" -ge 400 ] || { echo "${t.slug}-adapter.ts $a lines, need >=400"; exit 1; }; [ "$w" -ge 200 ] || { echo "webhook-normalizer.ts $w lines, need >=200"; exit 1; }; echo "LINE_FLOOR_${t.slug.toUpperCase()}_OK"`;

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

async function main() {
  if (BATCH_KEY === 'finalize') {
    const result = await workflow('tier1-adapters-finalize')
      .description('Finalize the 16 Tier-1 SaaS adapters: monorepo build/test, catalog update, final review')
      .pattern('dag')
      .channel('wf-tier1-adapters-finalize')
      .maxConcurrency(2)
      .timeout(2_400_000)
      .agent('builder', { cli: 'codex', preset: 'worker', role: 'Updates the catalog' })
      .agent('reviewer', { cli: 'claude', role: 'Reviews adapter quality across all 16' })

      .step('monorepo-build', {
        type: 'deterministic',
        command: 'npm run build',
        captureOutput: true,
        failOnError: true,
      })
      .step('monorepo-test', {
        type: 'deterministic',
        dependsOn: ['monorepo-build'],
        command: 'npm run test',
        captureOutput: true,
        failOnError: true,
      })
      .step('catalog-update', {
        agent: 'builder',
        dependsOn: ['monorepo-test'],
        task: `Update scripts/launch-catalog.mjs to mark these 16 entries existing: true with route lists pulled from each package's queries.ts and writeback.ts:

${ADAPTERS.map((t) => `  - ${t.slug} (${t.pkgName})`).join('\n')}

Then run \`npm run catalog:audit\` and confirm CATALOG_AUDIT_OK with entries >= 50, T1 count incremented, beats_mirage_by >= 22.

End with CATALOG_UPDATE_COMPLETE.`,
        verification: { type: 'output_contains', value: 'CATALOG_UPDATE_COMPLETE' },
        timeout: 600_000,
      })
      .step('catalog-audit-gate', {
        type: 'deterministic',
        dependsOn: ['catalog-update'],
        command:
          'npm run catalog:audit 2>&1 | tee /tmp/catalog-audit.log; grep -Eq "^CATALOG_AUDIT_OK " /tmp/catalog-audit.log',
        captureOutput: true,
        failOnError: true,
      })
      .step('final-review', {
        agent: 'reviewer',
        dependsOn: ['catalog-audit-gate'],
        task: `Review the 16 newly-scaffolded adapter packages plus the catalog update.

For each package under packages/{${ADAPTERS.map((t) => t.slug).join(',')}}/, sample-check:
  - Webhook normalizer uses real createHmac + timingSafeEqual (no plaintext compare)
  - Adapter extends IntegrationAdapter and implements ingestWebhook, computePath, computeSemantics
  - Path mapper produces deterministic paths
  - Writeback maps to actual API verbs (PUT/PATCH/POST), not stubs
  - Tests cover the signature accept-and-reject cases with realistic payloads (not "foo": "bar")

Flag any adapter that looks like a stub gaming the line floor.
End with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
        verification: { type: 'output_contains', value: 'FINAL_REVIEW_PASS' },
        timeout: 1_800_000,
      })
      .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
      .run({ cwd: process.cwd() });

    console.log('Finalize:', result.status);
    return;
  }

  // Batch 1-4
  const targets = BATCHES[BATCH_KEY]!;
  let wf = workflow(`tier1-adapters-batch-${BATCH_KEY}`)
    .description(
      `Scaffold 4 Tier-1 SaaS adapters (batch ${BATCH_KEY}/${4}): ${targets.map((t) => t.slug).join(', ')}.`,
    )
    .pattern('dag')
    .channel(`wf-tier1-adapters-batch-${BATCH_KEY}`)
    .maxConcurrency(4)
    .timeout(2_400_000) // 40 min — fits ricky's 45 min wallclock
    .agent('builder', { cli: 'codex', preset: 'worker', role: 'Writes adapter code' });

  const lineFloors: string[] = [];
  for (const t of targets) {
    const IMPL = `impl-${t.slug}`;
    const TYPECHECK = `typecheck-${t.slug}`;
    const TEST = `test-${t.slug}`;
    const WEBHOOK = `webhook-fixture-${t.slug}`;
    const ANCHORS = `anchors-${t.slug}`;
    const LINES = `line-floor-${t.slug}`;

    wf = wf
      .step(IMPL, {
        agent: 'builder',
        task: implementTask(t),
        verification: { type: 'output_contains', value: `IMPL_${t.slug.toUpperCase()}_COMPLETE` },
        timeout: 1_500_000, // 25 min per adapter
      })
      .step(TYPECHECK, {
        type: 'deterministic',
        dependsOn: [IMPL],
        command: TYPECHECK_GATE(t),
        captureOutput: true,
        failOnError: true,
      })
      .step(TEST, {
        type: 'deterministic',
        dependsOn: [TYPECHECK],
        command: TEST_GATE(t),
        captureOutput: true,
        failOnError: true,
      })
      .step(WEBHOOK, {
        type: 'deterministic',
        dependsOn: [TEST],
        command: FIXTURE_GATE(t),
        captureOutput: true,
        failOnError: true,
      })
      .step(ANCHORS, {
        type: 'deterministic',
        dependsOn: [WEBHOOK],
        command: ANCHOR_GATE(t),
        captureOutput: true,
        failOnError: true,
      })
      .step(LINES, {
        type: 'deterministic',
        dependsOn: [ANCHORS],
        command: LINE_FLOOR_GATE(t),
        captureOutput: true,
        failOnError: true,
      });

    lineFloors.push(LINES);
  }

  wf = wf.step(`batch-${BATCH_KEY}-summary`, {
    type: 'deterministic',
    dependsOn: lineFloors,
    command: `echo "BATCH_${BATCH_KEY}_OK adapters=${targets.map((t) => t.slug).join(',')}"`,
    captureOutput: true,
    failOnError: true,
  });

  const result = await wf
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log(`Batch ${BATCH_KEY}:`, result.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
