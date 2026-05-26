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

  const fileRoundTrip = parseRelayfilePath(
    dropboxFilePath('id:abc123', 'Quarterly Plan.pdf'),
  );
  assert.equal(fileRoundTrip.resource, 'object');
  assert.equal(fileRoundTrip.id, 'id:abc123');

  const folderRoundTrip = parseRelayfilePath(
    dropboxFolderPath('id:fold1', 'Finance'),
  );
  assert.equal(folderRoundTrip.resource, 'object');
  assert.equal(folderRoundTrip.id, 'id:fold1');
});

test('dropbox path helpers preserve legacy path-like input behavior for compatibility', () => {
  assert.equal(
    dropboxFilePath('/legacy/path/spec.md'),
    '/dropbox/files/legacy/path/spec.md.json',
  );
  assert.equal(
    dropboxFolderPath('/legacy/path/docs'),
    '/dropbox/folders/legacy/path/docs.json',
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
  const parsed = parseRelayfilePath(first);
  assert.equal(parsed.resource, 'object');
  assert.equal(parsed.id, 'id:abc123');
});

test('toObjectRelayfilePath routes folder and shared object types correctly', () => {
  const folderPath = toObjectRelayfilePath({
    id: 'id:fold',
    objectType: 'folder',
    path: '/teams/docs',
    name: 'docs',
  });
  assert.equal(folderPath, '/dropbox/folders/docs__id%3Afold.json');
  const parsedFolder = parseRelayfilePath(folderPath);
  assert.equal(parsedFolder.resource, 'object');
  assert.equal(parsedFolder.id, 'id:fold');

  const sharedFolderPath = toObjectRelayfilePath({
    id: '845281924',
    objectType: 'shared-folder',
  });
  assert.equal(sharedFolderPath, '/dropbox/shared-folders/845281924.json');
  const parsedSharedFolder = parseRelayfilePath(sharedFolderPath);
  assert.equal(parsedSharedFolder.resource, 'object');
  assert.equal(parsedSharedFolder.id, '845281924');

  const sharedFolderLegacyType = toObjectRelayfilePath({
    id: '845281924',
    objectType: 'DropboxSharedFolder',
  });
  assert.equal(sharedFolderLegacyType, '/dropbox/shared-folders/845281924.json');

  const sharedLinkLegacyType = toObjectRelayfilePath({
    id: 'sl:abc123',
    objectType: 'sharedlink',
  });
  assert.equal(sharedLinkLegacyType, '/dropbox/shared-links/sl%3Aabc123.json');
  const parsedSharedLink = parseRelayfilePath(sharedLinkLegacyType);
  assert.equal(parsedSharedLink.resource, 'object');
  assert.equal(parsedSharedLink.id, 'sl:abc123');
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
  assert.equal(collectionPath.id, 'cursors');

  const entryPath = parseRelayfilePath('/dropbox/cursors/cursor%2F123.json');
  assert.equal(entryPath.resource, 'lifecycle');
  assert.equal(entryPath.id, 'cursor/123');
});

test('dropboxRootIndexPath returns the provider root index path', () => {
  assert.equal(dropboxRootIndexPath(), '/dropbox/_index.json');
});
