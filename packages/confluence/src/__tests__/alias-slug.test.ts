import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aliasCollisionSuffix, slugifyAlias } from '../alias-slug.js';

describe('confluence alias slug', () => {
  it('slugging is deterministic, ASCII-folded, and strips traversal characters', () => {
    assert.equal(slugifyAlias('Café ../ Roadmap'), 'cafe-roadmap');
    assert.equal(slugifyAlias('Café ../ Roadmap'), slugifyAlias('Café ../ Roadmap'));
  });

  it('falls back to "untitled" when the input slugs to nothing', () => {
    assert.equal(slugifyAlias('🚀🔥'), 'untitled');
    assert.equal(slugifyAlias('   '), 'untitled');
  });

  it('emits an 8-char hex collision suffix from the id', () => {
    const suffix = aliasCollisionSuffix('page-id-1');
    assert.match(suffix, /^[0-9a-f]{8}$/u);
    assert.equal(suffix, aliasCollisionSuffix('page-id-1'));
  });
});
