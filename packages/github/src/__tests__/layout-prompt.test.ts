import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { githubLayoutPromptFile } from '../layout-prompt.js';

describe('github layout prompt', () => {
  it('emits the integration layout guide at the github root', () => {
    const file = githubLayoutPromptFile();

    assert.equal(file.path, '/github/LAYOUT.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
    assert.match(file.content, /\bls\b/u);
    assert.match(file.content, /__/u);
    assert.match(file.content, /_index\.json/u);
  });
});
