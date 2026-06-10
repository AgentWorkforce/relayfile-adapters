// Verify the writeback-path catalog drift check cannot be fooled by stale builds.
//
// `adapter-core writeback-paths check` prefers each adapter's built
// `dist/resources.js`, so a stale dist can mask drift between `src/resources.ts`
// and `packages/core/src/writeback-paths/catalog.generated.*` (it then fails in
// CI where builds are always fresh). The turbo task
// `@relayfile/adapter-core#catalog:check` therefore declares a `dependsOn`
// edge to every workspace package's `build`. This script keeps that dependsOn
// list in sync with the actual workspaces so a newly added package cannot
// silently fall out of the freshness guarantee.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CATALOG_CHECK_TASK = '@relayfile/adapter-core#catalog:check';

const turbo = JSON.parse(await readFile(join(root, 'turbo.json'), 'utf8'));
const task = turbo.tasks?.[CATALOG_CHECK_TASK];

const failures = [];

if (!task) {
  failures.push(`turbo.json is missing the "${CATALOG_CHECK_TASK}" task`);
} else {
  if (task.cache !== false) {
    failures.push(`"${CATALOG_CHECK_TASK}" must set "cache": false so the drift check always re-runs`);
  }

  const dependsOn = new Set(Array.isArray(task.dependsOn) ? task.dependsOn : []);
  if (!dependsOn.has('build')) {
    failures.push(`"${CATALOG_CHECK_TASK}" dependsOn must include "build" (core's own CLI build)`);
  }

  const packageNames = [];
  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let packageJson;
    try {
      packageJson = JSON.parse(await readFile(join(root, 'packages', entry.name, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (typeof packageJson.name === 'string') {
      packageNames.push(packageJson.name);
    }
  }

  for (const name of packageNames.sort()) {
    if (name === '@relayfile/adapter-core') continue;
    if (!dependsOn.has(`${name}#build`)) {
      failures.push(`"${CATALOG_CHECK_TASK}" dependsOn is missing "${name}#build" — the catalog check would read a stale dist for that package`);
    }
  }

  for (const dep of dependsOn) {
    if (dep === 'build') continue;
    const name = dep.replace(/#build$/, '');
    if (!dep.endsWith('#build') || !packageNames.includes(name)) {
      failures.push(`"${CATALOG_CHECK_TASK}" dependsOn references unknown package task "${dep}"`);
    }
  }
}

const corePackageJson = JSON.parse(
  await readFile(join(root, 'packages', 'core', 'package.json'), 'utf8'),
);
if (typeof corePackageJson.scripts?.['catalog:check'] !== 'string') {
  failures.push('packages/core/package.json must define a "catalog:check" script (adapter-core writeback-paths check)');
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Verified ${CATALOG_CHECK_TASK} turbo task covers all workspace package builds.`);
