import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';

describe('alias slug helpers', () => {
  it('normalizes alias text to stable ASCII slugs', () => {
    assert.equal(slugifyAlias('Café ../ Roadmap'), 'cafe-roadmap');
    assert.equal(slugifyAlias('🚀🔥'), 'untitled');
  });

  it('truncates long slugs at word boundaries when possible', () => {
    const firstToken = 'a'.repeat(78);

    assert.equal(slugifyAlias(`${firstToken} trailing-token`), firstToken);
  });

  it('hard-cuts long slugs when there is no word boundary', () => {
    assert.equal(slugifyAlias('a'.repeat(81)), 'a'.repeat(80));
  });

  it('uses an 8-character sha256 collision suffix', () => {
    const id = 'collision-target';
    const expected = createHash('sha256').update(id).digest('hex').slice(0, 8);

    assert.equal(aliasCollisionSuffix(id), expected);
  });
});
