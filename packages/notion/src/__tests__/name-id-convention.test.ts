import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';
import test from 'node:test';

import { collectWorkspaceFiles } from '../bulk-ingest.js';
import { nameWithId, parseNameWithId } from '../path-mapper.js';
import type { NotionApiClient } from '../client.js';
import type {
  NotionBlock,
  NotionComment,
  NotionDatabase,
  NotionPage,
  NotionPaginatedRequestOptions,
  NotionRequestOptions,
  NotionRichText,
} from '../types.js';

const DATABASE_ID = '11111111-1111-1111-1111-111111111111';
const PAGE_ID_A = '22222222-2222-2222-2222-222222222222';
const PAGE_ID_B = '33333333-3333-3333-3333-333333333333';
const STANDALONE_PAGE_ID = '44444444-4444-4444-4444-444444444444';

test('collectWorkspaceFiles emits canonical <name>__<id> Notion filenames and parseNameWithId round-trips ids', async () => {
  const client = createFakeClient() as NotionApiClient;

  const files = await collectWorkspaceFiles(client);
  const paths = files.map((file) => file.path).sort();

  assert.ok(paths.includes('/notion/databases/roadmap__11111111-1111-1111-1111-111111111111/metadata.json'));
  assert.ok(paths.includes('/notion/databases/roadmap__11111111-1111-1111-1111-111111111111/pages/creme-brulee__22222222-2222-2222-2222-222222222222/meta.json'));
  assert.ok(paths.includes('/notion/databases/roadmap__11111111-1111-1111-1111-111111111111/pages/creme-brulee__22222222-2222-2222-2222-222222222222/content.md'));
  assert.ok(paths.includes('/notion/databases/roadmap__11111111-1111-1111-1111-111111111111/pages/creme-brulee__22222222-2222-2222-2222-222222222222/comments.json'));
  assert.ok(paths.includes('/notion/databases/roadmap__11111111-1111-1111-1111-111111111111/pages/creme-brulee__22222222-2222-2222-2222-222222222222/blocks/block-1.json'));
  assert.ok(paths.includes('/notion/pages/standalone-page__44444444-4444-4444-4444-444444444444/meta.json'));

  const parsedDatabasePage = parseNameWithId(basename(dirname('/notion/databases/roadmap__11111111-1111-1111-1111-111111111111/pages/creme-brulee__22222222-2222-2222-2222-222222222222/meta.json')));
  assert.deepEqual(parsedDatabasePage, {
    humanReadable: 'creme-brulee',
    id: PAGE_ID_A,
    ext: null,
  });

  const parsedDatabaseDir = parseNameWithId('roadmap__11111111-1111-1111-1111-111111111111');
  assert.deepEqual(parsedDatabaseDir, {
    humanReadable: 'roadmap',
    id: DATABASE_ID,
    ext: null,
  });
});

test('collectWorkspaceFiles applies a deterministic collision hash suffix for duplicate page slugs', async () => {
  const client = createFakeClient() as NotionApiClient;

  const firstRun = await collectWorkspaceFiles(client);
  const secondRun = await collectWorkspaceFiles(client);
  const expectedSuffix = createHash('sha256').update(PAGE_ID_B).digest('hex').slice(0, 8);
  const expectedPath =
    `/notion/databases/roadmap__${DATABASE_ID}/pages/creme-brulee-${expectedSuffix}__${PAGE_ID_B}/meta.json`;

  assert.ok(firstRun.some((file) => file.path === expectedPath));
  assert.ok(secondRun.some((file) => file.path === expectedPath));
});

test('nameWithId caps the human-readable segment at 80 chars after ASCII folding', () => {
  const longTitle = 'Über'.repeat(60);
  const named = nameWithId(longTitle, PAGE_ID_A);
  const parsed = parseNameWithId(`${named}.json`);

  assert.ok(parsed.humanReadable !== null);
  assert.ok(parsed.humanReadable.length <= 80);
  assert.equal(parsed.id, PAGE_ID_A);
});

test('nameWithId truncation prefers the last hyphen boundary and hard-cuts when none exists', () => {
  const boundaryAwareTitle = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma';
  const boundaryAware = parseNameWithId(`${nameWithId(boundaryAwareTitle, PAGE_ID_A)}.json`);
  const hardCut = parseNameWithId(`${nameWithId('a'.repeat(120), PAGE_ID_A)}.json`);

  assert.equal(boundaryAware.humanReadable, 'alpha-beta-gamma-delta-epsilon-zeta-eta-theta-iota-kappa-lambda-mu-nu-xi');
  assert.equal(hardCut.humanReadable, 'a'.repeat(80));
});

test('nameWithId drops empty or punctuation-only human-readable segments to a bare id filename', () => {
  assert.equal(nameWithId(undefined, PAGE_ID_A), PAGE_ID_A);
  assert.equal(nameWithId('!!!', PAGE_ID_A), PAGE_ID_A);
});

test('parseNameWithId treats non-conforming filenames as bare ids', () => {
  assert.deepEqual(parseNameWithId('metadata.json'), {
    humanReadable: null,
    id: 'metadata',
    ext: 'json',
  });
});

