import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePath,
  normalizeNangoNotionModel,
  notionByIdAliasPath,
  notionByTitleAliasPath,
  notionDatabaseBlockPath,
  notionDatabaseMetadataPath,
  notionDatabasePageCommentsPath,
  notionDatabasePageContentPath,
  notionDatabasePagePath,
  notionStandalonePagesCollectionPath,
  notionStandalonePageCommentsPath,
  notionStandalonePageContentPath,
  notionStandalonePagePath,
  tryNormalizeNangoNotionModel,
} from '../path-mapper.js';

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
