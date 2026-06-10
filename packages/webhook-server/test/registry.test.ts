import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AdapterRegistry, createAdapterRegistry } from '../src/registry.js';
import type { RegisteredWebhookAdapter } from '../src/types.js';

const adapter = (name: string): RegisteredWebhookAdapter => ({ name });

describe('AdapterRegistry', () => {
  it('normalizes provider names on register and lookup', () => {
    const registry = new AdapterRegistry();
    registry.register('  GitHub  ', adapter('github'));

    assert.strictEqual(registry.get('github')?.name, 'github');
    assert.strictEqual(registry.get('GITHUB')?.name, 'github');
    assert.strictEqual(registry.get(' github ')?.name, 'github');
    assert.strictEqual(registry.get('gitlab'), undefined);
  });

  it('rejects empty provider names', () => {
    const registry = new AdapterRegistry();
    assert.throws(() => registry.register('   ', adapter('x')), /non-empty string/);
    assert.throws(() => registry.get(''), /non-empty string/);
  });

  it('seeds initial adapters from the constructor map and lists them sorted', () => {
    const registry = createAdapterRegistry({
      Slack: adapter('slack'),
      github: adapter('github'),
    });

    assert.deepStrictEqual(registry.list(), ['github', 'slack']);
  });

  it('replaces an existing adapter on re-register', () => {
    const registry = new AdapterRegistry();
    registry.register('github', adapter('first'));
    registry.register('github', adapter('second'));

    assert.strictEqual(registry.get('github')?.name, 'second');
    assert.deepStrictEqual(registry.list(), ['github']);
  });
});
