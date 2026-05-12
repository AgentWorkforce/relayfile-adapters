import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { slugifyAlias } from '../alias-slug.js';
import { writeWorkspaceFiles } from '../bulk-ingest.js';
import { buildIndexFiles } from '../index-emitter.js';
import { ingestPageArtifacts } from '../pages/ingestion.js';
import {
  notionByIdAliasPath,
  notionByNameAliasPath,
  notionByTitleAliasPath,
  notionDatabaseMetadataPath,
  notionDatabasesCollectionPath,
  notionDatabasePagesCollectionPath,
  notionStandalonePagePath,
  notionStandalonePagesCollectionPath,
  notionUserPath,
  notionUsersCollectionPath,
} from '../path-mapper.js';
import type { NotionPage, NotionRichText, NotionVfsFile } from '../types.js';

function createRelayClient() {
  const files = new Map<string, { content: string; revision: string }>();
  let revisionCounter = 0;

  return {
    files,
    client: {
      async readFile(_workspaceId: string, path: string) {
        const existing = files.get(path);
        if (!existing) {
          throw new Error(`Missing file: ${path}`);
        }

        return existing;
      },
      async writeFile(input: { path: string; content: string }) {
        revisionCounter += 1;
        files.set(input.path, {
          content: input.content,
          revision: String(revisionCounter),
        });
        return { id: String(revisionCounter), status: 'queued' as const };
      },
    },
  };
}

function createClient() {
  return {
    config: {
      enableMarkdown: false,
      fetchBlockJson: false,
      fetchComments: false,
    },
  } as never;
}

function createPage(id: string, title?: string): NotionPage {
  return {
    object: 'page',
    id,
    parent: { type: 'workspace', workspace: true },
    properties: title
      ? {
          Name: {
            id: 'title',
            type: 'title',
            title: [createText(title)],
          },
        }
      : {},
  };
}

function createDatabasePage(id: string, databaseId: string, title?: string): NotionPage {
  return {
    ...createPage(id, title),
    parent: { type: 'database_id', database_id: databaseId },
  };
}

function createText(content: string): NotionRichText {
  return {
    type: 'text',
    text: { content, link: null },
    plain_text: content,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
    href: null,
  };
}

