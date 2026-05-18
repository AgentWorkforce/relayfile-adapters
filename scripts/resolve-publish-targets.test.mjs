import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const corePackage = JSON.parse(readFileSync(new URL('../packages/core/package.json', import.meta.url), 'utf8'));
const publishedCoreVersion = `${corePackage.name}@${corePackage.version}`;

async function resolveTargets(input, env = {}) {
  const { stdout } = await execFileAsync('node', [
    'scripts/resolve-publish-targets.mjs',
    input,
  ], {
    env: { ...process.env, ...env },
  });
  const match = stdout.match(/^packages=(.*)$/m);
  assert.ok(match, `expected packages= output, got ${stdout}`);
  return match[1].trim().split(/\s+/);
}

async function resolveTargetsRaw(input, env = {}) {
  return execFileAsync('node', [
    'scripts/resolve-publish-targets.mjs',
    input,
  ], {
    env: { ...process.env, ...env },
  });
}

function assertBefore(list, dependency, dependent) {
  const dependencyIndex = list.indexOf(dependency);
  const dependentIndex = list.indexOf(dependent);
  assert.notEqual(dependencyIndex, -1, `expected ${dependency} in ${list.join(' ')}`);
  assert.notEqual(dependentIndex, -1, `expected ${dependent} in ${list.join(' ')}`);
  assert.ok(
    dependencyIndex < dependentIndex,
    `expected ${dependency} before ${dependent} in ${list.join(' ')}`,
  );
}

test('publish all orders internal dependencies before dependents', async () => {
  const list = await resolveTargets('all');

  for (const dependent of [
    'azure-blob',
    'box',
    'dropbox',
    'gcs',
    'github',
    'gmail',
    'google-drive',
    'onedrive',
    'postgres',
    'redis',
    's3',
    'sharepoint',
  ]) {
    assertBefore(list, 'core', dependent);
  }
});

test('explicit mixed package input is topologically sorted', async () => {
  const list = await resolveTargets('github,core');

  assert.deepEqual(list, ['core', 'github']);
});

test('group aliases include required internal dependencies', async () => {
  const list = await resolveTargets('storage');

  assertBefore(list, 'core', 'azure-blob');
  assertBefore(list, 'core', 'sharepoint');
});

test('explicit package input includes required internal dependencies', async () => {
  const list = await resolveTargets('github');

  assert.deepEqual(list, ['core', 'github']);
});

test('current-version publish skips already-published internal dependencies', async () => {
  const list = await resolveTargets('gitlab', {
    INPUT_VERSION: 'none',
    RESOLVE_PUBLISH_TARGETS_NPM_PUBLISHED: publishedCoreVersion,
  });

  assert.deepEqual(list, ['gitlab']);
});

test('current-version publish exits cleanly when every resolved package is already published', async () => {
  const result = await resolveTargetsRaw('core', {
    INPUT_VERSION: 'none',
    RESOLVE_PUBLISH_TARGETS_NPM_PUBLISHED: publishedCoreVersion,
  });

  assert.equal(result.stdout, 'packages=\n');
  assert.match(result.stderr, /nothing to publish/);
});

test('missing publish skips already-published internal dependencies', async () => {
  const list = await resolveTargets('missing', {
    RESOLVE_PUBLISH_TARGETS_NPM_PUBLISHED: publishedCoreVersion,
  });

  assert.ok(list.includes('gitlab'), `expected gitlab in ${list.join(' ')}`);
  assert.ok(!list.includes('core'), `did not expect core in ${list.join(' ')}`);
});
