import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePath,
  normalizeNangoNotionModel,
  notionByIdAliasPath,
  notionByNameAliasPath,
  notionByTitleAliasPath,
  notionDatabaseBlockPath,
  notionDatabaseMetadataPath,
  notionDatabasePageCommentsPath,
  notionDatabasePageContentPath,
  notionDatabasePagePath,
  notionPageByDatabaseAliasPath,
  notionPageByParentAliasPath,
  notionStandalonePagesCollectionPath,
  notionStandalonePageCommentsPath,
  notionStandalonePageContentPath,
  notionStandalonePagePath,
  notionUserPath,
  parseNameWithId,
  tryNormalizeNangoNotionModel,
} from '../path-mapper.js';
import { aliasShortId } from '../alias-slug.js';

describe('path mapping', () => {
  it('maps database metadata paths', () => {
    assert.strictEqual(notionDatabaseMetadataPath('db-1'), '/notion/databases/db-1/metadata.json');
    assert.strictEqual(computePath({ objectType: 'database', objectId: 'db-1' }), '/notion/databases/db-1/metadata.json');
  });

  it('maps database page paths', () => {
    assert.strictEqual(notionDatabasePagePath('db-1', 'page-1'), '/notion/databases/db-1/pages/page-1.json');
    assert.strictEqual(notionDatabasePageContentPath('db-1', 'page-1'), '/notion/databases/db-1/pages/page-1/content.md');
    assert.strictEqual(notionDatabasePageCommentsPath('db-1', 'page-1'), '/notion/databases/db-1/pages/page-1/comments.json');
    assert.strictEqual(notionDatabaseBlockPath('db-1', 'page-1', 'block-1'), '/notion/databases/db-1/pages/page-1/blocks/block-1.json');
  });

  it('maps standalone page paths', () => {
    assert.strictEqual(notionStandalonePagePath('page-1'), '/notion/pages/page-1.json');
    assert.strictEqual(notionStandalonePageContentPath('page-1'), '/notion/pages/page-1/content.md');
    assert.strictEqual(notionStandalonePageCommentsPath('page-1'), '/notion/pages/page-1/comments.json');
  });

  it('maps standalone alias paths', () => {
    assert.strictEqual(notionStandalonePagesCollectionPath(), '/notion/pages');
    // by-title aliases always carry a deterministic <slug>__<short_id>
    // suffix derived from the canonical UUID — collisions are impossible
    // and an agent holding the UUID can recompute the filename locally.
    assert.strictEqual(
      notionByTitleAliasPath('/notion/pages', 'Cafe roadmap', '11111111-1111-1111-1111-111111111111'),
      '/notion/pages/by-title/cafe-roadmap__11111111.json',
    );
    // The legacy `colliding` parameter is now a no-op — the short_id is
    // always present, so both invocations resolve to the same path.
    assert.strictEqual(
      notionByTitleAliasPath('/notion/pages', 'Cafe roadmap', '11111111-1111-1111-1111-111111111111', true),
      notionByTitleAliasPath('/notion/pages', 'Cafe roadmap', '11111111-1111-1111-1111-111111111111'),
    );
    assert.strictEqual(
      notionByIdAliasPath('/notion/pages', '11111111-1111-1111-1111-111111111111'),
      '/notion/pages/by-id/11111111111111111111111111111111.json',
    );
  });

  // AGENTS.md: every path-mapper helper needs round-trip coverage. The
  // emit-auxiliary flow leans on these specific helpers — without these
  // tests a regression in the leaf-encoding format (e.g. switching the
  // `<slug>__<short_id>` joiner) would slip through CI and only surface
  // when cloud's reconciliation path tried to parse the alias filename
  // to recover a uuid.
  describe('round-trip: compose → parseNameWithId / aliasShortId', () => {
    const PAGE_UUID = '8a3c9b50-22f0-4d2c-a07d-7e02d2cf6f9e';
    const DATABASE_UUID = 'a1b2c3d4-e5f6-7890-1234-deadbeef1234';
    const PARENT_PAGE_UUID = 'cccccccc-dddd-eeee-ffff-000000000001';
    const USER_UUID = 'd1111111-2222-3333-4444-aaaaaaaaaaaa';

    function leafOf(path: string): string {
      return path.split('/').pop()!;
    }

    it('notionByTitleAliasPath: parseNameWithId recovers the slug and aliasShortId', () => {
      const composed = notionByTitleAliasPath('/notion/pages', 'Cafe roadmap', PAGE_UUID);
      const parsed = parseNameWithId(leafOf(composed));
      assert.strictEqual(parsed.humanReadable, 'cafe-roadmap');
      assert.strictEqual(parsed.id, aliasShortId(PAGE_UUID));
      assert.strictEqual(parsed.ext, 'json');
    });

    it('notionByNameAliasPath: parseNameWithId recovers the username slug and aliasShortId', () => {
      const composed = notionByNameAliasPath('/notion/users', 'Sam Carter', USER_UUID);
      const parsed = parseNameWithId(leafOf(composed));
      assert.strictEqual(parsed.humanReadable, 'sam-carter');
      assert.strictEqual(parsed.id, aliasShortId(USER_UUID));
    });

    it('notionByIdAliasPath: leaf is the lowercased dehyphenated uuid (re-hyphenatable)', () => {
      const composed = notionByIdAliasPath('/notion/pages', PAGE_UUID);
      const leaf = leafOf(composed).replace(/\.json$/u, '');
      assert.strictEqual(leaf, PAGE_UUID.replace(/-/g, '').toLowerCase());
      // The dehyphenated form preserves all 32 hex characters, so a
      // parser can re-hyphenate to recover the original UUID with no
      // information loss. Pin the recovery to lock the format.
      const recovered = `${leaf.slice(0, 8)}-${leaf.slice(8, 12)}-${leaf.slice(12, 16)}-${leaf.slice(16, 20)}-${leaf.slice(20)}`;
      assert.strictEqual(recovered, PAGE_UUID);
    });

    it('notionPageByDatabaseAliasPath: parseNameWithId recovers both database and page short_ids', () => {
      const composed = notionPageByDatabaseAliasPath(DATABASE_UUID, PAGE_UUID, 'Tasks', 'Release Plan');
      const parts = composed.split('/').filter(Boolean);
      // /notion/pages/by-database/<dbSegment>/<pageSegment>.json
      assert.strictEqual(parts[0], 'notion');
      assert.strictEqual(parts[1], 'pages');
      assert.strictEqual(parts[2], 'by-database');
      const dbParsed = parseNameWithId(parts[3]!);
      assert.strictEqual(dbParsed.humanReadable, 'tasks');
      assert.strictEqual(dbParsed.id, aliasShortId(DATABASE_UUID));
      const pageParsed = parseNameWithId(parts[4]!);
      assert.strictEqual(pageParsed.humanReadable, 'release-plan');
      assert.strictEqual(pageParsed.id, aliasShortId(PAGE_UUID));
    });

    it('notionPageByParentAliasPath: parent segment carries the parentType prefix; page segment round-trips', () => {
      const composed = notionPageByParentAliasPath(
        'page',
        PARENT_PAGE_UUID,
        PAGE_UUID,
        'Parent Page',
        'Child Page',
      );
      const parts = composed.split('/').filter(Boolean);
      // /notion/pages/by-parent/page-<parentSlug>__<parentShortId>/<pageSegment>.json
      assert.strictEqual(parts[2], 'by-parent');
      // Parent segment begins with the `<parentType>-` prefix (used to
      // discriminate page/database/workspace parents that share a UUID).
      assert.ok(parts[3]!.startsWith('page-'), `expected parent segment to start with 'page-', got ${parts[3]}`);
      const parentPayload = parts[3]!.slice('page-'.length);
      const parentParsed = parseNameWithId(parentPayload);
      assert.strictEqual(parentParsed.humanReadable, 'parent-page');
      assert.strictEqual(parentParsed.id, aliasShortId(PARENT_PAGE_UUID));
      const pageParsed = parseNameWithId(parts[4]!);
      assert.strictEqual(pageParsed.humanReadable, 'child-page');
      assert.strictEqual(pageParsed.id, aliasShortId(PAGE_UUID));
    });

    it('notionUserPath: id-only canonical (rename-safe), name suffix is optional', () => {
      // The canonical user record is keyed only on the UUID — title-mutable
      // identifiers must not appear in the canonical path per cloud#546's
      // tombstone-recovery rationale.
      assert.strictEqual(notionUserPath(USER_UUID), `/notion/users/${USER_UUID}.json`);
      // With a name argument the helper degrades to `<id>__<slug>.json`,
      // but that variant is reserved for non-canonical lookups and emit
      // doesn't call it for the canonical write path.
      assert.notStrictEqual(notionUserPath(USER_UUID), notionUserPath(USER_UUID, 'Sam Carter'));
    });
  });

  describe('normalizeNangoNotionModel', () => {
    // The Nango notion-relay `fetch-pages` sync emits records under the
    // `NotionPage` model — see
    // cloud/nango-integrations/notion-relay/syncs/fetch-pages.ts. The other
    // entries are forward-compatible for syncs we plan to add.
    it('maps NotionPage to the standalone page object type', () => {
      assert.strictEqual(normalizeNangoNotionModel('NotionPage'), 'page');
    });

    it('maps richer notion models for forward compatibility', () => {
      assert.strictEqual(normalizeNangoNotionModel('NotionDatabase'), 'database');
      assert.strictEqual(normalizeNangoNotionModel('NotionDatabasePage'), 'database_page');
      assert.strictEqual(normalizeNangoNotionModel('NotionBlock'), 'block');
      assert.strictEqual(normalizeNangoNotionModel('NotionComment'), 'comment');
    });

    it('throws on unknown models', () => {
      assert.throws(() => normalizeNangoNotionModel('NotionFlarb'));
    });

    it('try-variant returns undefined on unknown models', () => {
      assert.strictEqual(tryNormalizeNangoNotionModel('NotionFlarb'), undefined);
      assert.strictEqual(tryNormalizeNangoNotionModel('NotionPage'), 'page');
    });
  });
});
