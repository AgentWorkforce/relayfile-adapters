import {
  cleanBucketRecord,
  isDeletedSyncRecord,
  literalModelNormalizer,
  modelBucket,
  readBucketId,
  readBucketString,
} from '@relayfile/adapter-core/sync-bucketing';

export const syncRecordBucketing = modelBucket({
  normalizeModel: literalModelNormalizer({
    DropboxFile: 'file',
    file: 'file',
    DropboxFolder: 'folder',
    folder: 'folder',
    DropboxSharedFolder: 'shared-folder',
    SharedFolder: 'shared-folder',
    'shared-folder': 'shared-folder',
    DropboxSharedLink: 'shared-link',
    SharedLink: 'shared-link',
    'shared-link': 'shared-link',
  }),
  buckets: {
    file: 'files',
    folder: 'folders',
    'shared-folder': 'sharedFolders',
    'shared-link': 'sharedLinks',
  },
  mapRecords(records) {
    const out: Record<string, unknown>[] = [];
    for (const raw of records) {
      if (!isDeletedSyncRecord(raw)) {
        out.push(cleanBucketRecord(raw));
        continue;
      }
      const cleaned = cleanBucketRecord(raw);
      const id = readBucketId(cleaned, 'id');
      if (!id) continue;
      const tombstone: Record<string, unknown> = { id, _deleted: true };
      const pathLower = readBucketString(cleaned, 'path_lower');
      const dropboxId = readBucketString(cleaned, 'dropbox_id');
      if (pathLower) tombstone.path_lower = pathLower;
      if (dropboxId) tombstone.dropbox_id = dropboxId;
      out.push(tombstone);
    }
    return out;
  },
});
