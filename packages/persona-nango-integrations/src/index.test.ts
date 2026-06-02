import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import persona, { nangoIntegrationsPersona } from './index.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('generated persona is in sync with its sources (no drift)', () => {
  // Throws (non-zero exit) if persona.generated.ts is stale.
  execFileSync('node', ['scripts/assemble.mjs', '--check'], { cwd: pkgRoot });
});

test('default export and named export are the same object', () => {
  assert.equal(persona, nangoIntegrationsPersona);
});

test('persona has the expected identity and harness', () => {
  assert.equal(persona.id, 'nango-integrations');
  assert.equal(persona.intent, 'nango-integrations');
  assert.equal(persona.harness, 'codex');
  assert.equal(persona.model, 'openai-codex/gpt-5.3-codex');
});

test('manual is inlined as agentsMdContent', () => {
  assert.equal(typeof persona.agentsMdContent, 'string');
  assert.ok(persona.agentsMdContent.length > 1000, 'manual should be substantial');
  assert.ok(
    persona.agentsMdContent.startsWith('# Nango Integrations Persona'),
    'manual should start with its title',
  );
  // A marker from deep in the manual to prove it is fully inlined, not truncated.
  assert.ok(persona.agentsMdContent.includes('ADAPTERS registry'));
});

test('nango docs MCP server is preserved', () => {
  assert.equal(persona.mcpServers.nango.type, 'http');
  assert.equal(persona.mcpServers.nango.url, 'https://nango.dev/docs/mcp');
});