function createFakeClient(): Pick<NotionApiClient, 'config' | 'paginate' | 'request'> {
  const database = buildDatabase(DATABASE_ID, 'Roadmap');
  const databasePages = [
    buildPage(PAGE_ID_A, 'Crème brûlée', { type: 'database_id', database_id: DATABASE_ID }),
    buildPage(PAGE_ID_B, 'Crème brûlée!!!', { type: 'database_id', database_id: DATABASE_ID }),
  ];
  const standalonePage = buildPage(STANDALONE_PAGE_ID, 'Standalone Page', { type: 'workspace', workspace: true });
  const blocksByPage = new Map<string, NotionBlock[]>([
    [PAGE_ID_A, [buildParagraphBlock('block-1', PAGE_ID_A, 'Page A body')]],
    [PAGE_ID_B, [buildParagraphBlock('block-2', PAGE_ID_B, 'Page B body')]],
    [STANDALONE_PAGE_ID, [buildParagraphBlock('block-3', STANDALONE_PAGE_ID, 'Standalone body')]],
  ]);
  const commentsByPage = new Map<string, NotionComment[]>([
    [PAGE_ID_A, [buildComment('comment-1', PAGE_ID_A, 'Looks good')]],
    [PAGE_ID_B, [buildComment('comment-2', PAGE_ID_B, 'Needs follow-up')]],
    [STANDALONE_PAGE_ID, [buildComment('comment-3', STANDALONE_PAGE_ID, 'Standalone note')]],
  ]);
  const pageById = new Map<string, NotionPage>([
    [PAGE_ID_A, databasePages[0]],
    [PAGE_ID_B, databasePages[1]],
    [STANDALONE_PAGE_ID, standalonePage],
  ]);

  return {
    config: {
      apiBaseUrl: 'https://api.notion.com',
      apiVersion: '2022-06-28',
      markdownApiVersion: '2026-03-11',
      token: 'test-token',
      connectionId: undefined,
      databaseIds: [DATABASE_ID],
      pageIds: [STANDALONE_PAGE_ID],
      discoveryConcurrency: undefined,
      defaultPageSize: 100,
      fetchComments: true,
      fetchBlockJson: true,
      enableMarkdown: false,
    },
    async request<T>(
      _method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
      endpoint: string,
      _options?: NotionRequestOptions,
    ): Promise<T> {
      if (endpoint === `/v1/databases/${encodeURIComponent(DATABASE_ID)}`) {
        return database as T;
      }

      if (endpoint.startsWith('/v1/pages/')) {
        const pageId = decodeURIComponent(endpoint.slice('/v1/pages/'.length));
        const page = pageById.get(pageId);
        if (page) {
          return page as T;
        }
      }

      throw new Error(`Unhandled request ${endpoint}`);
    },
    async paginate<T>(
      _method: 'GET' | 'POST',
      endpoint: string,
      options?: NotionPaginatedRequestOptions,
    ): Promise<T[]> {
      if (endpoint === `/v1/databases/${encodeURIComponent(DATABASE_ID)}/query`) {
        return databasePages as T[];
      }

      if (endpoint.startsWith('/v1/blocks/')) {
        const pageId = decodeURIComponent(endpoint.slice('/v1/blocks/'.length, endpoint.lastIndexOf('/children')));
        return (blocksByPage.get(pageId) ?? []) as T[];
      }

      if (endpoint === '/v1/comments') {
        const pageId = typeof options?.query?.block_id === 'string' ? options.query.block_id : '';
        return (commentsByPage.get(pageId) ?? []) as T[];
      }

      throw new Error(`Unhandled paginate ${endpoint}`);
    },
  };
}

function buildDatabase(id: string, title: string): NotionDatabase {
  return {
    object: 'database',
    id,
    title: [buildRichText(title)],
    description: [],
    properties: {},
  };
}

function buildPage(id: string, title: string, parent: NotionPage['parent']): NotionPage {
  return {
    object: 'page',
    id,
    parent,
    properties: {
      Name: {
        id: 'title',
        type: 'title',
        title: [buildRichText(title)],
      },
    },
  };
}

function buildComment(id: string, pageId: string, text: string): NotionComment {
  return {
    object: 'comment',
    id,
    discussion_id: `discussion-${id}`,
    parent: { type: 'page_id', page_id: pageId },
    created_time: '2026-05-01T00:00:00.000Z',
    last_edited_time: '2026-05-01T00:00:00.000Z',
    rich_text: [buildRichText(text)],
  } as NotionComment;
}

function buildParagraphBlock(id: string, pageId: string, text: string): NotionBlock {
  return {
    object: 'block',
    id,
    type: 'paragraph',
    has_children: false,
    parent: { type: 'page_id', page_id: pageId },
    last_edited_time: '2026-05-01T00:00:00.000Z',
    paragraph: {
      rich_text: [buildRichText(text)],
      color: 'default',
    },
  } as NotionBlock;
}

function buildRichText(text: string): NotionRichText {
  return {
    type: 'text',
    text: { content: text, link: null },
    plain_text: text,
    href: null,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
  };
}
