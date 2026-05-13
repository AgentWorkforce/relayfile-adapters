export const AIRTABLE_PATH_ROOT = '/airtable';

export const AIRTABLE_OBJECT_TYPES = [
  'record',
  'table',
  'base',
] as const;

export type AirtablePathObjectType = (typeof AIRTABLE_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, AirtablePathObjectType>> = {
  airtablebase: 'base',
  airtablerecord: 'record',
  airtabletable: 'table',
  base: 'base',
  bases: 'base',
  record: 'record',
  records: 'record',
  table: 'table',
  tables: 'table',
};

const NANGO_MODEL_MAP: Readonly<Record<string, AirtablePathObjectType>> = {
  AirtableBase: 'base',
  AirtableRecord: 'record',
  AirtableTable: 'table',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Airtable ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeAirtablePathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeAirtableObjectType(objectType: string): AirtablePathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Airtable object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeAirtableObjectType(objectType: string): AirtablePathObjectType | undefined {
  try {
    return normalizeAirtableObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoAirtableModel(model: string): AirtablePathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeAirtableObjectType(model);
}

export function airtableBasePath(baseId: string): string {
  return `${AIRTABLE_PATH_ROOT}/bases/${encodeAirtablePathSegment(baseId)}.json`;
}

export function airtableTablePath(baseId: string, tableId: string): string {
  return `${AIRTABLE_PATH_ROOT}/bases/${encodeAirtablePathSegment(baseId)}/tables/${encodeAirtablePathSegment(tableId)}.json`;
}

export function airtableRecordPath(baseId: string, tableId: string, recordId: string): string {
  return `${AIRTABLE_PATH_ROOT}/bases/${encodeAirtablePathSegment(baseId)}/tables/${encodeAirtablePathSegment(tableId)}/records/${encodeAirtablePathSegment(recordId)}.json`;
}

export function airtableNotificationPath(baseId: string, webhookId: string): string {
  return `${AIRTABLE_PATH_ROOT}/bases/${encodeAirtablePathSegment(baseId)}/_notifications/${encodeAirtablePathSegment(webhookId)}.json`;
}

export function computeAirtablePath(
  objectType: string,
  objectId: string,
  context: { baseId?: string; tableId?: string } = {},
): string {
  const normalizedType = normalizeAirtableObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'base':
      return airtableBasePath(normalizedId);
    case 'table':
      return airtableTablePath(resolveBaseId(context.baseId), normalizedId);
    case 'record':
      return airtableRecordPath(resolveBaseId(context.baseId), resolveTableId(context.tableId), normalizedId);
  }
}

export function parseAirtablePath(path: string): {
  baseId?: string;
  objectId: string;
  objectType: AirtablePathObjectType;
  tableId?: string;
} {
  const baseMatch = path.match(/^\/airtable\/bases\/([^/]+)\.json$/);
  if (baseMatch?.[1]) {
    return {
      objectId: decodeURIComponent(baseMatch[1]),
      objectType: 'base',
    };
  }

  const tableMatch = path.match(/^\/airtable\/bases\/([^/]+)\/tables\/([^/]+)\.json$/);
  if (tableMatch?.[1] && tableMatch[2]) {
    return {
      baseId: decodeURIComponent(tableMatch[1]),
      objectId: decodeURIComponent(tableMatch[2]),
      objectType: 'table',
      tableId: decodeURIComponent(tableMatch[2]),
    };
  }

  const recordMatch = path.match(/^\/airtable\/bases\/([^/]+)\/tables\/([^/]+)\/records\/([^/]+)\.json$/);
  if (recordMatch?.[1] && recordMatch[2] && recordMatch[3]) {
    return {
      baseId: decodeURIComponent(recordMatch[1]),
      objectId: decodeURIComponent(recordMatch[3]),
      objectType: 'record',
      tableId: decodeURIComponent(recordMatch[2]),
    };
  }

  throw new Error(`No Airtable path rule matched ${path}`);
}

export function parseAirtableNotificationPath(path: string): {
  baseId: string;
  webhookId: string;
} {
  const notificationMatch = path.match(/^\/airtable\/bases\/([^/]+)\/_notifications\/([^/]+)\.json$/);
  if (notificationMatch?.[1] && notificationMatch[2]) {
    return {
      baseId: decodeURIComponent(notificationMatch[1]),
      webhookId: decodeURIComponent(notificationMatch[2]),
    };
  }

  throw new Error(`No Airtable notification path rule matched ${path}`);
}

function resolveBaseId(baseId: string | undefined): string {
  if (!baseId) {
    throw new Error('Airtable base id is required for this path');
  }
  return baseId;
}

function resolveTableId(tableId: string | undefined): string {
  if (!tableId) {
    throw new Error('Airtable table id is required for this path');
  }
  return tableId;
}
