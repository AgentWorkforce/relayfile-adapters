import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { notionLayoutPromptFile } from '../layout-prompt.js';

describe('notion layout prompt', () => {
  it('emits the integration layout guide at the notion root', () => {
    const file = notionLayoutPromptFile();

    assert.equal(file.path, '/notion/LAYOUT.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
    assert.match(file.content, /\bls\b/u);
    assert.match(file.content, /\bjq\b/u);
    assert.match(file.content, /__/u);
    assert.match(file.content, /_index\.json/u);
    assert.match(file.content, /by-edited\/YYYY-MM-DD/u);
    assert.match(file.content, /discovery\/notion\/databases\/\{databaseId\}\/pages\/\.schema\.json/u);
    assert.match(file.content, /discovery\/notion\/databases\/\{databaseId\}\/pages\/\{pageId\}\/content\.md\/\.schema\.json/u);
    assert.match(file.content, /discovery\/notion\/pages\/\{pageId\}\/comments\.json\/\.schema\.json/u);
    assert.match(file.content, /Every schema has a sibling `\.create\.example\.json` file\./u);
    assert.match(file.content, /ls \/notion\/pages\/by-edited\/2026-05-12/u);
    assert.ok(file.content.trim().length > 0);
  });
});
