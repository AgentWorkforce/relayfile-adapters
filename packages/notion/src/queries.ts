export interface NotionProxyOperation {
  endpoint: string;
  method: 'GET' | 'POST';
  data?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface NotionPaginationOptions {
  page_size?: number;
  start_cursor?: string;
}

export interface NotionSearchOptions extends NotionPaginationOptions {
  query?: string;
  sort?: {
    direction: 'ascending' | 'descending';
    timestamp: 'last_edited_time';
  };
}

export interface NotionQueryDatabaseOptions extends NotionPaginationOptions {
  filter?: NotionDatabaseFilter;
  sorts?: Array<Record<string, unknown>>;
}

export type NotionDatabaseFilterType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'checkbox'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'people'
  | 'files'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'relation'
  | 'formula'
  | 'created_time'
  | 'created_by'
  | 'last_edited_time'
  | 'last_edited_by';

export interface NotionDatabaseFilterInput {
  property: string;
  value: unknown;
  type?: NotionDatabaseFilterType;
  operator?: string;
}

export type NotionDatabaseFilter = Record<string, unknown>;

export interface NotionListResponse<T = NotionObject> {
  object?: 'list';
  results?: T[];
  next_cursor?: string | null;
  has_more?: boolean;
  type?: string;
  page_or_database?: Record<string, unknown>;
}

export interface NotionObject {
  object?: string;
  id?: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  url?: string;
  public_url?: string | null;
  properties?: Record<string, unknown>;
  parent?: Record<string, unknown>;
  created_by?: Record<string, unknown>;
  last_edited_by?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NotionPage extends NotionObject {
  object?: 'page';
  properties?: Record<string, unknown>;
}

export interface NotionDatabase extends NotionObject {
  object?: 'database';
  title?: unknown[];
  description?: unknown[];
  properties?: Record<string, unknown>;
}

export interface NotionBlock extends NotionObject {
  object?: 'block';
  type?: string;
  has_children?: boolean;
}

const TIMESTAMP_FILTER_TYPES = new Set<NotionDatabaseFilterType>([
  'created_time',
  'last_edited_time',
]);

const CONTAINS_FILTER_TYPES = new Set<NotionDatabaseFilterType>([
  'multi_select',
  'people',
  'relation',
  'created_by',
  'last_edited_by',
]);

const BOOLEAN_EMPTY_OPERATORS = new Set([
  'is_empty',
  'is_not_empty',
]);

const EMPTY_OBJECT_OPERATORS = new Set([
  'past_week',
  'past_month',
  'past_year',
  'this_week',
  'next_week',
  'next_month',
  'next_year',
]);

export function searchPages(options: NotionSearchOptions = {}): NotionProxyOperation {
  return buildSearchOperation('page', options);
}

export function searchDatabases(options: NotionSearchOptions = {}): NotionProxyOperation {
  return buildSearchOperation('database', options);
}

export function queryDatabase(
  databaseId: string,
  options: NotionQueryDatabaseOptions = {},
): NotionProxyOperation {
  const data = compactRecord({
    filter: options.filter,
    sorts: options.sorts,
    page_size: options.page_size,
    start_cursor: emptyStringToUndefined(options.start_cursor),
  });

  return {
    method: 'POST',
    endpoint: `/v1/databases/${encodeURIComponent(databaseId)}/query`,
    ...(Object.keys(data).length > 0 ? { data } : {}),
  };
}

export function getPage(pageId: string): NotionProxyOperation {
  return {
    method: 'GET',
    endpoint: `/v1/pages/${encodeURIComponent(pageId)}`,
  };
}

export function getBlockChildren(
  blockId: string,
  options: NotionPaginationOptions = {},
): NotionProxyOperation {
  return {
    method: 'GET',
    endpoint: withQueryString(`/v1/blocks/${encodeURIComponent(blockId)}/children`, {
      page_size: options.page_size,
      start_cursor: emptyStringToUndefined(options.start_cursor),
    }),
  };
}

export function buildDatabaseFilter(input: NotionDatabaseFilterInput): NotionDatabaseFilter {
  const property = input.property.trim();
  const filterType = input.type ?? inferDatabaseFilterType(input.value);
  const operator = input.operator ?? inferDefaultOperator(filterType, input.value);

  if (!property && !TIMESTAMP_FILTER_TYPES.has(filterType)) {
    throw new Error('Notion database filters require a non-empty property name.');
  }

  if (TIMESTAMP_FILTER_TYPES.has(filterType)) {
    return {
      timestamp: filterType,
      [filterType]: buildOperatorExpression(operator, input.value),
    };
  }

  if (filterType === 'formula') {
    return {
      property,
      formula: buildFormulaExpression(operator, input.value),
    };
  }

  if (CONTAINS_FILTER_TYPES.has(filterType) && Array.isArray(input.value)) {
    const values = input.value.filter(isDefined);
    if (values.length === 0) {
      throw new Error(`Notion ${filterType} filters require at least one value.`);
    }

    if (values.length === 1) {
      return {
        property,
        [filterType]: buildOperatorExpression(operator, values[0]),
      };
    }

    return {
      or: values.map((value) => ({
        property,
        [filterType]: buildOperatorExpression(operator, value),
      })),
    };
  }

  return {
    property,
    [filterType]: buildOperatorExpression(operator, input.value),
  };
}

function buildSearchOperation(
  objectType: 'page' | 'database',
  options: NotionSearchOptions,
): NotionProxyOperation {
  return {
    method: 'POST',
    endpoint: '/v1/search',
    data: compactRecord({
      query: emptyStringToUndefined(options.query),
      sort: options.sort,
      page_size: options.page_size,
      start_cursor: emptyStringToUndefined(options.start_cursor),
      filter: {
        property: 'object',
        value: objectType,
      },
    }),
  };
}

function inferDatabaseFilterType(value: unknown): NotionDatabaseFilterType {
  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'boolean') {
    return 'checkbox';
  }

  if (Array.isArray(value)) {
    return 'multi_select';
  }

  if (value instanceof Date || isIsoDateString(value)) {
    return 'date';
  }

  return 'rich_text';
}

function inferDefaultOperator(type: NotionDatabaseFilterType, value: unknown): string {
  switch (type) {
    case 'created_time':
    case 'last_edited_time':
      return 'after';
    case 'date':
      return 'on_or_after';
    case 'title':
    case 'rich_text':
      return 'contains';
    case 'multi_select':
    case 'people':
    case 'relation':
    case 'created_by':
    case 'last_edited_by':
      return 'contains';
    case 'files':
      return value === false ? 'is_empty' : 'is_not_empty';
    case 'formula':
      return 'equals';
    default:
      return 'equals';
  }
}

function buildFormulaExpression(operator: string, value: unknown): Record<string, unknown> {
  const subtype = inferFormulaSubtype(value);
  return {
    [subtype]: buildOperatorExpression(operator, normalizeFilterValue(value)),
  };
}

function inferFormulaSubtype(value: unknown): 'checkbox' | 'date' | 'number' | 'string' {
  if (typeof value === 'boolean') {
    return 'checkbox';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (value instanceof Date || isIsoDateString(value)) {
    return 'date';
  }

  return 'string';
}

function buildOperatorExpression(operator: string, value: unknown): Record<string, unknown> {
  if (BOOLEAN_EMPTY_OPERATORS.has(operator)) {
    return { [operator]: true };
  }

  if (EMPTY_OBJECT_OPERATORS.has(operator)) {
    return { [operator]: {} };
  }

  if (value === undefined || value === null) {
    return { [operator]: true };
  }

  return {
    [operator]: normalizeFilterValue(value),
  };
}

function normalizeFilterValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function withQueryString(
  endpoint: string,
  params: Record<string, number | string | undefined>,
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}

function compactRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
}

function emptyStringToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function isIsoDateString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(value.trim())
  );
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
