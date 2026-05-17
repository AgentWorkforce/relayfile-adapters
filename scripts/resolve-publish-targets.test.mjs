import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

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
    RESOLVE_PUBLISH_TARGETS_NPM_PUBLISHED: '@relayfile/adapter-core@0.2.24',
  });

  assert.deepEqual(list, ['gitlab']);
});

test('missing publish skips already-published internal dependencies', async () => {
  const list = await resolveTargets('missing', {
    RESOLVE_PUBLISH_TARGETS_NPM_PUBLISHED: '@relayfile/adapter-core@0.2.24',
  });

  assert.ok(list.includes('gitlab'), `expected gitlab in ${list.join(' ')}`);
  assert.ok(!list.includes('core'), `did not expect core in ${list.join(' ')}`);
});
