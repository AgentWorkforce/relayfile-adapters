import assert from 'node:assert/strict';
import test from 'node:test';

import persona, { nangoIntegrationsPersona } from '../index.js';

test('default export and named export are the same object', () => {
  assert.equal(persona, nangoIntegrationsPersona);
});

test('persona has the expected identity and harness', () => {
  assert.equal(persona.id, 'nango-integrations');
  assert.equal(persona.intent, 'nango-integrations');
  assert.equal(persona.harness, 'codex');
  assert.equal(persona.model, 'openai-codex/gpt-5.3-codex');
});

test('manual is present as agentsMdContent', () => {
  assert.equal(typeof persona.agentsMdContent, 'string');
  assert.ok(persona.agentsMdContent.length > 1000, 'manual should be substantial');
  assert.ok(
    persona.agentsMdContent.startsWith('# Nango Integrations Persona'),
    'manual should start with its title',
  );
  assert.ok(persona.agentsMdContent.includes('ADAPTERS registry'));
});

test('nango docs MCP server is preserved', () => {
  assert.equal(persona.mcpServers.nango.type, 'http');
  assert.equal(persona.mcpServers.nango.url, 'https://nango.dev/docs/mcp');
});
