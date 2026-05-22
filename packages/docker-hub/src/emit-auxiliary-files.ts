import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  runEmitBatch,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import {
  buildDockerHubRepositoriesIndexFile,
  buildDockerHubRepositoryNamespaceIndexFile,
  buildDockerHubRepositoryTagsIndexFile,
  buildDockerHubRepositoryWebhooksIndexFile,
  buildDockerHubRootIndexFile,
  buildDockerHubTagsIndexFile,
  buildDockerHubWebhookRepositoryIndexFile,
  buildDockerHubWebhooksIndexFile,
  dockerHubRepositoryIndexRow,
  dockerHubRepositoryTitle,
  dockerHubTagIndexRow,
  dockerHubTagTitle,
  dockerHubWebhookIndexRow,
  dockerHubWebhookStableId,
  dockerHubWebhookTitle,
} from './index-emitter.js';
import { dockerHubLayoutPromptFile } from './layout-prompt.js';
import {
  dockerHubRepositoriesIndexPath,
  dockerHubRepositoryByIdAliasPath,
  dockerHubRepositoryByNamespaceIndexPath,
  dockerHubRepositoryPath,
  dockerHubRepositoryTagsIndexPath,
  dockerHubRepositoryWebhooksIndexPath,
  dockerHubTagByIdAliasPath,
  dockerHubTagPath,
  dockerHubTagsIndexPath,
  dockerHubWebhookByIdAliasPath,
  dockerHubWebhookByRepositoryIndexPath,
  dockerHubWebhookPath,
  dockerHubWebhooksIndexPath,
  parseDockerHubRepositoryId,
  parseDockerHubTagId,
  parseDockerHubWebhookId,
} from './path-mapper.js';
import type {
  DockerHubRepository,
  DockerHubRepositoryIndexRow,
  DockerHubTag,
  DockerHubTagIndexRow,
  DockerHubWebhook,
  DockerHubWebhookIndexRow,
} from './types.js';

const DOCKER_HUB_PROVIDER_NAME = 'docker-hub';
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export type DockerHubDeletedRecord = {
  id: string;
  _deleted: true;
  objectType: 'repository' | 'tag' | 'webhook';
};

export type DockerHubRepositoryEmitRecord = DockerHubRepository | DockerHubDeletedRecord;
export type DockerHubTagEmitRecord = DockerHubTag | DockerHubDeletedRecord;
export type DockerHubWebhookEmitRecord = DockerHubWebhook | DockerHubDeletedRecord;
export type DockerHubEmitRecord = DockerHubRepository | DockerHubTag | DockerHubWebhook | DockerHubDeletedRecord;

export interface DockerHubEmitAuxiliaryFilesInput {
  workspaceId: string;
  records?: readonly DockerHubEmitRecord[];
  repositories?: readonly DockerHubRepositoryEmitRecord[];
  tags?: readonly DockerHubTagEmitRecord[];
  webhooks?: readonly DockerHubWebhookEmitRecord[];
  connectionId?: string;
}

