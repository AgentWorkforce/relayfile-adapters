import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from '@relayfile/adapter-core';
import { bitbucketByIdPath, bitbucketLookupAliasPaths, computeBitbucketPath, normalizeNangoBitbucketModel } from './path-mapper.js';

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
      const aliasPath = bitbucketByIdPath(input.model, record);
      let prior: Record<string, unknown> | null = null;
      if (client.readFile) {
        try {
          const existing = await client.readFile({ workspaceId: input.workspaceId, path: aliasPath });
          if (existing?.content) prior = JSON.parse(existing.content) as Record<string, unknown>;
        } catch (error) {
          result.errors.push({ path: aliasPath, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const previousPaths = prior ? bitbucketLookupAliasPaths(input.model, prior) : [];
      if (deleted) {
        index.remove(id);
        if (client.deleteFile) {
          for (const path of [aliasPath, ...previousPaths]) {
            await client.deleteFile({ workspaceId: input.workspaceId, path });
            result.deleted += 1;
          }
        } else {
          result.errors.push({ path: aliasPath, error: 'Bitbucket deletion requires deleteFile' });
        }
        continue;
      }
      const canonicalPath = computeBitbucketPath(input.model, record);
      const lookupPaths = bitbucketLookupAliasPaths(input.model, record);
      const content = `${JSON.stringify(record, null, 2)}\n`;
      for (const path of [aliasPath, ...lookupPaths]) {
        await client.writeFile({ workspaceId: input.workspaceId, path, content, contentType });
        result.written += 1;
      }
      if (client.deleteFile) {
        for (const path of previousPaths.filter((previousPath) => !lookupPaths.includes(previousPath))) {
          await client.deleteFile({ workspaceId: input.workspaceId, path });
          result.deleted += 1;
        }
      } else if (previousPaths.some((previousPath) => !lookupPaths.includes(previousPath))) {
        result.errors.push({ path: aliasPath, error: 'Bitbucket alias reconciliation requires deleteFile' });
      }
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
