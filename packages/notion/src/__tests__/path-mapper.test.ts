import { describe, expect, it } from 'vitest';
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
    expect(notionDatabaseMetadataPath('db-1')).toBe('/notion/databases/db-1/metadata.json');
    expect(computePath({ objectType: 'database', objectId: 'db-1' })).toBe('/notion/databases/db-1/metadata.json');
  });

  it('maps database page paths', () => {
    expect(notionDatabasePagePath('db-1', 'page-1')).toBe('/notion/databases/db-1/pages/page-1.json');
    expect(notionDatabasePageContentPath('db-1', 'page-1')).toBe('/notion/databases/db-1/pages/page-1/content.md');
    expect(notionDatabasePageCommentsPath('db-1', 'page-1')).toBe('/notion/databases/db-1/pages/page-1/comments.json');
    expect(notionDatabaseBlockPath('db-1', 'page-1', 'block-1')).toBe('/notion/databases/db-1/pages/page-1/blocks/block-1.json');
  });

  it('maps standalone page paths', () => {
    expect(notionStandalonePagePath('page-1')).toBe('/notion/pages/page-1.json');
    expect(notionStandalonePageContentPath('page-1')).toBe('/notion/pages/page-1/content.md');
    expect(notionStandalonePageCommentsPath('page-1')).toBe('/notion/pages/page-1/comments.json');
  });
});
