import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hubspotLayoutPromptFile } from '../layout-prompt.js';
import { resources } from '../resources.js';

describe('hubspotLayoutPromptFile', () => {
  it('returns the HubSpot layout path', () => {
    const file = hubspotLayoutPromptFile();
    assert.equal(file.path, '/hubspot/LAYOUT.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
  });

  it('advertises discovery schemas for every resource', () => {
    const file = hubspotLayoutPromptFile();
    for (const resource of resources) {
      assert.match(file.content, new RegExp(escapeRegExp(resource.schema), 'u'));
    }
  });

  it('mentions every HubSpot object bucket', () => {
    const file = hubspotLayoutPromptFile();
    for (const objectType of ['contacts', 'companies', 'deals', 'tickets']) {
      assert.match(file.content, new RegExp(`\\b${objectType}\\b`, 'u'));
    }
  });

  it('ends with a newline', () => {
    assert.equal(hubspotLayoutPromptFile().content.endsWith('\n'), true);
  });

  // .claude/rules/testing.md → LAYOUT.md emitter tests must assert content
  // length and required substrings to catch a regression to the ~288-byte
  // generic fallback.
  it('renders a non-fallback body (>= 1000 bytes)', () => {
    assert.ok(
      hubspotLayoutPromptFile().content.length >= 1000,
      'LAYOUT.md content must be at least 1000 bytes; shorter content suggests a regression to the generic fallback',
    );
  });

  it('mentions ls, _index.json, jq, and every by-* subtree', () => {
    const content = hubspotLayoutPromptFile().content;
    // `ls` must appear as a standalone command (in fenced/backtick form),
    // not as a substring of "models" or "tools".
    assert.match(content, /`ls`|`ls /u, '`ls` must be present as a documented command');
    assert.match(content, /_index\.json/u, '_index.json must be documented');
    assert.match(content, /\bjq\b/u, 'jq must appear in querying examples');
    assert.match(content, /by-id/u, 'by-id alias subtree must be documented');
  });
});

describe('HubSpot resources', () => {
  it('pins idPattern to numeric-only (no slug-prefix form)', () => {
    for (const resource of resources) {
      assert.match('1234', resource.idPattern);
      assert.doesNotMatch('slug--1234', resource.idPattern);
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
