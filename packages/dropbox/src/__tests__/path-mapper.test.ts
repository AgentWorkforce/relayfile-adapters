import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeDropboxPath,
  dropboxFilePath,
  dropboxFolderPath,
  dropboxRootIndexPath,
  parseRelayfilePath,
  toObjectRelayfilePath,
} from '../path-mapper.js';

test('dropbox file and folder canonical paths use <slug>__<id>.json leaves', () => {
  assert.equal(
    dropboxFilePath('id:abc123', 'Quarterly Plan.pdf'),
    '/dropbox/files/quarterly-plan-pdf__id%3Aabc123.json',
  );
  assert.equal(
    dropboxFolderPath('id:fold1', 'Finance'),
    '/dropbox/folders/finance__id%3Afold1.json',
  );
});

test('computeDropboxPath keeps canonical path stable across folder moves', () => {
  const first = computeDropboxPath('file', 'id:abc123', {
    path_lower: '/old/reports/q1.pdf',
    name: 'q1.pdf',
  });
  const moved = computeDropboxPath('file', 'id:abc123', {
    path_lower: '/new/reports/q1.pdf',
    name: 'q1.pdf',
  });
  assert.equal(first, moved);
});

test('toObjectRelayfilePath routes folder and shared object types correctly', () => {
  const folderPath = toObjectRelayfilePath({
    id: 'id:fold',
    objectType: 'folder',
    path: '/teams/docs',
    name: 'docs',
  });
  assert.equal(folderPath, '/dropbox/folders/docs__id%3Afold.json');

  const sharedFolderPath = toObjectRelayfilePath({
    id: '845281924',
    objectType: 'shared-folder',
  });
  assert.equal(sharedFolderPath, '/dropbox/shared-folders/845281924.json');
});

test('parseRelayfilePath only strips .json on the terminal segment', () => {
  const parsed = parseRelayfilePath('/dropbox/files/foo.json/bar.json');
  assert.equal(parsed.resource, 'object');
  assert.equal(parsed.segments[2], 'foo.json');
  assert.equal(parsed.segments[3], 'bar');
});

test('parseRelayfilePath requires a trailing id for lifecycle records', () => {
  const collectionPath = parseRelayfilePath('/dropbox/cursors');
  assert.equal(collectionPath.resource, 'object');

  const entryPath = parseRelayfilePath('/dropbox/cursors/cursor%2F123.json');
  assert.equal(entryPath.resource, 'lifecycle');
  assert.equal(entryPath.id, 'cursor/123');
});

test('dropboxRootIndexPath returns the provider root index path', () => {
  assert.equal(dropboxRootIndexPath(), '/dropbox/_index.json');
});
