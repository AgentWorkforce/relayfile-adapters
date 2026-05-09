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

    assert.deepEqual(rootDatabases, [
      { id: 'db-2', title: 'Roadmap / Q2', updated: '2026-04-03T10:00:00.000Z' },
      { id: 'db-1', title: 'Engineering Wiki', updated: '2026-04-02T10:00:00.000Z' },
    ]);
    assert.deepEqual(rootPages, [
      { id: 'page-a', title: 'Ops Notes', updated: '2026-04-04T10:00:00.000Z' },
      { id: 'page-b', title: 'Shared', updated: '2026-04-04T10:00:00.000Z' },
      { id: 'page-c', title: 'Shared', updated: '2026-04-01T05:00:00.000Z' },
    ]);
    assert.deepEqual(engineeringPages, [
      { id: 'page-1', title: 'Alpha / Beta', updated: '2026-04-02T09:00:00.000Z' },
      { id: 'page-2', title: 'Runbooks', updated: '2026-04-02T09:00:00.000Z' },
    ]);
    assert.deepEqual(roadmapPages, [
      { id: 'page-4', title: 'Notes', updated: '2026-04-03T09:00:00.000Z' },
      { id: 'page-5', title: 'Notes', updated: '2026-04-03T09:00:00.000Z' },
    ]);

    assert.equal(
      notionStandalonePagePath('page-1'),
      '/notion/pages/page-1.json',
      'existing standalone page paths must remain unchanged',
    );
    assert.equal(
      notionDatabasePagePath('db-1', 'page-1'),
      '/notion/databases/db-1/pages/page-1.json',
      'existing database page paths must remain unchanged',
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
      { id: 'db-3', title: 'Created only', updated: '2026-04-05T10:00:00.000Z' },
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
      { id: '', title: '', updated: '' },
      { id: '', title: '', updated: '' },
    ]);
  });
});
