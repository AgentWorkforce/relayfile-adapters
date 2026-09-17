import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('the committed adapter mapping bundle matches every adapter', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts/bundle-adapter-mappings.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('the bundle resolves from the package the way a consumer reads it', () => {
  // AgentWorkforce/flows: join(dirname(require.resolve('@relayfile/adapter-core/package.json')), 'mappings').
  const require = createRequire(join(root, 'packages/github/package.json'));
  const mappings = join(dirname(require.resolve('@relayfile/adapter-core/package.json')), 'mappings');
  const fallbacks = readdirSync(mappings).filter((name) => name.endsWith('.mapping.yaml'));
  const bundled = readdirSync(join(mappings, 'adapters')).filter((name) => name.endsWith('.mapping.yaml'));
  assert.deepEqual(fallbacks.sort(), ['github.mapping.yaml', 'slack.mapping.yaml']);
  assert.ok(bundled.length >= 25, `expected the adapter bundle, found ${bundled.length}`);
  for (const name of bundled) {
    const provider = name.replace('.mapping.yaml', '');
    assert.equal(readFileSync(join(mappings, 'adapters', name), 'utf8'),
      readFileSync(join(root, 'packages', provider, name), 'utf8'), `${name} differs from its adapter`);
  }
  const pkg = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));
  assert.ok(pkg.files.includes('mappings'), 'mappings/ must be in files so the bundle is published');
});
