#!/usr/bin/env node
// Keep published workspace dependency ranges aligned with local package versions.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const packagesDir = join(repoRoot, 'packages');
const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const checkOnly = process.argv.includes('--check');

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packageJsonPath(dirName) {
  return join(packagesDir, dirName, 'package.json');
}

const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name)
  .filter((dirName) => existsSync(packageJsonPath(dirName)))
  .sort();

const internalVersions = new Map();
for (const dirName of packageDirs) {
  const pkg = readPackageJson(packageJsonPath(dirName));
  if (pkg.name?.startsWith('@relayfile/') && pkg.version) {
    internalVersions.set(pkg.name, pkg.version);
  }
}

const updates = [];

for (const dirName of packageDirs) {
  const path = packageJsonPath(dirName);
  const pkg = readPackageJson(path);
  let changed = false;

  for (const section of dependencySections) {
    const deps = pkg[section];
    if (!deps) continue;

    for (const [name, currentRange] of Object.entries(deps)) {
      const version = internalVersions.get(name);
      if (!version) continue;

      const expectedRange = `^${version}`;
      if (currentRange === expectedRange) continue;

      deps[name] = expectedRange;
      changed = true;
      updates.push({
        file: `packages/${dirName}/package.json`,
        section,
        name,
        from: currentRange,
        to: expectedRange,
      });
    }
  }

  if (changed && !checkOnly) {
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

if (updates.length === 0) {
  console.log('Internal dependency specifiers are already in sync.');
  process.exit(0);
}

for (const update of updates) {
  console.log(
    `${update.file}: ${update.section}.${update.name} ${update.from} -> ${update.to}`,
  );
}

if (checkOnly) {
  console.error(`Found ${updates.length} stale internal dependency specifier(s).`);
  process.exit(1);
}

console.log(`Updated ${updates.length} internal dependency specifier(s).`);
