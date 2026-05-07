import { parseAirtablePath } from './path-mapper.js';
import type { AirtableWritebackRequest } from './types.js';

export const AIRTABLE_WRITEBACK_ROUTE_TEMPLATE = '/v0/{baseId}/{tableId}';

export function resolveAirtableWritebackRequest(path: string, content: string): AirtableWritebackRequest {
  const parsed = parseAirtablePath(path);
  const payload = parseJsonObject(content);

  if (parsed.objectType === 'record') {
    const fields = unwrapFields(payload);
    const endpoint = `/v0/${encodeURIComponent(requireBaseId(parsed.baseId))}/${encodeURIComponent(requireTableId(parsed.tableId))}`;
    return {
      action: 'update_record',
      body: {
        records: [
          {
            id: parsed.objectId,
            fields,
          },
        ],
      },
      endpoint,
      method: 'PATCH',
      routeTemplate: AIRTABLE_WRITEBACK_ROUTE_TEMPLATE,
    };
  }

  if (parsed.objectType === 'table') {
    const records = readRecords(payload);
    return {
      action: 'create_record',
      body: {
        records,
      },
      endpoint: `/v0/${encodeURIComponent(requireBaseId(parsed.baseId))}/${encodeURIComponent(parsed.objectId)}`,
      method: 'POST',
      routeTemplate: AIRTABLE_WRITEBACK_ROUTE_TEMPLATE,
    };
  }

  throw new Error(`No Airtable writeback rule matched ${path}`);
}

export function resolveAirtableReplaceRecordRequest(path: string, content: string): AirtableWritebackRequest {
  const parsed = parseAirtablePath(path);
  if (parsed.objectType !== 'record') {
    throw new Error(`Airtable replace writeback requires a record path: ${path}`);
  }

  return {
    action: 'replace_record',
    body: {
      records: [
        {
          id: parsed.objectId,
          fields: unwrapFields(parseJsonObject(content)),
        },
      ],
    },
    endpoint: `/v0/${encodeURIComponent(requireBaseId(parsed.baseId))}/${encodeURIComponent(requireTableId(parsed.tableId))}`,
    method: 'PUT',
    routeTemplate: AIRTABLE_WRITEBACK_ROUTE_TEMPLATE,
  };
}

function readRecords(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const records = payload.records;
  if (Array.isArray(records)) {
    return records.map((record) => {
      if (!isRecord(record)) {
        throw new Error('Airtable records writeback expects record objects');
      }
      const fields = unwrapFields(record);
      return { fields };
    });
  }

  return [{ fields: unwrapFields(payload) }];
}

function unwrapFields(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.payload) && looksLikeSyncedEnvelope(payload)) {
    return unwrapFields(payload.payload);
  }

  if (isRecord(payload.fields)) {
    return { ...payload.fields };
  }

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (ENVELOPE_KEYS.has(key)) {
      continue;
    }
    fields[key] = value;
  }

  if (Object.keys(fields).length === 0) {
    throw new Error('Airtable writeback requires at least one field');
  }

  return fields;
}

const ENVELOPE_KEYS = new Set([
  'baseId',
  'connectionId',
  'deleted',
  'eventType',
  'id',
  'objectId',
  'objectType',
  'provider',
  'tableId',
  'workspaceId',
]);

function looksLikeSyncedEnvelope(payload: Record<string, unknown>): boolean {
  return ['provider', 'objectType', 'objectId', 'workspaceId'].some((key) => key in payload);
}

function parseJsonObject(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Airtable writeback content must be valid JSON: ${toErrorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('Airtable writeback content must be a JSON object');
  }
  return parsed;
}

function requireBaseId(baseId: string | undefined): string {
  if (!baseId) {
    throw new Error('Airtable writeback route requires baseId');
  }
  return baseId;
}

function requireTableId(tableId: string | undefined): string {
  if (!tableId) {
    throw new Error('Airtable writeback route requires tableId');
  }
  return tableId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
