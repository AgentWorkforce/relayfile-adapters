import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { notionLayoutPromptFile } from '../layout-prompt.js';

describe('notion layout prompt', () => {
  it('emits the integration layout guide at the notion root', () => {
    const file = notionLayoutPromptFile();

    assert.equal(file.path, '/notion/LAYOUT.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
    assert.match(file.content, /\bls\b/u);
    assert.match(file.content, /__/u);
    assert.match(file.content, /_index\.json/u);
  });
});
