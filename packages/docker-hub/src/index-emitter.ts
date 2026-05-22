import { EMIT_AUXILIARY_JSON_CONTENT_TYPE } from '@relayfile/adapter-core';

import {
  dockerHubRepositoriesIndexPath,
  dockerHubRepositoryByNamespaceIndexPath,
  dockerHubRepositoryTagsIndexPath,
  dockerHubRepositoryWebhooksIndexPath,
  dockerHubRootIndexPath,
  dockerHubTagsIndexPath,
  dockerHubWebhookByRepositoryIndexPath,
  dockerHubWebhooksIndexPath,
  parseDockerHubWebhookId,
} from './path-mapper.js';
import type {
  DockerHubIndexRow,
  DockerHubRepository,
  DockerHubRepositoryIndexRow,
  DockerHubTag,
  DockerHubTagIndexRow,
  DockerHubWebhook,
  DockerHubWebhookIndexRow,
} from './types.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export function buildDockerHubRootIndexFile() {
  return jsonFile(dockerHubRootIndexPath(), [
    { id: 'repositories', title: 'Repositories' },
    { id: 'tags', title: 'Tags' },
    { id: 'webhooks', title: 'Webhooks' },
  ]);
}

export function buildDockerHubRepositoriesIndexFile(rows: readonly DockerHubRepositoryIndexRow[]) {
  return jsonFile(dockerHubRepositoriesIndexPath(), sortRows(rows));
}

export function buildDockerHubRepositoryNamespaceIndexFile(namespace: string, rows: readonly DockerHubRepositoryIndexRow[]) {
  return jsonFile(dockerHubRepositoryByNamespaceIndexPath(namespace), sortRows(rows));
}

export function buildDockerHubTagsIndexFile(rows: readonly DockerHubTagIndexRow[]) {
  return jsonFile(dockerHubTagsIndexPath(), sortRows(rows));
}

export function buildDockerHubRepositoryTagsIndexFile(
  namespace: string,
  repository: string,
  rows: readonly DockerHubTagIndexRow[],
) {
  return jsonFile(dockerHubRepositoryTagsIndexPath(namespace, repository), sortRows(rows));
}

export function buildDockerHubWebhooksIndexFile(rows: readonly DockerHubWebhookIndexRow[]) {
  return jsonFile(dockerHubWebhooksIndexPath(), sortRows(rows));
}

export function buildDockerHubRepositoryWebhooksIndexFile(
  namespace: string,
  repository: string,
  rows: readonly DockerHubWebhookIndexRow[],
) {
  return jsonFile(dockerHubRepositoryWebhooksIndexPath(namespace, repository), sortRows(rows));
}

export function buildDockerHubWebhookRepositoryIndexFile(
  namespace: string,
  repository: string,
  rows: readonly DockerHubWebhookIndexRow[],
) {
  return jsonFile(dockerHubWebhookByRepositoryIndexPath(namespace, repository), sortRows(rows));
}

export function dockerHubRepositoryIndexRow(repository: DockerHubRepository): DockerHubRepositoryIndexRow {
  return {
    id: repository.id,
    title: dockerHubRepositoryTitle(repository),
    updated: repository.last_updated ?? repository.last_modified ?? repository.date_registered ?? '',
    namespace: repository.namespace,
    name: repository.name,
    repository_type: repository.repository_type,
    status: repository.status,
    is_private: repository.is_private,
    star_count: repository.star_count,
    pull_count: repository.pull_count,
  };
}

export function dockerHubTagIndexRow(tag: DockerHubTag): DockerHubTagIndexRow {
  return {
    id: tag.id,
    title: dockerHubTagTitle(tag),
    updated: tag.last_updated ?? tag.tag_last_pushed ?? tag.tag_last_pulled ?? '',
    namespace: tag.namespace,
    repository: tag.repository,
    name: tag.name,
    ...(tag.digest ? { digest: tag.digest } : {}),
    ...(tag.tag_status ? { tag_status: tag.tag_status } : {}),
    ...(tag.architecture ? { architecture: tag.architecture } : {}),
    ...(tag.os ? { os: tag.os } : {}),
  };
}

export function dockerHubWebhookIndexRow(webhook: DockerHubWebhook): DockerHubWebhookIndexRow {
  return {
    id: webhook.id,
    title: dockerHubWebhookTitle(webhook),
    updated: webhook.date_added ?? webhook.last_called ?? '',
    namespace: webhook.namespace,
    repository: webhook.repository,
    webhook_id: dockerHubWebhookStableId(webhook),
    ...(typeof webhook.active === 'boolean' ? { active: webhook.active } : {}),
    ...(webhook.creator ? { creator: webhook.creator } : {}),
    ...(webhook.last_called ? { last_called: webhook.last_called } : {}),
  };
}

export function dockerHubRepositoryTitle(repository: DockerHubRepository): string {
  return `${repository.namespace}/${repository.name}`;
}

export function dockerHubTagTitle(tag: DockerHubTag): string {
  return `${tag.namespace}/${tag.repository}:${tag.name}`;
}

export function dockerHubWebhookTitle(webhook: DockerHubWebhook): string {
  const name = webhook.name?.trim();
  return name ? `${webhook.namespace}/${webhook.repository}: ${name}` : `${webhook.namespace}/${webhook.repository}: ${dockerHubWebhookStableId(webhook)}`;
}

export function dockerHubWebhookStableId(webhook: DockerHubWebhook): string {
  return webhook.webhook_id ?? parseDockerHubWebhookId(webhook.id).webhookId;
}

function sortRows<TRow extends DockerHubIndexRow>(rows: readonly TRow[]): TRow[] {
  return rows.slice().sort((left, right) => {
    const rightMs = Date.parse(right.updated);
    const leftMs = Date.parse(left.updated);
    const time = (Number.isNaN(rightMs) ? Number.NEGATIVE_INFINITY : rightMs)
      - (Number.isNaN(leftMs) ? Number.NEGATIVE_INFINITY : leftMs);
    return time || compareStrings(left.id, right.id);
  });
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function jsonFile(path: string, value: unknown) {
  return {
    path,
    contentType: JSON_CONTENT_TYPE,
    content: `${JSON.stringify(value, null, 2)}\n`,
  };
}