export async function emitDockerHubAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: DockerHubEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const workspaceId = input.workspaceId;
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  await writeStaticFiles(client, workspaceId, aggregate);

  const classified = classifyRecords(input.records ?? []);
  const repositories = [...(input.repositories ?? []), ...classified.repositories];
  const tags = [...(input.tags ?? []), ...classified.tags];
  const webhooks = [...(input.webhooks ?? []), ...classified.webhooks];

  const repositoryIndex = new IndexFileReconciler<DockerHubRepositoryIndexRow>({
    client,
    workspaceId,
    path: dockerHubRepositoriesIndexPath(),
    builder: buildDockerHubRepositoriesIndexFile,
  });
  const tagIndex = new IndexFileReconciler<DockerHubTagIndexRow>({
    client,
    workspaceId,
    path: dockerHubTagsIndexPath(),
    builder: buildDockerHubTagsIndexFile,
  });
  const webhookIndex = new IndexFileReconciler<DockerHubWebhookIndexRow>({
    client,
    workspaceId,
    path: dockerHubWebhooksIndexPath(),
    builder: buildDockerHubWebhooksIndexFile,
  });
  const repositoryNamespaceIndexes = new Map<string, IndexFileReconciler<DockerHubRepositoryIndexRow>>();
  const repositoryTagIndexes = new Map<string, IndexFileReconciler<DockerHubTagIndexRow>>();
  const repositoryWebhookIndexes = new Map<string, IndexFileReconciler<DockerHubWebhookIndexRow>>();
  const webhookByRepositoryIndexes = new Map<string, IndexFileReconciler<DockerHubWebhookIndexRow>>();

  accumulate(aggregate, await runEmitBatch(client, workspaceId, repositories, (record) =>
    planRepositoryRecord(record, repositoryIndex, getRepositoryNamespaceIndex, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, tags, (record) =>
    planTagRecord(record, tagIndex, getRepositoryTagIndex, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, webhooks, (record) =>
    planWebhookRecord(record, webhookIndex, getRepositoryWebhookIndex, getWebhookByRepositoryIndex, input.connectionId),
  ));

  for (const reconciler of [
    repositoryIndex,
    tagIndex,
    webhookIndex,
    ...repositoryNamespaceIndexes.values(),
    ...repositoryTagIndexes.values(),
    ...repositoryWebhookIndexes.values(),
    ...webhookByRepositoryIndexes.values(),
  ]) {
    const flush = await reconciler.flush();
    aggregate.written += flush.written;
    aggregate.errors.push(...flush.errors);
  }

  return aggregate;

  function getRepositoryNamespaceIndex(namespace: string): IndexFileReconciler<DockerHubRepositoryIndexRow> {
    let reconciler = repositoryNamespaceIndexes.get(namespace);
    if (!reconciler) {
      reconciler = new IndexFileReconciler<DockerHubRepositoryIndexRow>({
        client,
        workspaceId,
        path: dockerHubRepositoryByNamespaceIndexPath(namespace),
        builder: (rows) => buildDockerHubRepositoryNamespaceIndexFile(namespace, rows),
      });
      repositoryNamespaceIndexes.set(namespace, reconciler);
    }
    return reconciler;
  }

  function getRepositoryTagIndex(namespace: string, repository: string): IndexFileReconciler<DockerHubTagIndexRow> {
    const key = `${namespace}\0${repository}`;
    let reconciler = repositoryTagIndexes.get(key);
    if (!reconciler) {
      reconciler = new IndexFileReconciler<DockerHubTagIndexRow>({
        client,
        workspaceId,
        path: dockerHubRepositoryTagsIndexPath(namespace, repository),
        builder: (rows) => buildDockerHubRepositoryTagsIndexFile(namespace, repository, rows),
      });
      repositoryTagIndexes.set(key, reconciler);
    }
    return reconciler;
  }

  function getRepositoryWebhookIndex(namespace: string, repository: string): IndexFileReconciler<DockerHubWebhookIndexRow> {
    const key = `${namespace}\0${repository}`;
    let reconciler = repositoryWebhookIndexes.get(key);
    if (!reconciler) {
      reconciler = new IndexFileReconciler<DockerHubWebhookIndexRow>({
        client,
        workspaceId,
        path: dockerHubRepositoryWebhooksIndexPath(namespace, repository),
        builder: (rows) => buildDockerHubRepositoryWebhooksIndexFile(namespace, repository, rows),
      });
      repositoryWebhookIndexes.set(key, reconciler);
    }
    return reconciler;
  }

  function getWebhookByRepositoryIndex(namespace: string, repository: string): IndexFileReconciler<DockerHubWebhookIndexRow> {
    const key = `${namespace}\0${repository}`;
    let reconciler = webhookByRepositoryIndexes.get(key);
    if (!reconciler) {
      reconciler = new IndexFileReconciler<DockerHubWebhookIndexRow>({
        client,
        workspaceId,
        path: dockerHubWebhookByRepositoryIndexPath(namespace, repository),
        builder: (rows) => buildDockerHubWebhookRepositoryIndexFile(namespace, repository, rows),
      });
      webhookByRepositoryIndexes.set(key, reconciler);
    }
    return reconciler;
  }
}

async function writeStaticFiles(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  for (const file of [buildDockerHubRootIndexFile(), dockerHubLayoutPromptFile()]) {
    try {
      await client.writeFile({
        workspaceId,
        path: file.path,
        content: file.content,
        contentType: file.contentType,
      });
      aggregate.written += 1;
    } catch (error) {
      aggregate.errors.push({ path: file.path, error: stringifyError(error) });
    }
  }
}

function planRepositoryRecord(
  record: DockerHubRepositoryEmitRecord,
  index: IndexFileReconciler<DockerHubRepositoryIndexRow>,
  namespaceIndex: (namespace: string) => IndexFileReconciler<DockerHubRepositoryIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const id = record.id;
  const parts = parseDockerHubRepositoryId(id);
  if (isDeleted(record)) {
    index.remove(id);
    namespaceIndex(parts.namespace).remove(id);
    return {
      deletes: staleDeletes([
        dockerHubRepositoryPath(parts.namespace, parts.name),
        dockerHubRepositoryByIdAliasPath(id),
      ]),
    };
  }

  const row = dockerHubRepositoryIndexRow(record);
  index.upsert(row);
  namespaceIndex(record.namespace).upsert(row);
  const canonicalPath = dockerHubRepositoryPath(record.namespace, record.name);
  const content = json(recordEnvelope('repository', record.id, canonicalPath, dockerHubRepositoryTitle(record), record, connectionId));
  const semantics = {
    properties: {
      provider: DOCKER_HUB_PROVIDER_NAME,
      'docker_hub.repository_id': record.id,
      'docker_hub.namespace': record.namespace,
      'docker_hub.repository': record.name,
      'docker_hub.is_private': String(record.is_private),
    },
  };
  return {
    writes: [
      mirrorWrite(canonicalPath, content, semantics),
      mirrorWrite(dockerHubRepositoryByIdAliasPath(record.id), content, semantics),
    ],
  };
}

function planTagRecord(
  record: DockerHubTagEmitRecord,
  index: IndexFileReconciler<DockerHubTagIndexRow>,
  repositoryIndex: (namespace: string, repository: string) => IndexFileReconciler<DockerHubTagIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const id = record.id;
  const parts = parseDockerHubTagId(id);
  if (isDeleted(record)) {
    index.remove(id);
    repositoryIndex(parts.namespace, parts.repository).remove(id);
    return {
      deletes: staleDeletes([
        dockerHubTagPath(parts.namespace, parts.repository, parts.name),
        dockerHubTagByIdAliasPath(id),
      ]),
    };
  }

  const row = dockerHubTagIndexRow(record);
  index.upsert(row);
  repositoryIndex(record.namespace, record.repository).upsert(row);
  const canonicalPath = dockerHubTagPath(record.namespace, record.repository, record.name);
  const content = json(recordEnvelope('tag', record.id, canonicalPath, dockerHubTagTitle(record), record, connectionId));
  const semantics = {
    properties: {
      provider: DOCKER_HUB_PROVIDER_NAME,
      'docker_hub.tag_id': record.id,
      'docker_hub.namespace': record.namespace,
      'docker_hub.repository': record.repository,
      'docker_hub.tag': record.name,
      ...(record.digest ? { 'docker_hub.digest': record.digest } : {}),
    },
  };
  return {
    writes: [
      mirrorWrite(canonicalPath, content, semantics),
      mirrorWrite(dockerHubTagByIdAliasPath(record.id), content, semantics),
    ],
  };
}

function planWebhookRecord(
  record: DockerHubWebhookEmitRecord,
  index: IndexFileReconciler<DockerHubWebhookIndexRow>,
  repositoryIndex: (namespace: string, repository: string) => IndexFileReconciler<DockerHubWebhookIndexRow>,
  byRepositoryIndex: (namespace: string, repository: string) => IndexFileReconciler<DockerHubWebhookIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const id = record.id;
  const parts = parseDockerHubWebhookId(id);
  if (isDeleted(record)) {
    index.remove(id);
    repositoryIndex(parts.namespace, parts.repository).remove(id);
    byRepositoryIndex(parts.namespace, parts.repository).remove(id);
    return {
      deletes: staleDeletes([
        dockerHubWebhookPath(parts.namespace, parts.repository, parts.webhookId),
        dockerHubWebhookByIdAliasPath(id),
      ]),
    };
  }

  const webhookId = dockerHubWebhookStableId(record);
  const row = dockerHubWebhookIndexRow(record);
  index.upsert(row);
  repositoryIndex(record.namespace, record.repository).upsert(row);
  byRepositoryIndex(record.namespace, record.repository).upsert(row);
  const canonicalPath = dockerHubWebhookPath(record.namespace, record.repository, webhookId);
  const content = json(recordEnvelope('webhook', record.id, canonicalPath, dockerHubWebhookTitle(record), record, connectionId));
  const semantics = {
    properties: {
      provider: DOCKER_HUB_PROVIDER_NAME,
      'docker_hub.webhook_id': webhookId,
      'docker_hub.namespace': record.namespace,
      'docker_hub.repository': record.repository,
      ...(typeof record.active === 'boolean' ? { 'docker_hub.active': String(record.active) } : {}),
    },
  };
  return {
    writes: [
      mirrorWrite(canonicalPath, content, semantics),
      mirrorWrite(dockerHubWebhookByIdAliasPath(record.id), content, semantics),
    ],
  };
}

function recordEnvelope(
  objectType: 'repository' | 'tag' | 'webhook',
  objectId: string,
  canonicalPath: string,
  title: string,
  payload: DockerHubRepository | DockerHubTag | DockerHubWebhook,
  connectionId: string | undefined,
) {
  return {
    provider: DOCKER_HUB_PROVIDER_NAME,
    objectType,
    objectId,
    canonicalPath,
    ...(connectionId ? { connectionId } : {}),
    title,
    payload,
  };
}

function classifyRecords(records: readonly DockerHubEmitRecord[]) {
  const repositories: DockerHubRepositoryEmitRecord[] = [];
  const tags: DockerHubTagEmitRecord[] = [];
  const webhooks: DockerHubWebhookEmitRecord[] = [];
  for (const record of records) {
    if (isDeleted(record)) {
      switch (record.objectType) {
        case 'repository':
          repositories.push(record);
          break;
        case 'tag':
          tags.push(record);
          break;
        case 'webhook':
          webhooks.push(record);
          break;
      }
    } else if (isDockerHubRepository(record)) {
      repositories.push(record);
    } else if (isDockerHubTag(record)) {
      tags.push(record);
    } else if (isDockerHubWebhook(record)) {
      webhooks.push(record);
    } else {
      throw new Error(`Unsupported Docker Hub record shape for id: ${readRecordId(record) ?? '<unknown>'}`);
    }
  }
  return { repositories, tags, webhooks };
}

function isDockerHubRepository(record: DockerHubEmitRecord): record is DockerHubRepository {
  return !isDeleted(record)
    && typeof (record as { repository_type?: unknown }).repository_type === 'string'
    && typeof (record as { name?: unknown }).name === 'string'
    && typeof (record as { namespace?: unknown }).namespace === 'string';
}

function isDockerHubTag(record: DockerHubEmitRecord): record is DockerHubTag {
  return !isDeleted(record)
    && typeof (record as { namespace?: unknown }).namespace === 'string'
    && typeof (record as { repository?: unknown }).repository === 'string'
    && typeof (record as { name?: unknown }).name === 'string'
    && 'last_updated' in record;
}

function isDockerHubWebhook(record: DockerHubEmitRecord): record is DockerHubWebhook {
  return !isDeleted(record)
    && typeof (record as { namespace?: unknown }).namespace === 'string'
    && typeof (record as { repository?: unknown }).repository === 'string'
    && !('repository_type' in record)
    && !('last_updated' in record);
}

function isDeleted(record: unknown): record is DockerHubDeletedRecord {
  return typeof record === 'object'
    && record !== null
    && !Array.isArray(record)
    && (record as { _deleted?: unknown })._deleted === true
    && typeof (record as { id?: unknown }).id === 'string'
    && (
      (record as { objectType?: unknown }).objectType === 'repository'
      || (record as { objectType?: unknown }).objectType === 'tag'
      || (record as { objectType?: unknown }).objectType === 'webhook'
    );
}

function mirrorWrite(path: string, content: string, semantics?: EmitWrite['semantics']): EmitWrite {
  return {
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
    ...(semantics ? { semantics } : {}),
  };
}

function staleDeletes(paths: readonly string[]) {
  return [...new Set(paths)].map((path) => ({ path }));
}

function readRecordId(record: unknown): string | undefined {
  return typeof record === 'object' && record !== null && typeof (record as { id?: unknown }).id === 'string'
    ? (record as { id: string }).id
    : undefined;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function accumulate(target: EmitAuxiliaryFilesResult, next: EmitAuxiliaryFilesResult): void {
  target.written += next.written;
  target.deleted += next.deleted;
  target.errors.push(...next.errors);
}
