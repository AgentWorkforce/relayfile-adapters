#!/usr/bin/env node
// Bundle every adapter's mapping YAML into @relayfile/adapter-core's shipped
// `mappings/adapters/` directory, so a consumer that only depends on the core
// package (AgentWorkforce/flows generates its trigger namespaces this way)
// sees each adapter's own `webhooks:` block, not just the two core fallbacks.
//
// Layout of the published package:
//   mappings/<provider>.mapping.yaml           core fallbacks (github, slack) — unchanged
//   mappings/adapters/<provider>.mapping.yaml  verbatim copy of packages/<adapter>/<provider>.mapping.yaml
//
// Consumers apply adapter-local over fallback, matching the precedence
// flows' generator already uses against a repo checkout. The copies are
// committed (like every other generated catalog here) and `--check` fails the
// build when they drift, so the tarball can never ship a stale bundle.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = join(root, 'packages');
const bundleDir = join(packages, 'core', 'mappings', 'adapters');
const check = process.argv.includes('--check');

const expected = new Map();
for (const entry of (await readdir(packages, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || entry.name === 'core') continue;
  const dir = join(packages, entry.name);
  for (const name of (await readdir(dir)).sort()) {
    if (!name.endsWith('.mapping.yaml')) continue;
    if (expected.has(name)) {
      throw new Error(`Two adapters ship ${name}: ${expected.get(name).source} and packages/${entry.name}`);
    }
    expected.set(name, { source: `packages/${entry.name}`, content: await readFile(join(dir, name), 'utf8') });
  }
}
if (expected.size === 0) throw new Error('No adapter mapping YAML found under packages/*/');

const actual = new Map();
if (existsSync(bundleDir)) {
  for (const name of (await readdir(bundleDir)).sort()) {
    if (name.endsWith('.mapping.yaml')) actual.set(name, await readFile(join(bundleDir, name), 'utf8'));
  }
}

const missing = [...expected.keys()].filter((name) => !actual.has(name));
const stale = [...expected].filter(([name, { content }]) => actual.has(name) && actual.get(name) !== content).map(([name]) => name);
const orphaned = [...actual.keys()].filter((name) => !expected.has(name));

if (check) {
  const problems = [
    ...missing.map((name) => `missing from bundle: ${name}`),
    ...stale.map((name) => `stale in bundle: ${name}`),
    ...orphaned.map((name) => `no adapter owns bundled ${name}`),
  ];
  if (problems.length) {
    console.error(`packages/core/mappings/adapters is out of date; run \`npm run mappings:bundle -w @relayfile/adapter-core\`:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Bundled adapter mappings verified: ${expected.size} providers`);
} else {
  await rm(bundleDir, { recursive: true, force: true });
  await mkdir(bundleDir, { recursive: true });
  for (const [name, { content }] of expected) await writeFile(join(bundleDir, name), content);
  console.log(`Bundled ${expected.size} adapter mappings into packages/core/mappings/adapters`);
}
