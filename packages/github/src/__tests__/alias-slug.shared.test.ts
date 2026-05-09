import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  aliasCollisionSuffix as githubAliasCollisionSuffix,
  slugifyAlias as githubSlugifyAlias,
} from '../alias-slug.js';
// This contract test intentionally imports the sibling adapter implementations directly so drift across
// packages fails in one place. If the package layout changes, update these imports with the move.
import {
  aliasCollisionSuffix as linearAliasCollisionSuffix,
  slugifyAlias as linearSlugifyAlias,
} from '../../../linear/src/alias-slug.js';
import {
  aliasCollisionSuffix as notionAliasCollisionSuffix,
  slugifyAlias as notionSlugifyAlias,
} from '../../../notion/src/alias-slug.js';

describe('shared alias slug contract', () => {
  it('keeps slug generation stable and deterministic across notion, linear, and github', () => {
    const input = 'Café ../ Roadmap';
    const expected = 'cafe-roadmap';

    assert.strictEqual(notionSlugifyAlias(input), expected);
    assert.strictEqual(linearSlugifyAlias(input), expected);
    assert.strictEqual(githubSlugifyAlias(input), expected);

    assert.strictEqual(notionSlugifyAlias(input), notionSlugifyAlias(input));
    assert.strictEqual(linearSlugifyAlias(input), linearSlugifyAlias(input));
    assert.strictEqual(githubSlugifyAlias(input), githubSlugifyAlias(input));
  });

  it('uses the same 8-character sha256 collision suffix in every adapter', () => {
    const id = 'collision-target';
    const expected = createHash('sha256').update(id).digest('hex').slice(0, 8);

    assert.strictEqual(notionAliasCollisionSuffix(id), expected);
    assert.strictEqual(linearAliasCollisionSuffix(id), expected);
    assert.strictEqual(githubAliasCollisionSuffix(id), expected);
    assert.match(expected, /^[0-9a-f]{8}$/);
  });

  it('falls back to untitled for symbol-only input and truncates slugs to the cloud limit', () => {
    const emojiOnly = '🚀🔥';
    const longInput = 'A'.repeat(81);
    const expectedLongSlug = 'a'.repeat(80);

    assert.strictEqual(notionSlugifyAlias(emojiOnly), 'untitled');
    assert.strictEqual(linearSlugifyAlias(emojiOnly), 'untitled');
    assert.strictEqual(githubSlugifyAlias(emojiOnly), 'untitled');

    assert.strictEqual(notionSlugifyAlias(longInput), expectedLongSlug);
    assert.strictEqual(linearSlugifyAlias(longInput), expectedLongSlug);
    assert.strictEqual(githubSlugifyAlias(longInput), expectedLongSlug);
  });
});
