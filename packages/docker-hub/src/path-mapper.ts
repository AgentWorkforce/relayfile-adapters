export const DOCKER_HUB_PATH_ROOT = '/docker-hub';

export const DOCKER_HUB_OBJECT_TYPES = ['repository', 'tag', 'webhook'] as const;
export type DockerHubPathObjectType = (typeof DOCKER_HUB_OBJECT_TYPES)[number];

export interface DockerHubRepositoryIdParts {
  namespace: string;
  name: string;
}

export interface DockerHubTagIdParts {
  namespace: string;
  repository: string;
  name: string;
}

export interface DockerHubWebhookIdParts {
  namespace: string;
  repository: string;
  webhookId: string;
}

const OBJECT_TYPE_ALIASES: Readonly<Record<string, DockerHubPathObjectType>> = {
  repository: 'repository',
  repositories: 'repository',
  repo: 'repository',
  repos: 'repository',
  dockerhubrepository: 'repository',
  tag: 'tag',
  tags: 'tag',
  image: 'tag',
  images: 'tag',
  dockerhubtag: 'tag',
  webhook: 'webhook',
  webhooks: 'webhook',
  hook: 'webhook',
  hooks: 'webhook',
  dockerhubwebhook: 'webhook',
};

export function dockerHubRootIndexPath(): string {
  return `${DOCKER_HUB_PATH_ROOT}/_index.json`;
}

export function dockerHubLayoutPath(): string {
  return `${DOCKER_HUB_PATH_ROOT}/LAYOUT.md`;
}

export function dockerHubRepositoriesIndexPath(): string {
  return `${DOCKER_HUB_PATH_ROOT}/repositories/_index.json`;
}

export function dockerHubRepositoryPath(namespace: string, name: string): string {
  return `${DOCKER_HUB_PATH_ROOT}/repositories/${encodeDockerHubPathSegment(namespace)}/${encodeDockerHubPathSegment(name)}.json`;
}

export function dockerHubRepositoryByIdAliasPath(id: string): string {
  const parts = parseDockerHubRepositoryId(id);
  return `${DOCKER_HUB_PATH_ROOT}/repositories/by-id/${dockerHubRepositoryAliasId(parts.namespace, parts.name)}.json`;
}

export function dockerHubRepositoryByNamespaceIndexPath(namespace: string): string {
  return `${DOCKER_HUB_PATH_ROOT}/repositories/by-namespace/${encodeDockerHubPathSegment(namespace)}/_index.json`;
}

export function dockerHubTagsIndexPath(): string {
  return `${DOCKER_HUB_PATH_ROOT}/tags/_index.json`;
}

export function dockerHubRepositoryTagsIndexPath(namespace: string, repository: string): string {
  return `${DOCKER_HUB_PATH_ROOT}/repositories/${encodeDockerHubPathSegment(namespace)}/${encodeDockerHubPathSegment(repository)}/tags/_index.json`;
}

export function dockerHubTagPath(namespace: string, repository: string, name: string): string {
  return `${DOCKER_HUB_PATH_ROOT}/repositories/${encodeDockerHubPathSegment(namespace)}/${encodeDockerHubPathSegment(repository)}/tags/${encodeDockerHubPathSegment(name)}.json`;
}

export function dockerHubTagByIdAliasPath(id: string): string {
  const parts = parseDockerHubTagId(id);
  return `${DOCKER_HUB_PATH_ROOT}/tags/by-id/${dockerHubTagAliasId(parts.namespace, parts.repository, parts.name)}.json`;
}

export function dockerHubWebhooksIndexPath(): string {
  return `${DOCKER_HUB_PATH_ROOT}/webhooks/_index.json`;
}

export function dockerHubRepositoryWebhooksIndexPath(namespace: string, repository: string): string {
  return `${DOCKER_HUB_PATH_ROOT}/repositories/${encodeDockerHubPathSegment(namespace)}/${encodeDockerHubPathSegment(repository)}/webhooks/_index.json`;
}

export function dockerHubWebhookPath(namespace: string, repository: string, webhookId: string | number): string {
  return `${DOCKER_HUB_PATH_ROOT}/repositories/${encodeDockerHubPathSegment(namespace)}/${encodeDockerHubPathSegment(repository)}/webhooks/${encodeDockerHubPathSegment(String(webhookId))}.json`;
}

export function dockerHubWebhookByIdAliasPath(id: string): string {
  const parts = parseDockerHubWebhookId(id);
  return `${DOCKER_HUB_PATH_ROOT}/webhooks/by-id/${encodeDockerHubPathSegment(parts.webhookId)}.json`;
}

export function dockerHubWebhookByRepositoryIndexPath(namespace: string, repository: string): string {
  return `${DOCKER_HUB_PATH_ROOT}/webhooks/by-repository/${dockerHubRepositoryAliasId(namespace, repository)}/_index.json`;
}

