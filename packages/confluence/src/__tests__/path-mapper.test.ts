import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeConfluencePath,
  confluenceByIdAliasPath,
  confluenceByTitleAliasPath,
  confluencePageByIdAliasPath,
  confluencePageByStatePath,
  confluencePageByTitleAliasPath,
  confluencePagePath,
  confluencePagesIndexPath,
  confluenceProviderRootIndexPath,
  confluenceSpaceByIdAliasPath,
  confluenceSpacePath,
  confluenceSpacesIndexPath,
  extractConfluenceIdFromPathSegment,
  nameWithId,
  normalizeConfluenceObjectType,
  normalizeNangoConfluenceModel,
  parseNameWithId,
  slugifyStatusName,
  tryNormalizeConfluenceObjectType,
} from '../path-mapper.js';

describe('confluence path-mapper', () => {
  describe('normalizeConfluenceObjectType', () => {
    it('accepts canonical and plural variants', () => {
      assert.equal(normalizeConfluenceObjectType('page'), 'page');
      assert.equal(normalizeConfluenceObjectType('PAGES'), 'page');
      assert.equal(normalizeConfluenceObjectType('Space'), 'space');
      assert.equal(normalizeConfluenceObjectType('spaces'), 'space');
    });

    it('accepts Nango-style PascalCase model names', () => {
      assert.equal(normalizeNangoConfluenceModel('ConfluencePage'), 'page');
      assert.equal(normalizeNangoConfluenceModel('ConfluenceSpace'), 'space');
    });

    it('throws on unknown types', () => {
      assert.throws(() => normalizeConfluenceObjectType('flarb'));
      assert.equal(tryNormalizeConfluenceObjectType('flarb'), undefined);
    });
  });

  describe('nameWithId', () => {
    it('produces <slug>__<id> for page and space leaves', () => {
      assert.equal(confluencePagePath('98765', 'Release Plan'), '/confluence/pages/release-plan__98765.json');
      assert.equal(confluenceSpacePath('12345', 'Engineering Docs'), '/confluence/spaces/engineering-docs__12345.json');
    });

    it('falls back to <id>.json when the title is missing or slugs to nothing', () => {
      assert.equal(confluencePagePath('98765'), '/confluence/pages/98765.json');
      assert.equal(confluencePagePath('98765', '   '), '/confluence/pages/98765.json');
      assert.equal(confluencePagePath('98765', '{{}}'), '/confluence/pages/98765.json');
    });

    it('emits a space-scoped page path under spaces/<spaceId>/pages', () => {
      assert.equal(
        computeConfluencePath('page', '98765', { title: 'Release Plan', spaceId: '12345' }),
        '/confluence/spaces/12345/pages/release-plan__98765.json',
      );
    });

    it('disambiguates collisions with an 8-char hash suffix', () => {
      const seen = new Set<string>();
      const first = nameWithId('Roadmap', 'page-1', { existingNames: seen });
      const second = nameWithId('Roadmap', 'page-2', { existingNames: seen });
      assert.equal(first, 'roadmap__page-1');
      assert.match(second, /^roadmap-[0-9a-f]{8}__page-2$/u);
    });
  });

  describe('parseNameWithId', () => {
    it('splits <slug>__<id>.json leaves', () => {
      assert.deepEqual(parseNameWithId('release-plan__98765.json'), {
        humanReadable: 'release-plan',
        id: '98765',
        ext: 'json',
      });
    });

    it('returns a bare id when the leaf has no slug prefix', () => {
      assert.deepEqual(parseNameWithId('98765.json'), {
        humanReadable: null,
        id: '98765',
        ext: 'json',
      });
    });
  });

  describe('index paths', () => {
    it('returns canonical bucket and root index paths', () => {
      assert.equal(confluencePagesIndexPath(), '/confluence/pages/_index.json');
      assert.equal(confluenceSpacesIndexPath(), '/confluence/spaces/_index.json');
      assert.equal(confluenceProviderRootIndexPath(), '/confluence/_index.json');
    });
  });

  describe('alias paths', () => {
    it('produces by-id and by-title alias paths for pages and spaces', () => {
      assert.equal(confluencePageByIdAliasPath('98765'), '/confluence/pages/by-id/98765.json');
      assert.equal(
        confluencePageByTitleAliasPath('Release Plan', '98765'),
        '/confluence/pages/by-title/release-plan.json',
      );
      assert.equal(confluenceSpaceByIdAliasPath('12345'), '/confluence/spaces/by-id/12345.json');
      assert.equal(
        confluenceByIdAliasPath('/confluence/spaces', 'ENG'),
        '/confluence/spaces/by-id/ENG.json',
      );
      assert.equal(
        confluenceByTitleAliasPath('/confluence/spaces', 'Engineering Docs', '12345'),
        '/confluence/spaces/by-title/engineering-docs.json',
      );
    });

    it('emits a by-state alias path for canonical page statuses', () => {
      assert.equal(confluencePageByStatePath('current', '98765'), '/confluence/pages/by-state/current/98765.json');
      assert.equal(confluencePageByStatePath('draft', '98765'), '/confluence/pages/by-state/draft/98765.json');
      assert.equal(confluencePageByStatePath('archived', '98765'), '/confluence/pages/by-state/archived/98765.json');
    });

    it('rejects empty status names', () => {
      assert.throws(() => slugifyStatusName('   '));
    });
  });

  describe('extractConfluenceIdFromPathSegment', () => {
    it('decodes both the v2 __ separator and the legacy -- separator', () => {
      assert.equal(extractConfluenceIdFromPathSegment('release-plan__98765'), '98765');
      assert.equal(extractConfluenceIdFromPathSegment('release-plan--98765'), '98765');
      assert.equal(extractConfluenceIdFromPathSegment('98765'), '98765');
    });
  });
});
