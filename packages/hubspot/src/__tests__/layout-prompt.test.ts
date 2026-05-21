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
