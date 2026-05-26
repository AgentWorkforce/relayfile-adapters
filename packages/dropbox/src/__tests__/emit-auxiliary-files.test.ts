import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AuxiliaryEmitterClient,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from '@relayfile/adapter-core';

import { emitDropboxAuxiliaryFiles } from '../emit-auxiliary-files.js';
import {
  dropboxFileByPathAliasPath,
  dropboxFilesIndexPath,
  dropboxFolderByPathAliasPath,
  dropboxFoldersIndexPath,
  dropboxRootIndexPath,
  dropboxSharedFoldersIndexPath,
  dropboxSharedLinksIndexPath,
} from '../path-mapper.js';

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  files: Map<string, string>;
  failReadPaths: Set<string>;
}

function createClient(
  initialFiles: Record<string, string> = {},
  failReadPaths: string[] = [],
): CapturingClient {
  const files = new Map(Object.entries(initialFiles));
  return {
    writes: [],
    deletes: [],
    files,
    failReadPaths: new Set(failReadPaths),
    async writeFile(input) {
      this.writes.push(input);
      this.files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      this.deletes.push(input);
      this.files.delete(input.path);
    },
    async readFile(input: EmitReadInput): Promise<EmitReadResult | null> {
      if (this.failReadPaths.has(input.path)) {
        throw new Error(`forced read failure: ${input.path}`);
      }
      const content = this.files.get(input.path);
      return content === undefined ? null : { content };
    },
  };
}

test('emitDropboxAuxiliaryFiles removes stale by-path aliases when files move', async () => {
  const oldPathLower = '/old/reports/q1.pdf';
  const client = createClient({
    [dropboxFilesIndexPath()]: JSON.stringify([
      {
        id: 'id:dbx-file',
        title: 'q1.pdf',
        updated: '2026-05-26T00:00:00.000Z',
        canonicalPath: '/dropbox/files/q1-pdf__id%3Adbx-file.json',
        pathLower: oldPathLower,
      },
    ]),
  });

  const result = await emitDropboxAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    files: [
      {
        id: 'id:dbx-file',
        name: 'q1.pdf',
        path_lower: '/new/reports/q1.pdf',
      },
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.ok(
    client.deletes.some((deleteOp) => deleteOp.path === dropboxFileByPathAliasPath(oldPathLower)),
    'old file by-path alias should be deleted on rename/move',
  );
});

test('emitDropboxAuxiliaryFiles removes stale by-path aliases when folders move', async () => {
  const oldPathLower = '/old/projects/roadmap';
  const client = createClient({
    [dropboxFoldersIndexPath()]: JSON.stringify([
      {
        id: 'id:dbx-folder',
        title: 'roadmap',
        updated: '2026-05-26T00:00:00.000Z',
        canonicalPath: '/dropbox/folders/roadmap__id%3Adbx-folder.json',
        pathLower: oldPathLower,
      },
    ]),
  });

  const result = await emitDropboxAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    folders: [
      {
        id: 'id:dbx-folder',
        name: 'roadmap',
        path_lower: '/new/projects/roadmap',
      },
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.ok(
    client.deletes.some((deleteOp) => deleteOp.path === dropboxFolderByPathAliasPath(oldPathLower)),
    'old folder by-path alias should be deleted on rename/move',
  );
});

test('emitDropboxAuxiliaryFiles uses prior pathLower for tombstones missing path_lower', async () => {
  const previousPathLower = '/docs/readme.md';
  const client = createClient({
    [dropboxFilesIndexPath()]: JSON.stringify([
      {
        id: 'id:dbx-file',
        title: 'readme.md',
        updated: '2026-05-26T00:00:00.000Z',
        canonicalPath: '/dropbox/files/readme-md__id%3Adbx-file.json',
        pathLower: previousPathLower,
      },
    ]),
  });

  const result = await emitDropboxAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    files: [{ id: 'id:dbx-file', _deleted: true }],
  });

  assert.deepEqual(result.errors, []);
  assert.ok(
    client.deletes.some((deleteOp) => deleteOp.path === dropboxFileByPathAliasPath(previousPathLower)),
    'delete should remove by-path alias using prior indexed pathLower',
  );
});

test('emitDropboxAuxiliaryFiles accepts shared folder/link fallback identifiers', async () => {
  const client = createClient();
  const result = await emitDropboxAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    sharedFolders: [{ shared_folder_id: '845281924', shared_folder_name: 'Team Docs' }],
    sharedLinks: [{ url: 'https://www.dropbox.com/scl/fi/abc123/report.pdf?dl=0', name: 'report.pdf' }],
  });

  assert.deepEqual(result.errors, []);
  assert.ok(client.writes.some((write) => write.path === dropboxSharedFoldersIndexPath()));
  assert.ok(client.writes.some((write) => write.path === dropboxSharedLinksIndexPath()));
});

test('emitDropboxAuxiliaryFiles skips index rewrites when index reads fail', async () => {
  const client = createClient({}, [dropboxFilesIndexPath()]);
  const result = await emitDropboxAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    files: [{ id: 'id:dbx-file', name: 'notes.md', path_lower: '/notes.md' }],
  });

  assert.ok(result.errors.some((error) => error.path === dropboxFilesIndexPath()));
  assert.ok(
    client.writes.every((write) => write.path !== dropboxFilesIndexPath()),
    'files index should not be rewritten when prior read fails',
  );
  assert.ok(
    client.writes.some((write) => write.path === dropboxRootIndexPath()),
    'root index should still be emitted',
  );
});
