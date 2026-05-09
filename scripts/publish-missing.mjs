#!/usr/bin/env node
// Publish workspace packages whose current name@version is not yet on npm.
// Iterates all packages/*, checks the npm registry for the local version,
// and runs `npm publish --access public` for any that are missing.
//
// Flags:
//   --dry-run   Show what would be published without invoking npm publish.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const pkgsDir = join(repoRoot, 'packages');
const dryRun = process.argv.includes('--dry-run');

async function versionExistsOnNpm(name, version) {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}/${version}`;
  const res = await fetch(url);
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`Unexpected status ${res.status} for ${name}@${version}`);
}

const dirs = readdirSync(pkgsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(pkgsDir, d.name));

const missing = [];
const existing = [];
const skipped = [];

for (const dir of dirs) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    skipped.push({ dir, reason: 'no package.json' });
    continue;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.private) {
    skipped.push({ dir, name: pkg.name, reason: 'private' });
    continue;
  }
  const exists = await versionExistsOnNpm(pkg.name, pkg.version);
  if (exists) {
    existing.push({ dir, name: pkg.name, version: pkg.version });
  } else {
    missing.push({ dir, name: pkg.name, version: pkg.version });
  }
}

console.log(`Already published (${existing.length}):`);
for (const p of existing) console.log(`  - ${p.name}@${p.version}`);
console.log(`\nSkipped (${skipped.length}):`);
for (const p of skipped) console.log(`  - ${p.name ?? p.dir} (${p.reason})`);
console.log(`\nMissing — to publish (${missing.length}):`);
for (const p of missing) console.log(`  - ${p.name}@${p.version}`);

if (dryRun) {
  console.log('\n--dry-run: not invoking npm publish.');
  process.exit(0);
}

if (missing.length === 0) {
  console.log('\nNothing to publish.');
  process.exit(0);
}

const failures = [];
const succeeded = [];

for (const p of missing) {
  console.log(`\n=== Publishing ${p.name}@${p.version} ===`);
  const result = spawnSync('npm', ['publish', '--access', 'public'], {
    cwd: p.dir,
    stdio: 'inherit',
  });
  if (result.status === 0) {
    succeeded.push(p);
  } else {
    failures.push({ ...p, code: result.status });
  }
}

console.log(`\n=== Summary ===`);
console.log(`Published: ${succeeded.length}`);
for (const p of succeeded) console.log(`  ✓ ${p.name}@${p.version}`);
if (failures.length) {
  console.log(`Failed: ${failures.length}`);
  for (const p of failures) console.log(`  ✗ ${p.name}@${p.version} (exit ${p.code})`);
  process.exit(1);
}