function vfsJsonFile(
  path: string,
  content: Record<string, unknown>,
  aliasMetadata?: NotionVfsFile['aliasMetadata'],
): NotionVfsFile {
  return {
    path,
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(content)}\n`,
    aliasMetadata,
  };
}

describe('notion aliases', () => {
  it('writes by-title and by-id aliases plus the parent _index.json', async () => {
    const relay = createRelayClient();
    const page = createPage('11111111-1111-1111-1111-111111111111', 'Cafe roadmap');
    const files = await ingestPageArtifacts(createClient(), page);
    const canonicalPath = files[0]?.path ?? '';
    const scope = notionStandalonePagesCollectionPath();

    await writeWorkspaceFiles(relay.client as never, 'ws-notion', files);

    const byIdPath = notionByIdAliasPath(scope, page.id);
    const byTitlePath = notionByTitleAliasPath(scope, 'Cafe roadmap', page.id);
    const canonical = await relay.client.readFile('ws-notion', canonicalPath);
    const byId = await relay.client.readFile('ws-notion', byIdPath);
    const byTitle = await relay.client.readFile('ws-notion', byTitlePath);
    assert.strictEqual(byId.content, canonical.content);
    assert.strictEqual(byTitle.content, canonical.content);

    const index = JSON.parse((await relay.client.readFile('ws-notion', `${scope}/_index.json`)).content) as {
      rows: Array<{ file: string }>;
    };
    assert.deepStrictEqual(
      index.rows.map((row) => row.file),
      ['by-id/', 'by-title/'],
    );
  });

  it('skips by-title when the page has no explicit title but still writes by-id', async () => {
    const relay = createRelayClient();
    const page = createPage('22222222-2222-2222-2222-222222222222');
    const files = await ingestPageArtifacts(createClient(), page);
    const scope = notionStandalonePagesCollectionPath();

    await writeWorkspaceFiles(relay.client as never, 'ws-notion', files);

    assert.ok(relay.files.has(notionByIdAliasPath(scope, page.id)));
    assert.equal(
      Array.from(relay.files.keys()).some((path) => path.startsWith(`${scope}/by-title/`)),
      false,
    );
  });

  it('writes a hashed by-title alias on collision and keeps canonical bytes aligned', async () => {
    const relay = createRelayClient();
    const firstPage = createPage('33333333-3333-3333-3333-333333333333', 'Café');
    const secondPage = createPage('44444444-4444-4444-4444-444444444444', 'Cafe');
    const firstFiles = await ingestPageArtifacts(createClient(), firstPage);
    const secondFiles = await ingestPageArtifacts(createClient(), secondPage);
    const scope = notionStandalonePagesCollectionPath();

    await writeWorkspaceFiles(relay.client as never, 'ws-notion', firstFiles);
    await writeWorkspaceFiles(relay.client as never, 'ws-notion', secondFiles);

    const firstCanonicalPath = firstFiles[0]?.path ?? '';
    const secondCanonicalPath = secondFiles[0]?.path ?? '';
    const baseAliasPath = notionByTitleAliasPath(scope, 'Cafe', firstPage.id);
    const collisionAliasPath = notionByTitleAliasPath(scope, 'Cafe', secondPage.id, true);

    const firstCanonical = await relay.client.readFile('ws-notion', firstCanonicalPath);
    const secondCanonical = await relay.client.readFile('ws-notion', secondCanonicalPath);
    const baseAlias = await relay.client.readFile('ws-notion', baseAliasPath);
    const collisionAlias = await relay.client.readFile('ws-notion', collisionAliasPath);

    assert.strictEqual(baseAlias.content, firstCanonical.content);
    assert.strictEqual(collisionAlias.content, secondCanonical.content);
  });

  it('writes database-scoped page aliases through the same read surface as standalone pages', async () => {
    const relay = createRelayClient();
    const databaseId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const databaseTitle = 'Product Specs';
    const page = createDatabasePage('55555555-5555-5555-5555-555555555555', databaseId, 'Launch Checklist');
    const files = await ingestPageArtifacts(createClient(), page, { databaseId, databaseTitle });
    const canonicalPath = files[0]?.path ?? '';
    const scope = notionDatabasePagesCollectionPath(databaseId, databaseTitle);

    await writeWorkspaceFiles(relay.client as never, 'ws-notion', files);

    const canonical = await relay.client.readFile('ws-notion', canonicalPath);
    const byId = await relay.client.readFile('ws-notion', notionByIdAliasPath(scope, page.id));
    const byTitle = await relay.client.readFile('ws-notion', notionByTitleAliasPath(scope, 'Launch Checklist', page.id));

    assert.strictEqual(byId.content, canonical.content);
    assert.strictEqual(byTitle.content, canonical.content);
  });

  it('preserves generated record indexes when bulk writes also materialize aliases', async () => {
    const relay = createRelayClient();
    const databaseId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const databaseTitle = 'Engineering Wiki';
    const pageId = '11111111-2222-3333-4444-555555555555';
    const pageTitle = 'Launch Checklist';
    const userId = '99999999-aaaa-bbbb-cccc-dddddddddddd';
    const userName = 'Alice Chen';
    const sourceFiles: NotionVfsFile[] = [
      vfsJsonFile(
        notionDatabaseMetadataPath(databaseId, databaseTitle),
        {
          id: databaseId,
          title: databaseTitle,
          lastEditedTime: '2026-05-01T10:00:00.000Z',
        },
        {
          scopePath: notionDatabasesCollectionPath(),
          id: databaseId,
          title: databaseTitle,
          aliasKind: 'database',
        },
      ),
      vfsJsonFile(
        notionStandalonePagePath(pageId, pageTitle),
        {
          id: pageId,
          title: pageTitle,
          lastEditedTime: '2026-05-01T09:00:00.000Z',
          parent: { type: 'workspace', workspace: true },
        },
        {
          scopePath: notionStandalonePagesCollectionPath(),
          id: pageId,
          title: pageTitle,
          aliasKind: 'page',
        },
      ),
      vfsJsonFile(
        notionUserPath(userId, userName),
        {
          id: userId,
          name: userName,
          lastEditedTime: '2026-05-01T08:00:00.000Z',
        },
        {
          scopePath: notionUsersCollectionPath(),
          id: userId,
          name: userName,
          aliasKind: 'user',
        },
      ),
    ];

    await writeWorkspaceFiles(relay.client as never, 'ws-notion', [
      ...sourceFiles,
      ...buildIndexFiles(sourceFiles),
    ]);

    assert.deepEqual(JSON.parse((await relay.client.readFile('ws-notion', '/notion/databases/_index.json')).content), [
      {
        id: databaseId,
        title: databaseTitle,
        updated: '2026-05-01T10:00:00.000Z',
        parent_id: null,
        parent_type: 'workspace',
      },
    ]);
    assert.deepEqual(JSON.parse((await relay.client.readFile('ws-notion', '/notion/pages/_index.json')).content), [
      {
        id: pageId,
        title: pageTitle,
        updated: '2026-05-01T09:00:00.000Z',
        parent_id: null,
        parent_type: 'workspace',
      },
    ]);
    assert.deepEqual(JSON.parse((await relay.client.readFile('ws-notion', '/notion/users/_index.json')).content), [
      {
        id: userId,
        title: userName,
        updated: '2026-05-01T08:00:00.000Z',
        parent_id: null,
        parent_type: 'workspace',
      },
    ]);

    assert.ok(relay.files.has(notionByIdAliasPath(notionDatabasesCollectionPath(), databaseId)));
    assert.ok(relay.files.has(notionByTitleAliasPath(notionDatabasesCollectionPath(), databaseTitle, databaseId)));
    assert.ok(relay.files.has(notionByIdAliasPath(notionStandalonePagesCollectionPath(), pageId)));
    assert.ok(relay.files.has(notionByTitleAliasPath(notionStandalonePagesCollectionPath(), pageTitle, pageId)));
    assert.ok(relay.files.has(notionByIdAliasPath(notionUsersCollectionPath(), userId)));
    assert.ok(relay.files.has(notionByNameAliasPath(notionUsersCollectionPath(), userName, userId)));
  });

  it('slugging is deterministic, ASCII-folded, and strips traversal characters', () => {
    assert.strictEqual(slugifyAlias('Café ../ Roadmap'), 'cafe-roadmap');
    assert.strictEqual(slugifyAlias('Café ../ Roadmap'), slugifyAlias('Café ../ Roadmap'));
  });

  it('materializes /notion/pages/by-database/<db>/<page>.json for database pages', async () => {
    // Cross-reference alias: a database page is reachable both at its
    // canonical /notion/databases/<db>/pages/... path AND at the global
    // /notion/pages/by-database/... mirror. Both share the same content
    // so an agent can pivot from "find the row in my Tasks db titled X"
    // to a writeback target without re-querying the index.
    const relay = createRelayClient();
    const databaseId = 'aaaaaaaa-bbbb-cccc-dddd-deadbeef0001';
    const databaseTitle = 'Tasks';
    const pageId = '66666666-6666-6666-6666-deadbeef0002';
    const page = createDatabasePage(pageId, databaseId, 'Launch Checklist');
    const files = await ingestPageArtifacts(createClient(), page, { databaseId, databaseTitle });

    await writeWorkspaceFiles(relay.client as never, 'ws-notion', files);

    // short_id is the trailing 8 hex chars of the dehyphenated UUID.
    // dbId ends in `deadbeef0001` → short_id `beef0001`;
    // pageId ends in `deadbeef0002` → short_id `beef0002`.
    const byDatabasePath = '/notion/pages/by-database/tasks__beef0001/launch-checklist__beef0002.json';
    const byDatabase = await relay.client.readFile('ws-notion', byDatabasePath);
    const canonical = await relay.client.readFile('ws-notion', files[0]?.path ?? '');
    assert.strictEqual(byDatabase.content, canonical.content);
  });

  it('materializes /notion/pages/by-parent/<type>-<parent>/<page>.json for child pages', async () => {
    // The by-parent alias mirrors Notion's hierarchical workspace model.
    // Pages with a workspace parent are intentionally skipped (the
    // workspace bucket would collect every top-level page and lose its
    // navigational value), but pages with a page_id parent must land
    // here so an agent can list direct children of a parent page.
    const relay = createRelayClient();
    const parentPageId = 'cccccccc-cccc-cccc-cccc-deadbeef1000';
    const childId = 'cccccccc-cccc-cccc-cccc-deadbeef2000';
    const child: NotionPage = {
      ...createPage(childId, 'Implementation notes'),
      parent: { type: 'page_id', page_id: parentPageId },
    };
    const files = await ingestPageArtifacts(createClient(), child);

    await writeWorkspaceFiles(relay.client as never, 'ws-notion', files);

    const matchingAlias = Array.from(relay.files.keys()).find((path) =>
      path.startsWith('/notion/pages/by-parent/page-') && path.endsWith('beef2000.json'),
    );
    assert.ok(matchingAlias, `expected a by-parent alias for child page, saw: ${[...relay.files.keys()].join(', ')}`);
    const canonical = await relay.client.readFile('ws-notion', files[0]?.path ?? '');
    const aliasContent = await relay.client.readFile('ws-notion', matchingAlias);
    assert.strictEqual(aliasContent.content, canonical.content);
  });

  it('skips by-parent emit for workspace-rooted pages', async () => {
    const relay = createRelayClient();
    // createPage defaults to { type: 'workspace', workspace: true }.
    const page = createPage('77777777-7777-7777-7777-777777777777', 'Workspace top-level');
    const files = await ingestPageArtifacts(createClient(), page);

    await writeWorkspaceFiles(relay.client as never, 'ws-notion', files);

    const byParentPaths = Array.from(relay.files.keys()).filter((path) =>
      path.startsWith('/notion/pages/by-parent/'),
    );
    assert.deepStrictEqual(
      byParentPaths,
      [],
      'workspace-rooted pages must not materialize a by-parent alias',
    );
  });
});
