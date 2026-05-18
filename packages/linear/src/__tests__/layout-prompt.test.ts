import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { linearLayoutPromptFile } from '../layout-prompt.js';

describe('linear layout prompt', () => {
  it('emits the integration layout guide at the linear root', () => {
    const file = linearLayoutPromptFile();

    assert.equal(file.path, '/linear/LAYOUT.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
    assert.match(file.content, /\bls\b/u);
    assert.match(file.content, /\bjq\b/u);
    assert.match(file.content, /__/u);
    assert.match(file.content, /_index\.json/u);
    assert.match(file.content, /by-edited\/YYYY-MM-DD/u);
    assert.match(file.content, /discovery\/linear\/issues\/\.schema\.json/u);
    assert.match(file.content, /discovery\/linear\/issues\/\.create\.example\.json/u);
    assert.match(file.content, /discovery\/linear\/issues\/\{issueId\}\/comments\/\.schema\.json/u);
    assert.match(file.content, /ls \/linear\/issues\/by-edited\/2026-05-12/u);
  });
});
