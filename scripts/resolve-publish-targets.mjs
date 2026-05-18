#!/usr/bin/env node
// Resolve the `package` workflow_dispatch input into a space-separated list
// of packages/ directory names to publish. Writes `packages=...` to stdout
// for capture into $GITHUB_OUTPUT.
//
// Accepts:
//   all                         every non-private workspace package
//   missing                     only packages whose current version is not on npm
//   <group>                     a predefined group alias (see GROUPS below)
//   <name>[,<name>...]          one or more package dir names (comma or whitespace separated)
//
// Tokens may be combined; a token may itself be a group alias, so
// "crm,messaging,slack" expands and de-duplicates correctly.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const pkgsDir = join(repoRoot, 'packages');

const GROUPS = {
  storage: ['azure-blob', 'box', 'dropbox', 'gcs', 'google-drive', 'onedrive', 's3', 'sharepoint'],
  messaging: ['gmail', 'slack', 'teams'],
  calendar: ['google-calendar'],
  devtools: ['github', 'gitlab'],
  crm: ['hubspot', 'salesforce', 'pipedrive'],
  pm: ['asana', 'clickup', 'jira', 'linear', 'notion'],
  support: ['intercom', 'zendesk'],
  analytics: ['mixpanel', 'segment'],
  email: ['mailgun', 'sendgrid'],
  commerce: ['shopify', 'stripe'],
  db: ['postgres', 'redis'],
  social: ['x'],
};

function listPublishablePackages() {
  return readdirSync(pkgsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(pkgsDir, d.name, 'package.json')))
    .filter((d) => {
      const pkg = JSON.parse(readFileSync(join(pkgsDir, d.name, 'package.json'), 'utf8'));
      return !pkg.private;
    })
    .map((d) => d.name)
    .sort();
}

function readPackage(dir) {
  return JSON.parse(readFileSync(join(pkgsDir, dir, 'package.json'), 'utf8'));
}

function dependencyNames(pkg) {
  return [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ].flatMap((section) => Object.keys(pkg[section] ?? {}));
}

function sortByInternalDependencies(packageDirs) {
  let selected = [...new Set(packageDirs)].sort();
  const selectedSet = new Set(selected);
  const nameToDir = new Map();
  const packages = new Map();

  for (const dir of listPublishablePackages()) {
    const pkg = readPackage(dir);
    packages.set(dir, pkg);
    if (pkg.name) {
      nameToDir.set(pkg.name, dir);
    }
  }

  const queue = [...selected];
  while (queue.length > 0) {
    const dir = queue.shift();
    const pkg = packages.get(dir) ?? readPackage(dir);

    for (const name of dependencyNames(pkg)) {
      const depDir = nameToDir.get(name);
      if (!depDir || selectedSet.has(depDir)) continue;

      selectedSet.add(depDir);
      queue.push(depDir);
    }
  }
  selected = [...selectedSet].sort();

  const dependenciesByDir = new Map(
    selected.map((dir) => {
      const pkg = packages.get(dir) ?? readPackage(dir);
      const deps = dependencyNames(pkg)
        .map((name) => nameToDir.get(name))
        .filter((depDir) => depDir && selectedSet.has(depDir))
        .sort();
      return [dir, deps];
    }),
  );

  const sorted = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(dir) {
    if (visited.has(dir)) return;
    if (visiting.has(dir)) {
      throw new Error(`Internal dependency cycle includes ${dir}`);
    }

    visiting.add(dir);
    for (const depDir of dependenciesByDir.get(dir) ?? []) {
      visit(depDir);
    }
    visiting.delete(dir);
    visited.add(dir);
    sorted.push(dir);
  }

  for (const dir of selected) {
    visit(dir);
  }

  return sorted;
}

async function versionOnNpm(name, version) {
  const mockedPublished = process.env.RESOLVE_PUBLISH_TARGETS_NPM_PUBLISHED;
  if (mockedPublished !== undefined) {
    const published = new Set(
      mockedPublished
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    return published.has(`${name}@${version}`);
  }

  const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}/${version}`;
  const res = await fetch(url);
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`Unexpected status ${res.status} for ${name}@${version}`);
}

async function resolveMissing() {
  const all = listPublishablePackages();
  const out = [];
  for (const dir of all) {
    const pkg = readPackage(dir);
    const exists = await versionOnNpm(pkg.name, pkg.version);
    if (!exists) out.push(dir);
  }
  return out;
}

async function filterAlreadyPublished(packageDirs) {
  const out = [];
  for (const dir of packageDirs) {
    const pkg = readPackage(dir);
    if (!(await versionOnNpm(pkg.name, pkg.version))) {
      out.push(dir);
    }
  }
  return out;
}

async function main() {
  const input = (process.argv[2] || '').trim();
  if (!input) {
    console.error('error: empty package input');
    process.exit(2);
  }

  const all = listPublishablePackages();
  const validNames = new Set(all);
  const tokens = input.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);

  const out = new Set();
  const errors = [];
  let includesMissingToken = false;

  for (const token of tokens) {
    if (token === 'all') {
      all.forEach((p) => out.add(p));
    } else if (token === 'missing') {
      includesMissingToken = true;
      const missing = await resolveMissing();
      missing.forEach((p) => out.add(p));
    } else if (GROUPS[token]) {
      GROUPS[token].forEach((p) => {
        if (!validNames.has(p)) {
          errors.push(`group "${token}" references unknown package "${p}"`);
          return;
        }
        out.add(p);
      });
    } else if (validNames.has(token)) {
      out.add(token);
    } else {
      errors.push(`unknown package or group: "${token}"`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`valid packages: ${all.join(', ')}`);
    console.error(`valid groups: ${Object.keys(GROUPS).join(', ')}, all, missing`);
    process.exit(1);
  }

  if (out.size === 0) {
    console.error('error: no packages resolved');
    process.exit(1);
  }

  let list = sortByInternalDependencies([...out]);
  const resolvedCount = list.length;
  if (
    includesMissingToken
    || process.env.INPUT_VERSION === 'none'
    || process.env.RESOLVE_PUBLISH_TARGETS_SKIP_PUBLISHED === '1'
  ) {
    list = await filterAlreadyPublished(list);
  }

  if (list.length === 0) {
    if (resolvedCount > 0) {
      console.error('nothing to publish');
      process.stdout.write('packages=\n');
      process.exit(0);
    }
    console.error('error: no unpublished packages resolved');
    process.exit(1);
  }

  console.error(`Resolved ${list.length} package(s): ${list.join(' ')}`);
  process.stdout.write(`packages=${list.join(' ')}\n`);
}

await main();
