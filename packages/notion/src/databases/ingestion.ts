import { notionDatabaseMetadataPath } from '../path-mapper.js';
import { buildDatabaseQuery } from './query.js';
import { ingestPageArtifacts } from '../pages/ingestion.js';
import { richTextToPlainText } from '../pages/properties.js';
import type { FileSemantics } from '@relayfile/sdk';
import type { NotionApiClient } from '../client.js';
import type {
  JsonValue,
  NotionDatabase,
  NotionDatabaseQueryInput,
  NotionNormalizedDatabase,
  NotionPage,
  NotionPropertySchema,
  NotionVfsFile,
  SerializedPropertySchema,
} from '../types.js';

export async function retrieveDatabase(client: NotionApiClient, databaseId: string): Promise<NotionDatabase> {
  return client.request<NotionDatabase>('GET', `/v1/databases/${encodeURIComponent(databaseId)}`);
}

export async function queryDatabasePages(
  client: NotionApiClient,
  databaseId: string,
  input: NotionDatabaseQueryInput = {},
): Promise<NotionPage[]> {
  return client.paginate<NotionPage>('POST', `/v1/databases/${encodeURIComponent(databaseId)}/query`, {
    body: buildDatabaseQuery(input),
  });
}

export function normalizeDatabase(database: NotionDatabase): NotionNormalizedDatabase {
  return {
    object: 'database',
    id: database.id,
    title: richTextToPlainText(database.title),
    description: richTextToPlainText(database.description),
    url: database.url,
    lastEditedTime: database.last_edited_time,
    properties: Object.fromEntries(
      Object.entries(database.properties).map(([name, property]) => [name, serializePropertySchema(name, property)]),
    ),
    dataSources: database.data_sources?.map((source) => ({ id: source.id, name: source.name })),
  };
}

export async function ingestDatabaseArtifacts(
  client: NotionApiClient,
  databaseId: string,
  query: NotionDatabaseQueryInput = {},
): Promise<NotionVfsFile[]> {
  const database = await retrieveDatabase(client, databaseId);
  const pages = await queryDatabasePages(client, databaseId, query);
  const files: NotionVfsFile[] = [
    {
      path: notionDatabaseMetadataPath(databaseId),
      contentType: 'application/json; charset=utf-8',
      content: `${JSON.stringify(normalizeDatabase(database), null, 2)}\n`,
      semantics: buildDatabaseSemantics(database),
    },
  ];

  for (const page of pages) {
    files.push(...(await ingestPageArtifacts(client, page, { databaseId })));
  }

  return files;
}

export function serializePropertySchema(name: string, property: NotionPropertySchema): SerializedPropertySchema {
  const { id, type, ...rest } = property;
  return {
    id,
    name,
    type: String(type),
    config: sanitizeJson(rest),
  };
}

function sanitizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJson(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizeJson(child)]),
    ) as JsonValue;
  }
  return null;
}

function buildDatabaseSemantics(database: NotionDatabase): FileSemantics {
  const properties: Record<string, string> = {
    provider: 'notion',
    'provider.object_id': database.id,
    'provider.object_type': 'database',
    'notion.database_id': database.id,
  };
  if (database.last_edited_time) {
    properties['notion.last_edited_time'] = database.last_edited_time;
  }
  return {
    properties,
  };
}
