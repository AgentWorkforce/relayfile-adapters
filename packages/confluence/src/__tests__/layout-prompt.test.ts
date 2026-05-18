import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { confluenceLayoutPromptFile } from '../layout-prompt.js';

describe('confluence layout prompt', () => {
  it('emits the integration layout guide at the confluence root', () => {
    const file = confluenceLayoutPromptFile();

    assert.equal(file.path, '/confluence/LAYOUT.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
    assert.match(file.content, /\bls\b/u);
    assert.match(file.content, /__/u);
    assert.match(file.content, /_index\.json/u);
    assert.match(file.content, /\/confluence\/pages\//u);
    assert.match(file.content, /\/confluence\/spaces\//u);
    assert.match(file.content, /by-title/u);
    assert.match(file.content, /by-id/u);
    assert.match(file.content, /by-state/u);
    assert.match(file.content, /by-space/u);
    assert.match(file.content, /by-parent/u);
    assert.match(file.content, /by-edited\/YYYY-MM-DD/u);
    assert.match(file.content, /by-key/u);
    assert.match(file.content, /jq /u);
    assert.match(file.content, /discovery\/confluence\/pages\/\.schema\.json/u);
    assert.match(file.content, /discovery\/confluence\/pages\/\.create\.example\.json/u);
    assert.match(file.content, /discovery\/confluence\/spaces\/\{spaceIdOrKey\}\/pages\/\.schema\.json/u);
    assert.match(file.content, /ls \/confluence\/pages\/by-edited\/2026-05-12/u);
  });
});
