import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildIndexFiles } from '../index-emitter.js';
import {
  notionDatabaseMetadataPath,
  notionDatabasePageCommentsPath,
  notionDatabasePageContentPath,
  notionDatabasePagePath,
  notionStandalonePageCommentsPath,
  notionStandalonePageContentPath,
  notionStandalonePagePath,
} from '../path-mapper.js';
import type { NotionVfsFile } from '../types.js';

function jsonFile(path: string, content: unknown): NotionVfsFile {
  return {
    path,
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(content)}\n`,
  };
}

function markdownFile(path: string): NotionVfsFile {
  return {
    path,
    contentType: 'text/markdown; charset=utf-8',
    content: '# content\n',
  };
}

function rawJsonFile(path: string, content: string): NotionVfsFile {
  return {
    path,
    contentType: 'application/json; charset=utf-8',
    content,
  };
}

function parseIndex(file: NotionVfsFile | undefined): unknown[] {
  assert.ok(file, 'expected index file to exist');
  assert.equal(file.contentType, 'application/json; charset=utf-8');
  return JSON.parse(file.content) as unknown[];
}

describe('notion index emission', () => {
  it('emits deterministic indexes for materialized notion directories and ignores nested artifacts', () => {
    const files: NotionVfsFile[] = [
      jsonFile(notionDatabaseMetadataPath('db-2', 'Roadmap / Q2'), {
        id: 'db-2',
        title: 'Roadmap / Q2',
        lastEditedTime: '2026-04-03T10:00:00.000Z',
      }),
      jsonFile(notionDatabasePagePath('db-2', 'page-4', 'Notes', 'Roadmap / Q2'), {
        id: 'page-4',
        title: 'Notes',
        createdTime: '2026-04-01T10:00:00.000Z',
        lastEditedTime: '2026-04-03T09:00:00.000Z',
      }),
      markdownFile(notionDatabasePageContentPath('db-2', 'page-4', 'Notes', 'Roadmap / Q2')),
      jsonFile(notionDatabasePageCommentsPath('db-2', 'page-4', 'Notes', 'Roadmap / Q2'), []),
      jsonFile(notionDatabasePagePath('db-2', 'page-5', 'Notes', 'Roadmap / Q2'), {
        id: 'page-5',
        title: 'Notes',
        createdTime: '2026-04-01T11:00:00.000Z',
        lastEditedTime: '2026-04-03T09:00:00.000Z',
      }),
      jsonFile(notionDatabaseMetadataPath('db-1', 'Engineering Wiki'), {
        id: 'db-1',
        title: 'Engineering Wiki',
        lastEditedTime: '2026-04-02T10:00:00.000Z',
      }),
      jsonFile(notionDatabasePagePath('db-1', 'page-2', 'Runbooks', 'Engineering Wiki'), {
        id: 'page-2',
        title: 'Runbooks',
        createdTime: '2026-04-01T08:00:00.000Z',
        lastEditedTime: '2026-04-02T09:00:00.000Z',
      }),
      markdownFile(notionDatabasePageContentPath('db-1', 'page-2', 'Runbooks', 'Engineering Wiki')),
      jsonFile(notionDatabasePagePath('db-1', 'page-1', 'Alpha / Beta', 'Engineering Wiki'), {
        id: 'page-1',
        title: 'Alpha / Beta',
        createdTime: '2026-04-01T07:00:00.000Z',
        lastEditedTime: '2026-04-02T09:00:00.000Z',
      }),
      jsonFile(notionDatabasePageCommentsPath('db-1', 'page-1', 'Alpha / Beta', 'Engineering Wiki'), []),
      jsonFile(notionStandalonePagePath('page-a', 'Ops Notes'), {
        id: 'page-a',
        title: 'Ops Notes',
        createdTime: '2026-04-01T04:00:00.000Z',
        lastEditedTime: '2026-04-04T10:00:00.000Z',
      }),
      markdownFile(notionStandalonePageContentPath('page-a', 'Ops Notes')),
      jsonFile(notionStandalonePageCommentsPath('page-a', 'Ops Notes'), []),
      jsonFile(notionStandalonePagePath('page-c', 'Shared'), {
        id: 'page-c',
        title: 'Shared',
        createdTime: '2026-04-01T05:00:00.000Z',
      }),
      jsonFile(notionStandalonePagePath('page-b', 'Shared'), {
        id: 'page-b',
        title: 'Shared',
        createdTime: '2026-04-01T06:00:00.000Z',
        lastEditedTime: '2026-04-04T10:00:00.000Z',
      }),
    ];

    const first = buildIndexFiles(files);
    const second = buildIndexFiles([...files].reverse());

    assert.deepEqual(first, second);

    const rootDatabases = parseIndex(first.find((file) => file.path === '/notion/databases/_index.json'));
    const rootPages = parseIndex(first.find((file) => file.path === '/notion/pages/_index.json'));
    const engineeringPages = parseIndex(
      first.find((file) => file.path === '/notion/databases/engineering-wiki__db-1/pages/_index.json'),
    );
    const roadmapPages = parseIndex(
      first.find((file) => file.path === '/notion/databases/roadmap-q2__db-2/pages/_index.json'),
    );

    // Index rows now carry parent_id and parent_type so an agent can
    // resolve workspace topology without crawling every record. The
    // fixtures in this test don't include `parent` blocks in the
    // canonical record payload, so every row falls back to
    // parent_id=null, parent_type='workspace'. A separate test below
    // exercises the database/page parent extraction path.
    const workspaceParentFields = { parent_id: null, parent_type: 'workspace' } as const;
    assert.deepEqual(rootDatabases, [
      { id: 'db-2', title: 'Roadmap / Q2', updated: '2026-04-03T10:00:00.000Z', ...workspaceParentFields },
      { id: 'db-1', title: 'Engineering Wiki', updated: '2026-04-02T10:00:00.000Z', ...workspaceParentFields },
    ]);
    assert.deepEqual(rootPages, [
      { id: 'page-a', title: 'Ops Notes', updated: '2026-04-04T10:00:00.000Z', ...workspaceParentFields },
      { id: 'page-b', title: 'Shared', updated: '2026-04-04T10:00:00.000Z', ...workspaceParentFields },
      { id: 'page-c', title: 'Shared', updated: '2026-04-01T05:00:00.000Z', ...workspaceParentFields },
    ]);
    assert.deepEqual(engineeringPages, [
      { id: 'page-1', title: 'Alpha / Beta', updated: '2026-04-02T09:00:00.000Z', ...workspaceParentFields },
      { id: 'page-2', title: 'Runbooks', updated: '2026-04-02T09:00:00.000Z', ...workspaceParentFields },
    ]);
    assert.deepEqual(roadmapPages, [
      { id: 'page-4', title: 'Notes', updated: '2026-04-03T09:00:00.000Z', ...workspaceParentFields },
      { id: 'page-5', title: 'Notes', updated: '2026-04-03T09:00:00.000Z', ...workspaceParentFields },
    ]);

    assert.equal(
      notionStandalonePagePath('page-1'),
      '/notion/pages/page-1/meta.json',
      'standalone pages must use directory records so child artifacts can live under the page',
    );
    assert.equal(
      notionDatabasePagePath('db-1', 'page-1'),
      '/notion/databases/db-1/pages/page-1/meta.json',
      'database pages must use directory records so child artifacts can live under the page',
    );
  });

  it('emits empty root indexes when notion sync materializes no records', () => {
    const indexFiles = buildIndexFiles([]);
    assert.deepEqual(
      indexFiles.map((file) => file.path),
      ['/notion/databases/_index.json', '/notion/pages/_index.json'],
    );
    assert.deepEqual(parseIndex(indexFiles[0]), []);
    assert.deepEqual(parseIndex(indexFiles[1]), []);
  });

  it('falls back to createdTime for database rows and re-exports index helpers from the barrel', async () => {
    const indexFiles = buildIndexFiles([
      jsonFile(notionDatabaseMetadataPath('db-3', 'Created only'), {
        id: 'db-3',
        title: 'Created only',
        createdTime: '2026-04-05T10:00:00.000Z',
      }),
    ]);

    assert.deepEqual(parseIndex(indexFiles[0]), [
      { id: 'db-3', title: 'Created only', updated: '2026-04-05T10:00:00.000Z', parent_id: null, parent_type: 'workspace' },
    ]);

    const barrel = await import('../index.js');
    assert.equal(barrel.buildIndexFiles, buildIndexFiles);
    assert.equal(typeof barrel.notionLayoutPromptFile, 'function');
  });

  it('falls back to empty row fields for malformed canonical record payloads', () => {
    const indexFiles = buildIndexFiles([
      rawJsonFile(notionStandalonePagePath('page-malformed', 'Malformed payload'), 'not json\n'),
      rawJsonFile(notionStandalonePagePath('page-array', 'Array payload'), '[]\n'),
    ]);

    assert.deepEqual(parseIndex(indexFiles[1]), [
      { id: '', title: '', updated: '', parent_id: null, parent_type: 'workspace' },
      { id: '', title: '', updated: '', parent_id: null, parent_type: 'workspace' },
    ]);
  });

  it('extracts parent_id and parent_type from notion parent discriminated unions', () => {
    const indexFiles = buildIndexFiles([
      jsonFile(notionStandalonePagePath('page-1', 'Child of database'), {
        id: 'page-1',
        title: 'Child of database',
        lastEditedTime: '2026-05-01T10:00:00.000Z',
        parent: { type: 'database_id', database_id: 'db-xyz' },
      }),
      jsonFile(notionStandalonePagePath('page-2', 'Child of page'), {
        id: 'page-2',
        title: 'Child of page',
        lastEditedTime: '2026-05-01T09:00:00.000Z',
        parent: { type: 'page_id', page_id: 'page-parent' },
      }),
      jsonFile(notionStandalonePagePath('page-3', 'Top level'), {
        id: 'page-3',
        title: 'Top level',
        lastEditedTime: '2026-05-01T08:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
      }),
    ]);

    const rootPages = parseIndex(indexFiles.find((file) => file.path === '/notion/pages/_index.json'));
    assert.deepEqual(rootPages, [
      {
        id: 'page-1',
        title: 'Child of database',
        updated: '2026-05-01T10:00:00.000Z',
        parent_id: 'db-xyz',
        parent_type: 'database',
      },
      {
        id: 'page-2',
        title: 'Child of page',
        updated: '2026-05-01T09:00:00.000Z',
        parent_id: 'page-parent',
        parent_type: 'page',
      },
      {
        id: 'page-3',
        title: 'Top level',
        updated: '2026-05-01T08:00:00.000Z',
        parent_id: null,
        parent_type: 'workspace',
      },
    ]);
  });

  it('builds a users _index.json carrying display name as title', () => {
    const indexFiles = buildIndexFiles([
      jsonFile('/notion/users/alice__user-1.json', {
        id: 'user-1',
        name: 'Alice Chen',
        lastEditedTime: '2026-05-02T10:00:00.000Z',
      }),
      jsonFile('/notion/users/bot__user-2.json', {
        id: 'user-2',
        name: 'Deploy Bot',
        lastEditedTime: '2026-05-02T09:00:00.000Z',
      }),
    ]);

    const usersIndex = indexFiles.find((file) => file.path === '/notion/users/_index.json');
    assert.ok(usersIndex, 'users _index.json should be emitted when user records exist');
    assert.deepEqual(parseIndex(usersIndex), [
      { id: 'user-1', title: 'Alice Chen', updated: '2026-05-02T10:00:00.000Z', parent_id: null, parent_type: 'workspace' },
      { id: 'user-2', title: 'Deploy Bot', updated: '2026-05-02T09:00:00.000Z', parent_id: null, parent_type: 'workspace' },
    ]);
  });
});
