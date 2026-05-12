import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aliasShortId, slugifyAlias } from '../alias-slug.js';
import {
  notionAliasFilename,
  notionByIdAliasPath,
  notionByNameAliasPath,
  notionByTitleAliasPath,
  notionDatabasesCollectionPath,
  notionPageByDatabaseAliasPath,
  notionPageByParentAliasPath,
  notionUserPath,
  notionUsersCollectionPath,
  notionUsersIndexPath,
} from '../path-mapper.js';

describe('aliasShortId', () => {
  it('returns the last 8 hex chars of a canonical UUID', () => {
    // The trailing 12-hex segment of an 8-4-4-4-12 UUID, sliced to its
    // last 8 chars. This is deterministic and recomputable by an agent
    // holding the UUID alone.
    assert.equal(aliasShortId('11111111-2222-3333-4444-555566667777'), '66667777');
    assert.equal(aliasShortId('a1b2c3d4-e5f6-7890-1234-deadbeef1234'), 'beef1234');
  });

  it('treats the dehyphenated 32-hex form the same as the canonical UUID', () => {
    assert.equal(
      aliasShortId('11111111-2222-3333-4444-555566667777'),
      aliasShortId('11111111222233334444555566667777'),
    );
  });

  it('falls back to sha256 for non-UUID synthetic ids so test fixtures keep working', () => {
    assert.match(aliasShortId('page-1'), /^[0-9a-f]{8}$/);
    assert.equal(aliasShortId('page-1'), aliasShortId('page-1'));
    assert.notEqual(aliasShortId('page-1'), aliasShortId('page-2'));
  });
});

describe('notionAliasFilename', () => {
  it('always emits <slug>__<short_id> even when no collision is present', () => {
    // Deterministic suffix means two pages with the same title cannot
    // clobber each other — there is no "base" vs "colliding" path, only
    // the per-UUID alias. Agents reconstruct the filename from the UUID.
    const id = 'a1b2c3d4-e5f6-7890-1234-deadbeef1234';
    assert.equal(notionAliasFilename('Launch Checklist', id), 'launch-checklist__beef1234');
  });

  it('falls back to the "untitled" slug when the label has no slug-worthy characters', () => {
    // slugifyAlias() defends against empty input by returning the
    // sentinel "untitled", so notionAliasFilename never throws on
    // upstream sanitization — the suffix still disambiguates by UUID so
    // an "untitled" run of pages still produces unique aliases.
    const a = notionAliasFilename('', 'a1b2c3d4-e5f6-7890-1234-deadbeef1234');
    const b = notionAliasFilename('   ', 'a1b2c3d4-e5f6-7890-1234-cafe0000ffff');
    assert.match(a, /^untitled__[0-9a-f]{8}$/);
    assert.match(b, /^untitled__[0-9a-f]{8}$/);
    assert.notEqual(a, b);
  });
});

describe('notionByTitleAliasPath', () => {
  it('produces deterministic, collision-safe paths even for duplicate titles', () => {
    const idA = '11111111-1111-1111-1111-111111111111';
    const idB = '22222222-2222-2222-2222-222222222222';
    const a = notionByTitleAliasPath('/notion/pages', 'Tasks', idA);
    const b = notionByTitleAliasPath('/notion/pages', 'Tasks', idB);
    assert.notEqual(a, b, 'duplicate titles must resolve to distinct alias paths');
    assert.equal(a, '/notion/pages/by-title/tasks__11111111.json');
    assert.equal(b, '/notion/pages/by-title/tasks__22222222.json');
  });

  it('round-trips: alias path → canonical id suffix', () => {
    // The trailing 8 hex chars of the alias filename match the trailing
    // 8 hex chars of the canonical UUID. Agents use this property to
    // verify they're operating on the page they think they are.
    const id = 'a1b2c3d4-e5f6-7890-1234-deadbeef1234';
    const aliasPath = notionByTitleAliasPath('/notion/pages', 'My Page', id);
    const match = /__([0-9a-f]{8})\.json$/.exec(aliasPath);
    assert.ok(match, 'alias filename must contain a <short_id> suffix');
    assert.equal(match[1], id.replace(/-/g, '').slice(-8));
  });
});

