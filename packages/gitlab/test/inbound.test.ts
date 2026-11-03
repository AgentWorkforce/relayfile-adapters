import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GITLAB_TOKEN_CONFIG_KEYS, inboundCapabilities } from '../src/inbound.js';

test('token connections retain GitLab Nango and Hookdeck routing identity', () => {
  assert.deepEqual(GITLAB_TOKEN_CONFIG_KEYS, ['gitlab-pat', 'gitlab-group-token']);
  assert.deepEqual(inboundCapabilities.map((capability) => capability.id).sort(), ['gitlab.hookdeck', 'gitlab.nango']);
  for (const capability of inboundCapabilities) {
    assert.equal(capability.providerId, 'gitlab');
    assert.equal(capability.pathRoot, '/gitlab');
    for (const configKey of GITLAB_TOKEN_CONFIG_KEYS) {
      assert.ok(capability.providerConfigAliases.includes(configKey));
    }
  }
});
