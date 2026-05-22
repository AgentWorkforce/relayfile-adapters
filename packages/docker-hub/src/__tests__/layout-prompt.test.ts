import assert from 'node:assert/strict';
import test from 'node:test';

import { DOCKER_HUB_LAYOUT_PROMPT, dockerHubLayoutPromptFile } from '../layout-prompt.js';

test('Docker Hub LAYOUT.md is provider-specific and documents indexes and aliases', () => {
  const file = dockerHubLayoutPromptFile();

  assert.equal(file.path, '/docker-hub/LAYOUT.md');
  assert.ok(DOCKER_HUB_LAYOUT_PROMPT.length > 1000);
  assert.match(DOCKER_HUB_LAYOUT_PROMPT, /\/docker-hub\/repositories\/_index\.json/u);
  assert.match(DOCKER_HUB_LAYOUT_PROMPT, /\/docker-hub\/tags\/_index\.json/u);
  assert.match(DOCKER_HUB_LAYOUT_PROMPT, /\/docker-hub\/webhooks\/_index\.json/u);
  assert.match(DOCKER_HUB_LAYOUT_PROMPT, /by-namespace/u);
  assert.match(DOCKER_HUB_LAYOUT_PROMPT, /by-repository/u);
  assert.match(DOCKER_HUB_LAYOUT_PROMPT, /jq/u);
});
