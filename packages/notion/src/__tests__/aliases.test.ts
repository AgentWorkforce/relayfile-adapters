import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { slugifyAlias } from '../alias-slug.js';
import { writeWorkspaceFiles } from '../bulk-ingest.js';
import { ingestPageArtifacts } from '../pages/ingestion.js';
import {
  notionByIdAliasPath,
  notionByTitleAliasPath,
  notionDatabasePagesCollectionPath,
  notionStandalonePagesCollectionPath,
} from '../path-mapper.js';
import type { NotionPage, NotionRichText } from '../types.js';

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

  it('slugging is deterministic, ASCII-folded, and strips traversal characters', () => {
    assert.strictEqual(slugifyAlias('Café ../ Roadmap'), 'cafe-roadmap');
    assert.strictEqual(slugifyAlias('Café ../ Roadmap'), slugifyAlias('Café ../ Roadmap'));
  });
});
