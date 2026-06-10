import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanupStaleAliases, readAliasKeyFromContent, type StaleAliasCleanupIo } from '../../src/alias-lifecycle.js';

function createMemoryIo(initialEntries: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialEntries));
  const deleted: string[] = [];
  const io: StaleAliasCleanupIo = {
    readFile: (path) => files.get(path),
    deleteFile: (path) => {
      files.delete(path);
      deleted.push(path);
    },
  };
  return { files, deleted, io };
}

describe('cleanupStaleAliases', () => {
  it('deletes a stale alias whose bytes match the previous record snapshot', async () => {
    const previousContent = '{"title":"Old title"}\n';
    const { files, deleted, io } = createMemoryIo({
      '/scope/by-title/old-title.json': previousContent,
      '/scope/by-title/new-title.json': '{"title":"New title"}\n',
    });

    const result = await cleanupStaleAliases(io, {
      previousContent,
      candidatePaths: ['/scope/by-title/old-title.json'],
      keepPaths: ['/scope/by-title/new-title.json'],
    });

    assert.deepEqual(result.deletedPaths, ['/scope/by-title/old-title.json']);
    assert.deepEqual(result.errors, []);
    assert.equal(files.has('/scope/by-title/old-title.json'), false);
    assert.equal(files.has('/scope/by-title/new-title.json'), true);
    assert.deepEqual(deleted, ['/scope/by-title/old-title.json']);
  });

  it('never deletes paths listed in keepPaths, even when content matches', async () => {
    const previousContent = '{"title":"Same"}\n';
    const { files, io } = createMemoryIo({
      '/scope/by-title/same.json': previousContent,
    });

    const result = await cleanupStaleAliases(io, {
      previousContent,
      candidatePaths: ['/scope/by-title/same.json'],
      keepPaths: ['/scope/by-title/same.json'],
    });

    assert.deepEqual(result.deletedPaths, []);
    assert.equal(files.has('/scope/by-title/same.json'), true);
  });

  it('leaves aliases owned by other records (content mismatch) untouched', async () => {
    const { files, io } = createMemoryIo({
      '/scope/by-title/shared-slug.json': '{"id":"other-record"}\n',
    });

    const result = await cleanupStaleAliases(io, {
      previousContent: '{"id":"this-record"}\n',
      candidatePaths: ['/scope/by-title/shared-slug.json'],
    });

    assert.deepEqual(result.deletedPaths, []);
    assert.equal(files.has('/scope/by-title/shared-slug.json'), true);
  });

  it('skips missing candidates and deduplicates repeated paths', async () => {
    const { deleted, io } = createMemoryIo();

    const result = await cleanupStaleAliases(io, {
      previousContent: '{"title":"Gone"}\n',
      candidatePaths: ['/scope/by-title/gone.json', '/scope/by-title/gone.json', ''],
    });

    assert.deepEqual(result.deletedPaths, []);
    assert.deepEqual(deleted, []);
  });

  it('captures read/delete failures as errors without throwing', async () => {
    const previousContent = 'snapshot';
    const io: StaleAliasCleanupIo = {
      readFile: (path) => {
        if (path === '/read-fails.json') {
          throw new Error('read boom');
        }
        return previousContent;
      },
      deleteFile: () => {
        throw new Error('delete boom');
      },
    };

    const result = await cleanupStaleAliases(io, {
      previousContent,
      candidatePaths: ['/read-fails.json', '/delete-fails.json'],
    });

    assert.deepEqual(result.deletedPaths, []);
    assert.deepEqual(
      result.errors,
      [
        { path: '/read-fails.json', error: 'read boom' },
        { path: '/delete-fails.json', error: 'delete boom' },
      ],
    );
  });
});

describe('readAliasKeyFromContent', () => {
  it('reads top-level and nested string fields', () => {
    assert.equal(readAliasKeyFromContent('{"title":"Hello"}', 'title'), 'Hello');
    assert.equal(
      readAliasKeyFromContent('{"payload":{"name":"Roadmap"}}', 'payload', 'name'),
      'Roadmap',
    );
  });

  it('returns undefined for invalid JSON, missing fields, and non-string values', () => {
    assert.equal(readAliasKeyFromContent('not json', 'title'), undefined);
    assert.equal(readAliasKeyFromContent('{"title":42}', 'title'), undefined);
    assert.equal(readAliasKeyFromContent('{"title":""}', 'title'), undefined);
    assert.equal(readAliasKeyFromContent('{"payload":[]}', 'payload', 'title'), undefined);
    assert.equal(readAliasKeyFromContent('{}', 'payload', 'title'), undefined);
  });
});
