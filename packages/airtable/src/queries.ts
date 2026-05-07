import { parseAirtablePath } from './path-mapper.js';
import type { AirtableReadRequest } from './types.js';

export const AIRTABLE_RECORDS_ROUTE_TEMPLATE = '/v0/{baseId}/{tableId}';
export const AIRTABLE_RECORD_ROUTE_TEMPLATE = '/v0/{baseId}/{tableId}/{recordId}';
export const AIRTABLE_BASE_SCHEMA_ROUTE_TEMPLATE = '/v0/meta/bases/{baseId}/tables';

export function resolveAirtableReadRequest(path: string): AirtableReadRequest {
  const parsed = parseAirtablePath(path);

  switch (parsed.objectType) {
    case 'base':
      return {
        action: 'get_base',
        endpoint: `/v0/meta/bases/${encodeURIComponent(parsed.objectId)}/tables`,
        method: 'GET',
        routeTemplate: AIRTABLE_BASE_SCHEMA_ROUTE_TEMPLATE,
      };
    case 'table':
      return {
        action: 'get_table_records',
        endpoint: `/v0/${encodeURIComponent(requireBaseId(parsed.baseId))}/${encodeURIComponent(parsed.objectId)}`,
        method: 'GET',
        routeTemplate: AIRTABLE_RECORDS_ROUTE_TEMPLATE,
      };
    case 'record':
      return {
        action: 'get_record',
        endpoint: `/v0/${encodeURIComponent(requireBaseId(parsed.baseId))}/${encodeURIComponent(requireTableId(parsed.tableId))}/${encodeURIComponent(parsed.objectId)}`,
        method: 'GET',
        routeTemplate: AIRTABLE_RECORD_ROUTE_TEMPLATE,
      };
  }
}

function requireBaseId(baseId: string | undefined): string {
  if (!baseId) {
    throw new Error('Airtable read route requires baseId');
  }
  return baseId;
}

function requireTableId(tableId: string | undefined): string {
  if (!tableId) {
    throw new Error('Airtable read route requires tableId');
  }
  return tableId;
}
