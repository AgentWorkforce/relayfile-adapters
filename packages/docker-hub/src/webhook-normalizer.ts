import { dockerHubRepositoryPath, dockerHubTagPath } from './path-mapper.js';

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export interface NormalizedDockerHubWebhook {
  provider: 'docker-hub';
  eventType: string;
  objectType: 'repository' | 'tag';
  objectId: string;
  payload: Record<string, unknown>;
  namespace: string;
  repository: string;
  tag?: string;
  deliveryId?: string;
  connectionId?: string;
}

export type DockerHubWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-docker-hub-connection-id',
  'x-dockerhub-connection-id',
  'docker-hub-connection-id',
] as const;

const DELIVERY_ID_HEADER_KEYS = [
  'x-docker-hub-delivery',
  'x-dockerhub-delivery',
  'x-docker-delivery',
  'x-request-id',
  'webhook-id',
] as const;

export function normalizeDockerHubWebhook(
  rawPayload: unknown,
  headers: DockerHubWebhookHeaders = {},
): NormalizedDockerHubWebhook {
  const payload = parsePayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const repository = readRecord(payload.repository);
  const pushData = readRecord(payload.push_data) ?? readRecord(payload.pushData);
  const { namespace, name } = extractRepositoryParts(payload, repository);
  const tag = readNonEmptyString(pushData?.tag) ?? readNonEmptyString(payload.tag);
  const eventType =
    readNonEmptyString(payload.event)
    ?? readNonEmptyString(payload.event_type)
    ?? readNonEmptyString(payload.action)
    ?? 'push';

  const normalized: NormalizedDockerHubWebhook = {
    provider: 'docker-hub',
    eventType,
    objectType: tag ? 'tag' : 'repository',
    objectId: tag ? `${namespace}/${name}/${tag}` : `${namespace}/${name}`,
    payload,
    namespace,
    repository: name,
  };

  if (tag) {
    normalized.tag = tag;
  }

  const deliveryId = extractHeader(normalizedHeaders, DELIVERY_ID_HEADER_KEYS);
  if (deliveryId) {
    normalized.deliveryId = deliveryId;
  }

  const connectionId =
    extractHeader(normalizedHeaders, CONNECTION_ID_HEADER_KEYS)
    ?? readNonEmptyString(payload.connectionId)
    ?? readNonEmptyString(payload.connection_id)
    ?? readNonEmptyString(payload._connection_id);
  if (connectionId) {
    normalized.connectionId = connectionId;
  }

  return normalized;
}

function parsePayload(rawPayload: unknown): Record<string, unknown> {
  const rawRecord = readRecord(rawPayload);
  if (rawRecord) {
    return rawRecord;
  }

  if (typeof rawPayload === 'string') {
    const parsed = JSON.parse(rawPayload) as unknown;
    const record = readRecord(parsed);
    if (record) {
      return record;
    }
  }

  if (rawPayload instanceof Uint8Array) {
    const parsed = JSON.parse(new TextDecoder().decode(rawPayload)) as unknown;
    const record = readRecord(parsed);
    if (record) {
      return record;
    }
  }

  throw new Error('Docker Hub webhook payload must be a JSON object.');
}

function extractRepositoryParts(
  payload: Record<string, unknown>,
  repository: Record<string, unknown> | undefined,
): { namespace: string; name: string } {
  const repoName =
    readNonEmptyString(repository?.repo_name)
    ?? readNonEmptyString(repository?.repoName)
    ?? readNonEmptyString(payload.repo_name)
    ?? readNonEmptyString(payload.repoName);
  const repoParts = repoName ? splitRepositoryName(repoName) : undefined;
  const namespace =
    readNonEmptyString(repository?.namespace)
    ?? readNonEmptyString(repository?.owner)
    ?? readNonEmptyString(payload.namespace)
    ?? repoParts?.namespace;
  const name =
    readNonEmptyString(repository?.name)
    ?? readNonEmptyString(payload.repository_name)
    ?? readNonEmptyString(payload.repositoryName)
    ?? repoParts?.name;

  if (!namespace || !name) {
    throw new Error('Docker Hub webhook payload missing repository namespace/name.');
  }

  return { namespace, name };
}

function splitRepositoryName(repoName: string): { namespace: string; name: string } | undefined {
  const [namespace, ...nameParts] = repoName.split('/');
  const name = nameParts.join('/');
  if (!namespace || !name) {
    return undefined;
  }
  return { namespace, name };
}

function extractHeader(headers: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readNonEmptyString(headers[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeHeaders(headers: DockerHubWebhookHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  if (Symbol.iterator in Object(headers)) {
    for (const pair of headers as Iterable<readonly [string, string]>) {
      if (Array.isArray(pair) && pair.length >= 2) {
        normalized[pair[0].toLowerCase()] = pair[1];
      }
    }
    return normalized;
  }

  for (const [key, rawValue] of Object.entries(headers as Record<string, HeaderValue>)) {
    if (Array.isArray(rawValue)) {
      const first = rawValue.find((entry) => typeof entry === 'string');
      if (first) normalized[key.toLowerCase()] = first;
      continue;
    }
    if (typeof rawValue === 'string') {
      normalized[key.toLowerCase()] = rawValue;
      continue;
    }
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      normalized[key.toLowerCase()] = String(rawValue);
    }
  }

  return normalized;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function dockerHubWebhookObjectPath(input: NormalizedDockerHubWebhook): string {
  return input.objectType === 'tag'
    ? dockerHubTagPath(input.namespace, input.repository, input.tag ?? '')
    : dockerHubRepositoryPath(input.namespace, input.repository);
}
