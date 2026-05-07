#!/usr/bin/env node
/**
 * verify-aggregate.mjs
 *
 * Reads .workflow-artifacts/verify/*.json (drift reports produced by
 * workflows/044-tier1-verify.ts) and prints a summary table. Exits non-zero
 * if any adapter has DRIFT verdict (with at least one blocker finding) so
 * that the workflow's deterministic gate can fail-fast.
 *
 * Usage:  node scripts/verify-aggregate.mjs [batchLabel]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.workflow-artifacts/verify';
const batchLabel = process.argv[2] ?? '';

let entries;
try {
  entries = readdirSync(DIR).filter((f) => f.endsWith('-drift.json'));
} catch (err) {
  console.error(`Cannot read ${DIR}: ${err.message}`);
  process.exit(1);
}

if (entries.length === 0) {
  console.error(`No drift reports found under ${DIR}`);
  process.exit(1);
}

const reports = entries
  .map((f) => {
    try {
      return JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    } catch (err) {
      console.error(`Bad JSON in ${f}: ${err.message}`);
      return null;
    }
  })
  .filter((r) => r != null);

console.log(`=== Tier-1 verify summary${batchLabel ? ` (batch ${batchLabel})` : ''} ===`);
let blockerTotal = 0;
let majorTotal = 0;
let driftCount = 0;

for (const r of reports.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const findings = r.findings || [];
  const blockers = findings.filter((f) => f.severity === 'blocker').length;
  const majors = findings.filter((f) => f.severity === 'major').length;
  const minors = findings.filter((f) => f.severity === 'minor').length;
  blockerTotal += blockers;
  majorTotal += majors;
  if (r.verdict === 'DRIFT') driftCount += 1;
  console.log(
    `  ${r.slug.padEnd(14)} ${String(r.verdict).padEnd(6)} blockers=${blockers} majors=${majors} minors=${minors}`,
  );
}

console.log('');
console.log(
  `Totals: ${reports.length} adapters, ${driftCount} DRIFT, ${blockerTotal} blockers, ${majorTotal} majors`,
);

if (driftCount > 0 || blockerTotal > 0) {
  console.error('');
  console.error('Inspect .workflow-artifacts/verify/<slug>-drift.json for details. Fix before merge.');
  process.exit(1);
}

console.log(`VERIFY${batchLabel ? `_BATCH_${batchLabel}` : ''}_PASS`);
