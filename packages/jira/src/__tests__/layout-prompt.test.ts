import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JIRA_LAYOUT_PROMPT, jiraLayoutPromptFile } from '../layout-prompt.js';

describe('jira layout prompt', () => {
  it('emits the integration layout guide at the jira root', () => {
    const file = jiraLayoutPromptFile();

    assert.equal(file.path, '/jira/LAYOUT.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
  });

  it('ships rich content well above the generic-fallback threshold', () => {
    // AGENTS.md mandates that shipping adapters have a ~1000-byte LAYOUT.md
    // explaining the tree, naming convention, indexes, aliases, and examples.
    // The previous generic fallback was ~288 bytes; this test guards against
    // regressing to that fallback.
    const bytes = Buffer.byteLength(JIRA_LAYOUT_PROMPT, 'utf8');
    assert.ok(bytes > 1000, `expected > 1000 bytes, got ${bytes}`);
  });

  it('describes the substrings consumers grep for', () => {
    const { content } = jiraLayoutPromptFile();
    assert.match(content, /\bls\b/u);
    assert.match(content, /_index\.json/u);
    assert.match(content, /by-state/u);
    assert.match(content, /by-key/u);
    assert.match(content, /by-id/u);
    assert.match(content, /\bjq\b/u);
    // Document the joiner migration so readers know the current vs. target shape.
    assert.match(content, /--/u);
    assert.match(content, /__/u);
  });
});