describe('notionByNameAliasPath', () => {
  it('puts user aliases under by-name with the same <slug>__<short_id> pattern', () => {
    const id = '11111111-1111-1111-1111-222233334444';
    assert.equal(
      notionByNameAliasPath('/notion/users', 'Alice Chen', id),
      '/notion/users/by-name/alice-chen__33334444.json',
    );
  });
});

describe('notionPageByDatabaseAliasPath', () => {
  it('builds /notion/pages/by-database/<db>__<short>/<page>__<short>.json', () => {
    const dbId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const pageId = '11111111-2222-3333-4444-deadbeef0001';
    assert.equal(
      notionPageByDatabaseAliasPath(dbId, pageId, 'Tasks', 'Launch Checklist'),
      '/notion/pages/by-database/tasks__eeeeeeee/launch-checklist__beef0001.json',
    );
  });
});

describe('notionPageByParentAliasPath', () => {
  it('prefixes the parent segment with the parent type so agents can tell page vs database', () => {
    const parentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const pageId = '11111111-2222-3333-4444-deadbeef0001';
    assert.equal(
      notionPageByParentAliasPath('page', parentId, pageId, 'Roadmap', 'Q3 launch plan'),
      '/notion/pages/by-parent/page-roadmap__eeeeeeee/q3-launch-plan__beef0001.json',
    );
    assert.equal(
      notionPageByParentAliasPath('database', parentId, pageId, 'Roadmap', 'Q3 launch plan'),
      '/notion/pages/by-parent/database-roadmap__eeeeeeee/q3-launch-plan__beef0001.json',
    );
  });

  it('falls back to the parent UUID slug when the parent title is missing', () => {
    // Parent titles aren't always reachable from a page payload (Notion
    // returns only the parent's UUID), so the alias writer accepts an
    // undefined parentTitle and slugs the UUID instead. The path stays
    // navigable — agents can still list `ls by-parent/page-<uuid>/`.
    const parentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const pageId = '11111111-2222-3333-4444-deadbeef0001';
    const path = notionPageByParentAliasPath('page', parentId, pageId, undefined, 'Q3 launch plan');
    assert.match(path, /^\/notion\/pages\/by-parent\/page-/);
    assert.match(path, /\/q3-launch-plan__beef0001\.json$/);
  });
});

describe('notion users path helpers', () => {
  it('puts users at /notion/users with their own _index.json', () => {
    assert.equal(notionUsersCollectionPath(), '/notion/users');
    assert.equal(notionUsersIndexPath(), '/notion/users/_index.json');
    assert.equal(
      notionUserPath('11111111-1111-1111-1111-222233334444', 'Alice Chen'),
      '/notion/users/alice-chen__11111111-1111-1111-1111-222233334444.json',
    );
  });

  it('falls back to the bare id when the user has no display name', () => {
    assert.equal(
      notionUserPath('11111111-1111-1111-1111-222233334444'),
      '/notion/users/11111111-1111-1111-1111-222233334444.json',
    );
  });
});

describe('notion databases collection alias scope', () => {
  it('exposes /notion/databases as the alias scope so by-title/by-id resolve there', () => {
    const collection = notionDatabasesCollectionPath();
    assert.equal(collection, '/notion/databases');
    const id = '11111111-1111-1111-1111-deadbeef1234';
    assert.equal(
      notionByTitleAliasPath(collection, 'Engineering Wiki', id),
      '/notion/databases/by-title/engineering-wiki__beef1234.json',
    );
    assert.equal(
      notionByIdAliasPath(collection, id),
      '/notion/databases/by-id/11111111111111111111deadbeef1234.json',
    );
  });
});

describe('slugifyAlias hardening', () => {
  it('preserves the existing slug normalization contract', () => {
    assert.equal(slugifyAlias('Café roadmap'), 'cafe-roadmap');
    assert.equal(slugifyAlias('   '), 'untitled');
  });
});
