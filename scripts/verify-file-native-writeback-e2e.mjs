#!/usr/bin/env node
// scripts/verify-file-native-writeback-e2e.mjs
//
// Issue #45 acceptance gate: prove the file-native writeback contract end-to-
// end through @relayfile/adapter-core's shared router for the concrete Linear
// flow, plus sanity-check that every workspace adapter ships the discovery
// assets the router needs (resources.ts + schemas + examples).
//
// REQUIRED runtime helpers exported from @relayfile/adapter-core:
//   classifyWrite(path, resources, opts?)
//   validatePayload(payload, schema, op)             // op: 'create' | 'patch'
//   class ReadOnlyFieldError extends Error           // .field
//   class WritebackValidationError extends Error     // .field?, .reason
//   recordWritebackStatus(entry)                     // { path, op, outcome, error?, field?, timestamp }
//   listWritebackStatus(filter?)
//
// Required Linear adapter exports from @relayfile/adapter-linear/writeback:
//   resolveWritebackRequest(path, content)           // returns { action, method, endpoint, body }
//   class ReadOnlyFieldError                         // adapter-local, reused for the regression assertion
//
// Env knobs (no production effect):
//   ISSUE45_E2E_VERBOSE=1     — print every passing scenario in detail
//   ISSUE45_E2E_LINEAR_ONLY=1 — skip cross-adapter discovery sanity sweep
//   ISSUE45_E2E_NO_BUILD=1    — assume dist/ is present, do not run npm build
//
// Exit 0 iff every required scenario passes; non-zero on any failure.

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const verbose = process.env.ISSUE45_E2E_VERBOSE === '1';
const linearOnly = process.env.ISSUE45_E2E_LINEAR_ONLY === '1';
const skipBuild = process.env.ISSUE45_E2E_NO_BUILD === '1';

const failures = [];
const passes = [];

function pass(name, detail) {
  passes.push(detail ? `${name} — ${detail}` : name);
}

function fail(name, err) {
  failures.push(`${name}: ${err}`);
}

