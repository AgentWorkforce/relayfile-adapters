import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const forbidden = /(?:node_modules\/(?:cheerio(?:-select)?|parse5(?:-[^/]+)?|htmlparser2|iconv-lite|yaml|@scalar\/postman-to-openapi)\/|packages\/core\/dist\/src\/(?:docs|ingest|generate|drift)\/|\/catalog-generator\.js$|\/spec\/parser\.js$)/;

for (const treeShaking of [true, false]) {
  test(`runtime bundle excludes tooling (treeShaking=${treeShaking})`, async () => {
    const result = await build({
      absWorkingDir: repoRoot,
      stdin: {
        // Re-export to keep both helpers live: an unused import proves nothing.
        contents: 'export { fetchWithRetry, modelBucket } from "@relayfile/adapter-core";',
        resolveDir: repoRoot,
        sourcefile: 'runtime-consumer.js',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      treeShaking,
      // Also exercise consumers that disregard package sideEffects annotations.
      ignoreAnnotations: !treeShaking,
      minify: true,
      write: false,
      metafile: true,
    });
    const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/'));
    assert.ok(inputs.some(path => path.endsWith('core/dist/src/index.js')), 'must use the published root entry');
    assert.deepEqual(inputs.filter(path => forbidden.test(path)), [], 'tooling must not even be resolved');
    assert.deepEqual(Object.values(result.metafile.outputs).flatMap(output => output.exports).sort(), ['fetchWithRetry', 'modelBucket']);
    const bytes = gzipSync(result.outputFiles[0].contents).byteLength;
    if (treeShaking) {
      assert.ok(bytes < 10_000, `runtime helpers exceed the 10 KB gzip budget: ${bytes} bytes`);
      const runtime = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
      assert.equal(typeof runtime.fetchWithRetry, 'function');
      assert.equal(typeof runtime.modelBucket, 'function');
    }
    console.log(`runtime bundle (treeShaking=${treeShaking}): ${bytes} bytes gzip`);
  });
}

test('published CLI resolves tooling subpaths', () => {
  const help = execFileSync(process.execPath, ['packages/core/dist/src/cli.js', 'help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  for (const command of ['generate', 'validate', 'docs-to-spec', 'docs-update', 'docs-check']) {
    assert.ok(help.includes(command), `missing CLI command: ${command}`);
  }
});

test('GitHub runtime resolves only the narrow YAML mapping parser', async () => {
  const result = await build({
    absWorkingDir: repoRoot,
    stdin: {
      contents: 'export { GitHubAdapter } from "@relayfile/adapter-github";',
      resolveDir: repoRoot,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    treeShaking: false,
    ignoreAnnotations: true,
    write: false,
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/'));
  assert.ok(inputs.some(path => path.endsWith('core/dist/src/spec/parser.js')));
  assert.ok(inputs.some(path => path.includes('node_modules/yaml/')));
  assert.deepEqual(inputs.filter(path => forbidden.test(path)
    && !path.includes('node_modules/yaml/')
    && !path.endsWith('core/dist/src/spec/parser.js')), []);
  assert.deepEqual(Object.values(result.metafile.outputs).flatMap(output => output.exports), ['GitHubAdapter']);
});

test('public ingest/generate subpaths and CLI generate work offline', async () => {
  const ingest = await import('@relayfile/adapter-core/ingest');
  const generate = await import('@relayfile/adapter-core/generate');
  const dir = await mkdtemp(join(tmpdir(), 'core-tooling-'));
  try {
    await writeFile(join(dir, 'widget.created.json'), JSON.stringify({ id: '123', title: 'Widget' }));
    const specPath = join(dir, 'widgets.mapping.yaml');
    await writeFile(specPath, `adapter:
  name: widgets
  version: "1.0.0"
  source:
    samples: ./widget.created.json
webhooks:
  widget.created:
    path: /widgets/items/{{id}}.json
`);
    const mapping = await ingest.loadMappingSpec(specPath);
    const service = await ingest.loadServiceSpecFromMapping(mapping, dir);
    assert.equal(ingest.validateMappingSpec(mapping, service).valid, true);
    assert.match(generate.generateTypeDefinitions(service), /WidgetCreatedWebhook/);
    for (const name of ['writeTriggerCatalog', 'writeScopeKeyCatalog', 'writeWritebackPathCatalog', 'writeInboundCapabilityCatalog', 'detectDrift']) {
      assert.equal(typeof generate[name], 'function', `${name} must be public`);
    }
    const outdir = join(dir, 'generated');
    execFileSync(process.execPath, ['packages/core/dist/src/cli.js', 'generate', '--spec', specPath, '--outdir', outdir], { cwd: repoRoot });
    assert.match(await readFile(join(outdir, 'adapter.generated.ts'), 'utf8'), /widget.created/);
    assert.match(await readFile(join(outdir, 'types.generated.ts'), 'utf8'), /WidgetCreatedWebhook/);
    assert.deepEqual(JSON.parse(await readFile(join(outdir, 'service-spec.snapshot.json'), 'utf8')), JSON.parse(JSON.stringify(service)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
