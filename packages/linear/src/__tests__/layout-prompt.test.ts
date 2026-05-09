import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { linearLayoutPromptFile } from '../layout-prompt.js';

describe('linear layout prompt', () => {
  it('emits the integration layout guide at the linear root', () => {
    const file = linearLayoutPromptFile();

    assert.equal(file.path, '/linear/.layout.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
    assert.match(file.content, /\bls\b/u);
    assert.match(file.content, /__/u);
    assert.match(file.content, /_index\.json/u);
  });
});
