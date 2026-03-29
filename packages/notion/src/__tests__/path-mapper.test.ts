import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePath,
  notionDatabaseBlockPath,
  notionDatabaseMetadataPath,
  notionDatabasePageCommentsPath,
  notionDatabasePageContentPath,
  notionDatabasePagePath,
  notionStandalonePageCommentsPath,
  notionStandalonePageContentPath,
  notionStandalonePagePath,
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
});