export function computeDockerHubPath(objectType: string, objectId: string, _label?: string | null): string {
  switch (normalizeDockerHubObjectType(objectType)) {
    case 'repository': {
      const parts = parseDockerHubRepositoryId(objectId);
      return dockerHubRepositoryPath(parts.namespace, parts.name);
    }
    case 'tag': {
      const parts = parseDockerHubTagId(objectId);
      return dockerHubTagPath(parts.namespace, parts.repository, parts.name);
    }
    case 'webhook': {
      const parts = parseDockerHubWebhookId(objectId);
      return dockerHubWebhookPath(parts.namespace, parts.repository, parts.webhookId);
    }
  }
}

export function normalizeDockerHubObjectType(objectType: string): DockerHubPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[-_\s]/gu, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized] ?? OBJECT_TYPE_ALIASES[objectType.trim().toLowerCase()];
  if (!mapped) {
    throw new Error(`Unsupported Docker Hub object type: ${objectType}`);
  }
  return mapped;
}

export function parseDockerHubRepositoryId(id: string): DockerHubRepositoryIdParts {
  const [namespace, name, ...extra] = splitStableId(id, 2, 'repository');
  if (extra.length > 0 || !namespace || !name) {
    throw new Error(`Docker Hub repository id must be <namespace>/<name>: ${id}`);
  }
  return { namespace, name };
}

export function parseDockerHubTagId(id: string): DockerHubTagIdParts {
  const [namespace, repository, ...nameParts] = splitStableId(id, 3, 'tag');
  const name = nameParts.join('/');
  if (!namespace || !repository || !name) {
    throw new Error(`Docker Hub tag id must be <namespace>/<repository>/<name>: ${id}`);
  }
  return { namespace, repository, name };
}

export function parseDockerHubWebhookId(id: string): DockerHubWebhookIdParts {
  const [namespace, repository, ...webhookIdParts] = splitStableId(id, 3, 'webhook');
  const webhookId = webhookIdParts.join('/');
  if (!namespace || !repository || !webhookId) {
    throw new Error(`Docker Hub webhook id must be <namespace>/<repository>/<webhookId>: ${id}`);
  }
  return { namespace, repository, webhookId };
}

export function parseDockerHubRepositoryByIdAliasPath(path: string): DockerHubRepositoryIdParts {
  const segment = aliasSegment(path, /^\/?docker-hub\/repositories\/by-id\/([^/]+)\.json$/u);
  const [namespace, name] = splitAliasId(segment, 2);
  if (!namespace || !name) {
    throw new Error(`Docker Hub repository by-id alias path is invalid: ${path}`);
  }
  return { namespace, name };
}

export function parseDockerHubTagByIdAliasPath(path: string): DockerHubTagIdParts {
  const segment = aliasSegment(path, /^\/?docker-hub\/tags\/by-id\/([^/]+)\.json$/u);
  const [namespace, repository, ...nameParts] = splitAliasId(segment, 3);
  const name = nameParts.join('__');
  if (!namespace || !repository || !name) {
    throw new Error(`Docker Hub tag by-id alias path is invalid: ${path}`);
  }
  return { namespace, repository, name };
}

export function parseDockerHubWebhookByIdAliasPath(path: string): DockerHubWebhookIdParts {
  const match = /^\/?docker-hub\/webhooks\/by-id\/([^/]+)\.json$/u.exec(path);
  if (!match?.[1]) {
    throw new Error(`Docker Hub webhook by-id alias path is invalid: ${path}`);
  }
  return { namespace: '', repository: '', webhookId: safeDecodeURIComponent(match[1]) };
}

export function dockerHubRepositoryAliasId(namespace: string, name: string): string {
  return `${encodeDockerHubAliasComponent(namespace)}__${encodeDockerHubAliasComponent(name)}`;
}

export function dockerHubTagAliasId(namespace: string, repository: string, name: string): string {
  return [
    encodeDockerHubAliasComponent(namespace),
    encodeDockerHubAliasComponent(repository),
    encodeDockerHubAliasComponent(name),
  ].join('__');
}

export function encodeDockerHubPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment')).replace(/\./gu, '%2E');
}

function encodeDockerHubAliasComponent(value: string): string {
  return encodeDockerHubPathSegment(value).replace(/_/gu, '%5F');
}

function splitStableId(id: string, minimumParts: number, label: string): string[] {
  const parts = assertNonEmptySegment(id, `${label} id`).split('/');
  if (parts.length < minimumParts || parts.some((part) => !part.trim())) {
    throw new Error(`Docker Hub ${label} id is invalid: ${id}`);
  }
  return parts;
}

function splitAliasId(segment: string, minimumParts: number): string[] {
  const parts = segment.split('__').map((part) => safeDecodeURIComponent(part));
  if (parts.length < minimumParts) {
    throw new Error(`Docker Hub alias id is invalid: ${segment}`);
  }
  return parts;
}

function aliasSegment(path: string, pattern: RegExp): string {
  const match = pattern.exec(path);
  if (!match?.[1]) {
    throw new Error(`Docker Hub alias path is invalid: ${path}`);
  }
  return match[1];
}

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Docker Hub ${label} must be a non-empty string`);
  }
  return trimmed;
}

function safeDecodeURIComponent(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
