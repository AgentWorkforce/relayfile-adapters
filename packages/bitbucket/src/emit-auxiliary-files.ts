import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from '@relayfile/adapter-core';
import { bitbucketByIdPath, computeBitbucketPath, normalizeNangoBitbucketModel } from './path-mapper.js';

const contentType = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

interface IndexRow {
  id: string;
  canonicalPath: string;
  title: string;
  updated: string;
  updatedAt?: string;
}

export async function emitBitbucketAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: { workspaceId: string; model: string; records: readonly Record<string, unknown>[] },
): Promise<EmitAuxiliaryFilesResult> {
  const result: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  const type = normalizeNangoBitbucketModel(input.model);
  if (!type) return result;
  const collection = type === 'repository' ? 'repositories' : type === 'pull-request' ? 'pull-requests' : `${type}s`;
  const indexPath = `/bitbucket/${collection}/_index.json`;
  const index = new IndexFileReconciler<IndexRow>({
    client,
    workspaceId: input.workspaceId,
    path: indexPath,
    builder: (rows) => ({
      path: indexPath,
      content: `${JSON.stringify([...rows].sort((a, b) => (b.updated ?? b.updatedAt ?? '').localeCompare(a.updated ?? a.updatedAt ?? '') || a.id.localeCompare(b.id)), null, 2)}\n`,
      contentType,
    }),
  });

  for (const raw of input.records) {
    const record = { ...raw };
    const deleted = record._deleted === true || (record._nango_metadata && typeof record._nango_metadata === 'object' &&
      (record._nango_metadata as Record<string, unknown>).last_action === 'deleted');
    delete record._nango_metadata;
    const id = typeof record.id === 'string' ? record.id : String(record.id ?? '');
    if (!id) {
      result.errors.push({ path: indexPath, error: 'Bitbucket record has no id' });
      continue;
    }
    try {
      const canonicalPath = computeBitbucketPath(input.model, record);
      const aliasPath = bitbucketByIdPath(input.model, record);
      if (deleted) {
        index.remove(id);
        if (client.deleteFile) {
          await client.deleteFile({ workspaceId: input.workspaceId, path: aliasPath });
          result.deleted += 1;
        }
        continue;
      }
      const content = `${JSON.stringify(record, null, 2)}\n`;
      await client.writeFile({ workspaceId: input.workspaceId, path: aliasPath, content, contentType });
      result.written += 1;
      index.upsert({
        id,
        canonicalPath,
        title: [record.title, record.name, record.full_name, record.message, record.hash, record.key]
          .find((value): value is string => typeof value === 'string' && value.length > 0)?.split('\n')[0] ?? id,
        updated: [record.updated_on, record.completed_on, record.created_on, record.date]
          .find((value): value is string => typeof value === 'string' && value.length > 0) ?? '',
        ...(typeof record.state === 'string' ? { state: record.state } : {}),
        ...(typeof record.updated_on === 'string' ? { updatedAt: record.updated_on } : {}),
      });
    } catch (error) {
      result.errors.push({ path: indexPath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const flushed = await index.flush();
  result.written += flushed.written;
  result.errors.push(...flushed.errors);
  const rootPath = '/bitbucket/_index.json';
  const root = new IndexFileReconciler<IndexRow>({
    client,
    workspaceId: input.workspaceId,
    path: rootPath,
    builder: (rows) => ({
      path: rootPath,
      content: `${JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)), null, 2)}\n`,
      contentType,
    }),
  });
  root.upsert({ id: collection, title: collection, updated: '', canonicalPath: indexPath });
  const rootFlushed = await root.flush();
  result.written += rootFlushed.written;
  result.errors.push(...rootFlushed.errors);
  return result;
}