function ensureBuild(workspace, distMarker) {
  if (skipBuild) return;
  if (existsSync(join(root, distMarker))) return;
  console.error(`[e2e] building ${workspace} (missing ${distMarker})...`);
  try {
    execSync(`npm run build -w ${workspace} --silent`, { stdio: 'inherit', cwd: root });
  } catch (e) {
    throw new Error(`failed to build ${workspace}: ${e.message}`);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function safeImport(specifier) {
  try {
    return await import(specifier);
  } catch (e) {
    return { __error: e };
  }
}

const PAGE_UUID = '2fd6800c-1c90-80ea-9ec8-fe4a0daa66b8';

// ---------------------------------------------------------------------------
// Section 1 — Discovery readability (the agent-facing contract)
// ---------------------------------------------------------------------------
async function section1Discovery() {
  const adapterMdPath = join(root, 'packages/linear/discovery/linear/.adapter.md');
  let adapterMd;
  try {
    adapterMd = await readFile(adapterMdPath, 'utf8');
  } catch {
    fail('discovery: read /linear/.adapter.md', `missing ${adapterMdPath}`);
    return null;
  }
  if (!adapterMd.includes('## Operations') || !adapterMd.includes('## ID Patterns')) {
    fail('discovery: /linear/.adapter.md sections', 'must contain "## Operations" and "## ID Patterns"');
    return null;
  }
  pass('discovery: read /linear/.adapter.md');

  const schemaPath = join(root, 'packages/linear/discovery/linear/issues/.schema.json');
  let schema;
  try {
    schema = await readJson(schemaPath);
  } catch (e) {
    fail('discovery: read /linear/issues/.schema.json', e.message);
    return null;
  }
  if (!Array.isArray(schema.required) || !schema.required.includes('teamId') || !schema.required.includes('title')) {
    fail('discovery: schema.required', 'must include teamId and title');
    return null;
  }
  if (schema.additionalProperties !== false) {
    fail('discovery: schema.additionalProperties', 'must be false (strict)');
    return null;
  }
  if (schema.properties?.id?.readOnly !== true) {
    fail('discovery: schema.properties.id.readOnly', 'id must be marked readOnly: true');
    return null;
  }
  pass('discovery: read /linear/issues/.schema.json (required, additionalProperties, readOnly)');

  const examplePath = join(root, 'packages/linear/discovery/linear/issues/.create.example.json');
  let example;
  try {
    example = await readJson(examplePath);
  } catch (e) {
    fail('discovery: read /linear/issues/.create.example.json', e.message);
    return null;
  }
  for (const required of schema.required) {
    if (!(required in example)) {
      fail(`discovery: create example missing required field "${required}"`, '');
      return null;
    }
  }
  pass('discovery: /linear/issues/.create.example.json satisfies required fields');

  return { schema, example };
}

// ---------------------------------------------------------------------------
// Section 2 — Core runtime helpers (classifyWrite / validatePayload / status)
// ---------------------------------------------------------------------------
async function section2Runtime(schema) {
  let coreEntry;
  try {
    ensureBuild('@relayfile/adapter-core', 'packages/core/dist/src/index.js');
    coreEntry = pathToFileURL(join(root, 'packages/core/dist/src/index.js')).href;
  } catch (e) {
    fail('runtime: build @relayfile/adapter-core', e.message);
    return null;
  }
  const core = await safeImport(coreEntry);
  if (core.__error) {
    fail('runtime: import @relayfile/adapter-core', core.__error.message);
    return null;
  }

  const required = [
    'classifyWrite',
    'validatePayload',
    'ReadOnlyFieldError',
    'WritebackValidationError',
    'recordWritebackStatus',
    'listWritebackStatus',
  ];
  const missing = required.filter((k) => !(k in core));
  if (missing.length > 0) {
    fail('runtime: missing exports from @relayfile/adapter-core', missing.join(', '));
    return null;
  }
  pass('runtime: imported router/validation/status helpers');

  // Linear resources are the canonical proof input.
  ensureBuild('@relayfile/adapter-linear', 'packages/linear/dist/index.js');
  const linearResourcesEntry = pathToFileURL(join(root, 'packages/linear/dist/resources.js')).href;
  const linearResources = await safeImport(linearResourcesEntry);
  if (linearResources.__error || !Array.isArray(linearResources.resources)) {
    fail('runtime: import linear resources', linearResources.__error?.message ?? 'no resources export');
    return null;
  }
  const resources = linearResources.resources;
  const issueResource = resources.find((r) => r.name === 'issues');
  if (!issueResource) {
    fail('runtime: locate linear issues resource', 'resources.find(name=issues) returned undefined');
    return null;
  }

  // ---- classifyWrite scenarios ----
  try {
    const r = core.classifyWrite(`/linear/issues/${PAGE_UUID}.json`, resources);
    if (!r) throw new Error('returned null');
    if (r.kind !== 'patch') throw new Error(`kind=${r.kind}`);
    if (!r.canonical) throw new Error('canonical=false');
    if (r.id !== PAGE_UUID) throw new Error(`id=${r.id}`);
    pass('classifyWrite: canonical UUID → patch');
  } catch (e) {
    fail('classifyWrite: canonical UUID → patch', e.message);
  }

  try {
    const r = core.classifyWrite('/linear/issues/draft-bug.json', resources);
    if (!r) throw new Error('returned null');
    if (r.kind !== 'create') throw new Error(`kind=${r.kind}`);
    if (r.canonical) throw new Error('canonical=true');
    pass('classifyWrite: non-canonical filename → create');
  } catch (e) {
    fail('classifyWrite: non-canonical filename → create', e.message);
  }

  try {
    // Lead's chosen signature (option a): fsEvent: 'write' | 'delete', default 'write'.
    const r = core.classifyWrite(`/linear/issues/${PAGE_UUID}.json`, resources, { fsEvent: 'delete' });
    if (!r) throw new Error('returned null on canonical delete');
    if (r.kind !== 'delete') throw new Error(`kind=${r.kind}`);
    if (r.canonical !== true) throw new Error(`canonical=${r.canonical}`);
    if (r.id !== PAGE_UUID) throw new Error(`id=${r.id}`);
    pass('classifyWrite: canonical delete signal → kind=delete');
  } catch (e) {
    fail('classifyWrite: canonical delete signal → kind=delete', e.message);
  }

  try {
    // Non-canonical delete must return null per lead spec (no inventing deletes on drafts).
    const r = core.classifyWrite('/linear/issues/draft-bug.json', resources, { fsEvent: 'delete' });
    if (r !== null) throw new Error(`expected null on non-canonical delete; got ${JSON.stringify(r)}`);
    pass('classifyWrite: non-canonical delete signal → null');
  } catch (e) {
    fail('classifyWrite: non-canonical delete signal → null', e.message);
  }

  // ---- validatePayload scenarios ----
  try {
    const r = core.validatePayload({ teamId: PAGE_UUID, title: 'ok' }, schema, 'create');
    if (r.ok !== true) throw new Error(`ok=${r.ok} errors=${JSON.stringify(r.errors)}`);
    pass('validatePayload: minimal create satisfies required');
  } catch (e) {
    fail('validatePayload: minimal create satisfies required', e.message);
  }

  try {
    const r = core.validatePayload({ title: 'no team' }, schema, 'create');
    if (r.ok !== false) throw new Error('expected ok=false');
    if (!r.errors?.some((e) => e.reason === 'required' && e.field === 'teamId')) {
      throw new Error(`expected required/teamId error; got ${JSON.stringify(r.errors)}`);
    }
    pass('validatePayload: missing required → reason=required field=teamId');
  } catch (e) {
    fail('validatePayload: missing required → reason=required field=teamId', e.message);
  }

  try {
    const r = core.validatePayload({ teamId: PAGE_UUID, title: 'ok', foo: 'bar' }, schema, 'create');
    if (r.ok !== false) throw new Error('expected ok=false');
    if (!r.errors?.some((e) => e.reason === 'additionalProperties' && e.field === 'foo')) {
      throw new Error(`expected additionalProperties/foo error; got ${JSON.stringify(r.errors)}`);
    }
    pass('validatePayload: extra field → reason=additionalProperties field=foo');
  } catch (e) {
    fail('validatePayload: extra field → reason=additionalProperties field=foo', e.message);
  }

  try {
    const r = core.validatePayload({ id: 'fff' }, schema, 'patch');
    if (r.ok !== false) throw new Error('expected ok=false');
    if (!r.errors?.some((e) => e.reason === 'readOnly' && e.field === 'id')) {
      throw new Error(`expected readOnly/id error; got ${JSON.stringify(r.errors)}`);
    }
    pass('validatePayload: readOnly write on patch → reason=readOnly field=id');
  } catch (e) {
    fail('validatePayload: readOnly write on patch → reason=readOnly field=id', e.message);
  }

  // ---- writeback status sink round-trip ----
  try {
    const path = `/linear/issues/${PAGE_UUID}.json`;
    const entry = {
      path,
      op: 'patch',
      outcome: 'readonly_rejected',
      field: 'id',
      error: 'Field "id" is read-only and cannot be written',
      timestamp: new Date().toISOString(),
    };
    core.recordWritebackStatus(entry);
    const list = core.listWritebackStatus?.({ path });
    if (!Array.isArray(list)) throw new Error('listWritebackStatus did not return an array');
    if (!list.some((e) => e.path === path && e.outcome === 'readonly_rejected' && e.field === 'id')) {
      throw new Error(`status entry not visible; got ${JSON.stringify(list)}`);
    }
    pass('status sink: recordWritebackStatus + listWritebackStatus round-trip');
  } catch (e) {
    fail('status sink: recordWritebackStatus + listWritebackStatus round-trip', e.message);
  }

  return { core, resources, issueResource };
}

function tryClassifyDelete(core, path, resources, opts) {
  try {
    const r = core.classifyWrite(path, resources, opts);
    if (r && r.kind === 'delete') return r;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section 3 — Linear adapter resolver still produces correct request shape
// ---------------------------------------------------------------------------
async function section3LinearAdapter() {
  ensureBuild('@relayfile/adapter-linear', 'packages/linear/dist/writeback.js');
  const writebackEntry = pathToFileURL(join(root, 'packages/linear/dist/writeback.js')).href;
  const w = await safeImport(writebackEntry);
  if (w.__error) {
    fail('linear: import @relayfile/adapter-linear/writeback', w.__error.message);
    return;
  }

  // PATCH on canonical id produces issueUpdate.
  try {
    const req = w.resolveWritebackRequest(`/linear/issues/${PAGE_UUID}.json`, JSON.stringify({ title: 'renamed' }));
    if (req.action !== 'update_issue') throw new Error(`action=${req.action}`);
    if (req.method !== 'POST' || req.endpoint !== '/graphql') throw new Error(`method=${req.method} endpoint=${req.endpoint}`);
    const input = req.body?.variables?.input;
    if (input?.title !== 'renamed') throw new Error(`input.title=${input?.title}`);
    pass('linear: PATCH canonical issue → issueUpdate mutation with mutable field');
  } catch (e) {
    fail('linear: PATCH canonical issue → issueUpdate mutation with mutable field', e.message);
  }

  // CREATE via draft filename produces issueCreate.
  try {
    const req = w.resolveWritebackRequest(
      '/linear/issues/draft-export-pipeline.json',
      JSON.stringify({ teamId: PAGE_UUID, title: 'Audit log export' }),
    );
    if (req.action !== 'create_issue') throw new Error(`action=${req.action}`);
    const input = req.body?.variables?.input;
    if (input?.teamId !== PAGE_UUID || input?.title !== 'Audit log export') {
      throw new Error(`input=${JSON.stringify(input)}`);
    }
    pass('linear: CREATE via draft filename → issueCreate mutation with required fields');
  } catch (e) {
    fail('linear: CREATE via draft filename → issueCreate mutation with required fields', e.message);
  }

  // ReadOnlyFieldError on canonical patch with readOnly field.
  try {
    let thrown;
    try {
      w.resolveWritebackRequest(`/linear/issues/${PAGE_UUID}.json`, JSON.stringify({ id: 'forged' }));
    } catch (e) {
      thrown = e;
    }
    if (!thrown) throw new Error('expected ReadOnlyFieldError, none thrown');
    if (thrown.name !== 'ReadOnlyFieldError') throw new Error(`error.name=${thrown.name}`);
    if (thrown.field !== 'id') throw new Error(`error.field=${thrown.field}`);
    pass('linear: PATCH with readOnly field → ReadOnlyFieldError("id")');
  } catch (e) {
    fail('linear: PATCH with readOnly field → ReadOnlyFieldError("id")', e.message);
  }
}

// ---------------------------------------------------------------------------
// Section 4 — Adapter discovery sanity (lightweight, skippable)
// ---------------------------------------------------------------------------
async function section4AdapterSanity() {
  if (linearOnly) {
    pass('adapter sanity: skipped (ISSUE45_E2E_LINEAR_ONLY=1)');
    return;
  }
  const packagesDir = join(root, 'packages');
  const slugs = (await readdir(packagesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((slug) => slug !== 'core' && slug !== 'webhook-server');

  // Writable adapters are those that ship a discovery/<slug>/.adapter.md;
  // read-only adapters (e.g. airtable/calendly/mailgun/...) are out of scope
  // for the file-native router and are skipped.
  for (const slug of slugs) {
    const adapterMd = join(packagesDir, slug, 'discovery', slug, '.adapter.md');
    if (!existsSync(adapterMd)) continue;
    const resourcesTs = join(packagesDir, slug, 'src/resources.ts');
    if (!existsSync(resourcesTs)) {
      fail(`adapter sanity: ${slug}/src/resources.ts missing`, 'has discovery/.adapter.md but no resources.ts');
      continue;
    }
    const txt = await readFile(resourcesTs, 'utf8');
    if (!txt.includes('pathPattern:') || !txt.includes('idPattern:')) {
      fail(`adapter sanity: ${slug}/src/resources.ts missing pathPattern/idPattern`, '');
      continue;
    }
    pass(`adapter sanity: ${slug} ships resources.ts with pathPattern/idPattern`);
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
async function main() {
  const discovery = await section1Discovery();
  const schema = discovery?.schema;

  if (schema) {
    await section2Runtime(schema);
  } else {
    fail('runtime: skipped because discovery section failed', '');
  }

  await section3LinearAdapter();
  await section4AdapterSanity();

  if (verbose) {
    for (const p of passes) console.log(`PASS ${p}`);
  }
  console.log(`\n[e2e] ${passes.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('\nFAILURES:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('[e2e] all required scenarios passed');
}

main().catch((e) => {
  console.error('[e2e] uncaught error:', e?.stack ?? e);
  process.exit(1);
});
