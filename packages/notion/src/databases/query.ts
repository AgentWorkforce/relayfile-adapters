import type {
  JsonValue,
  NotionDatabaseQueryInput,
  NotionFilterCondition,
  NotionSortCondition,
} from '../types.js';

const TEXT_TYPES = new Set(['rich_text', 'title', 'url', 'email', 'phone_number']);
const NUMBER_TYPES = new Set(['number']);
const BOOLEAN_TYPES = new Set(['checkbox']);
const OBJECT_TYPES = new Set(['date', 'formula', 'multi_select', 'people', 'relation', 'rollup', 'select', 'status']);
const TIMESTAMP_TYPES = new Set(['created_time', 'last_edited_time']);

export function buildFilter(condition?: NotionFilterCondition): Record<string, unknown> | undefined {
  if (!condition) {
    return undefined;
  }
  if (condition.and?.length) {
    return { and: condition.and.map((item) => requireFilter(buildFilter(item))) };
  }
  if (condition.or?.length) {
    return { or: condition.or.map((item) => requireFilter(buildFilter(item))) };
  }

  const operator = condition.operator ?? inferDefaultOperator(condition.type, condition.timestamp);
  if (!operator) {
    throw new Error('Leaf filter conditions require an operator');
  }

  if (condition.timestamp) {
    return {
      timestamp: condition.timestamp,
      [condition.timestamp]: buildOperatorValue(operator, condition.value),
    };
  }

  if (!condition.property) {
    throw new Error('Property filters require condition.property');
  }

  const filterType = condition.type ?? inferFilterTypeFromValue(condition.value);
  return {
    property: condition.property,
    [filterType]: buildOperatorValue(operator, condition.value),
  };
}

export function buildSorts(sorts: NotionSortCondition[] = []): Array<Record<string, string>> {
  return sorts.map((sort) => {
    const direction = sort.direction ?? 'ascending';
    const entry: Record<string, string> = { direction };
    if (sort.property) {
      entry.property = sort.property;
      return entry;
    }
    if (sort.timestamp) {
      entry.timestamp = sort.timestamp;
      return entry;
    }
    throw new Error('Each Notion sort requires either property or timestamp');
  });
}

export function buildDatabaseQuery(input: NotionDatabaseQueryInput = {}): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const filter = buildFilter(input.filter);
  const sorts = buildSorts(input.sorts);

  if (filter) {
    query.filter = filter;
  }
  if (sorts.length > 0) {
    query.sorts = sorts;
  }
  if (input.pageSize !== undefined) {
    query.page_size = input.pageSize;
  }
  if (input.startCursor) {
    query.start_cursor = input.startCursor;
  }

  return query;
}

export function buildLastEditedSinceFilter(isoTimestamp: string): Record<string, unknown> {
  return requireFilter(
    buildFilter({
      timestamp: 'last_edited_time',
      operator: 'after',
      value: isoTimestamp,
    }),
  );
}

function buildOperatorValue(operator: string, value: JsonValue | undefined): Record<string, JsonValue | undefined> {
  return value === undefined ? { [operator]: true } : { [operator]: value };
}

function inferDefaultOperator(type?: string, timestamp?: string): string | undefined {
  if (timestamp) {
    return 'after';
  }
  if (!type) {
    return undefined;
  }
  if (TEXT_TYPES.has(type) || OBJECT_TYPES.has(type) || NUMBER_TYPES.has(type) || BOOLEAN_TYPES.has(type)) {
    return 'equals';
  }
  return undefined;
}

function inferFilterTypeFromValue(value: JsonValue | undefined): string {
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'checkbox';
  }
  if (Array.isArray(value)) {
    return 'multi_select';
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) {
    return 'date';
  }
  return 'rich_text';
}

function requireFilter(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) {
    throw new Error('Expected filter value');
  }
  return value;
}

export function isTimestampFilterType(type: string): boolean {
  return TIMESTAMP_TYPES.has(type);
}
