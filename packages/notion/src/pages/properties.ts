import type {
  JsonObject,
  JsonValue,
  NotionDateValue,
  NotionFileAsset,
  NotionPageProperty,
  NotionRichText,
  NotionSelectOption,
  SerializedPropertyValue,
} from '../types.js';

export function richTextToPlainText(richText: NotionRichText[] = []): string {
  return richText.map((item) => item.plain_text ?? '').join('');
}

export function serializePropertyValue(property: NotionPageProperty): SerializedPropertyValue {
  switch (property.type) {
    case 'title':
      return serializeWithDisplay(property, property.title, richTextToPlainText(property.title));
    case 'rich_text':
      return serializeWithDisplay(property, property.rich_text, richTextToPlainText(property.rich_text));
    case 'number':
      return serializeWithDisplay(property, property.number, property.number === null ? '' : String(property.number));
    case 'select':
      return serializeWithDisplay(property, property.select, property.select?.name ?? '');
    case 'multi_select':
      return serializeWithDisplay(
        property,
        property.multi_select,
        property.multi_select.map((option) => option.name).join(', '),
      );
    case 'status':
      return serializeWithDisplay(property, property.status, property.status?.name ?? '');
    case 'date':
      return serializeWithDisplay(property, property.date, property.date?.start ?? '');
    case 'people':
      return serializeWithDisplay(
        property,
        property.people,
        property.people.map((person) => person.name ?? person.id).join(', '),
      );
    case 'files':
      return serializeWithDisplay(property, property.files, property.files.map(fileAssetToString).join(', '));
    case 'checkbox':
      return serializeWithDisplay(property, property.checkbox, String(property.checkbox));
    case 'url':
      return serializeWithDisplay(property, property.url, property.url ?? '');
    case 'email':
      return serializeWithDisplay(property, property.email, property.email ?? '');
    case 'phone_number':
      return serializeWithDisplay(property, property.phone_number, property.phone_number ?? '');
    case 'relation':
      return serializeWithDisplay(
        property,
        property.relation.map((relation) => relation.id),
        property.relation.map((relation) => relation.id).join(', '),
      );
    case 'formula':
      return serializeWithDisplay(property, toJsonValue(property.formula), stringifyFallback(property.formula));
    case 'rollup':
      return serializeWithDisplay(property, toJsonValue(property.rollup), stringifyFallback(property.rollup));
    case 'created_time':
      return serializeWithDisplay(property, property.created_time, property.created_time);
    case 'created_by':
      return serializeWithDisplay(property, property.created_by, property.created_by.name ?? property.created_by.id);
    case 'last_edited_time':
      return serializeWithDisplay(property, property.last_edited_time, property.last_edited_time);
    case 'last_edited_by':
      return serializeWithDisplay(property, property.last_edited_by, property.last_edited_by.name ?? property.last_edited_by.id);
  }
}

export function deserializePropertyValue(input: SerializedPropertyValue | Record<string, unknown>): Record<string, unknown> {
  const rawInput = input as Record<string, unknown>;
  if (isRawNotionPropertyValue(rawInput) && !('type' in rawInput && 'value' in rawInput)) {
    return rawInput;
  }

  const typedInput = input as SerializedPropertyValue;
  const { type } = typedInput;
  const value = typedInput.value as JsonValue;

  switch (type) {
    case 'title':
      return { title: toRichTextArray(value) };
    case 'rich_text':
      return { rich_text: toRichTextArray(value) };
    case 'number':
      return { number: value === null ? null : Number(value) };
    case 'select':
      return { select: toSelectOption(value) };
    case 'multi_select':
      return { multi_select: toMultiSelectOptions(value) };
    case 'status':
      return { status: toSelectOption(value) };
    case 'date':
      return { date: toDateValue(value) };
    case 'people':
      return { people: toPeopleArray(value) };
    case 'files':
      return { files: toFilesArray(value) };
    case 'checkbox':
      return { checkbox: Boolean(value) };
    case 'url':
      return { url: value === null ? null : String(value) };
    case 'email':
      return { email: value === null ? null : String(value) };
    case 'phone_number':
      return { phone_number: value === null ? null : String(value) };
    case 'relation':
      return { relation: toRelationArray(value) };
    case 'formula':
    case 'rollup':
    case 'created_time':
    case 'created_by':
    case 'last_edited_time':
    case 'last_edited_by':
      throw new Error(`Property type ${type} is read-only in Notion writeback`);
    default:
      throw new Error(`Unsupported property type for writeback: ${type}`);
  }
}

export function serializePropertyMap(properties: Record<string, NotionPageProperty>): Record<string, SerializedPropertyValue> {
  return Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, serializePropertyValue(property)]));
}

export function deserializePropertyMap(properties: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, deserializePropertyValue(property)]));
}

function serializeWithDisplay(property: NotionPageProperty, value: unknown, displayValue: string): SerializedPropertyValue {
  return {
    id: property.id,
    type: property.type,
    value,
    displayValue,
    raw: property as unknown as JsonObject,
  };
}

function toRichTextArray(value: JsonValue): NotionRichText[] {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'object')) {
    return value as unknown as NotionRichText[];
  }
  if (typeof value === 'string') {
    return [
      {
        type: 'text',
        text: { content: value, link: null },
        plain_text: value,
        href: null,
        annotations: defaultAnnotations(),
      },
    ];
  }
  throw new Error('Expected a string or rich text array');
}

function toSelectOption(value: JsonValue): NotionSelectOption | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return { name: value };
  }
  if (isRecord(value) && typeof value.name === 'string') {
    return { id: typeof value.id === 'string' ? value.id : undefined, name: value.name, color: asString(value.color) };
  }
  throw new Error('Expected null, string, or Notion select option');
}

function toMultiSelectOptions(value: JsonValue): NotionSelectOption[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array for multi_select values');
  }
  return value.map((entry) => toSelectOption(entry) ?? { name: '' }).filter((entry) => entry.name);
}

function toDateValue(value: JsonValue): NotionDateValue | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return { start: value };
  }
  if (isRecord(value) && typeof value.start === 'string') {
    return {
      start: value.start,
      end: asStringOrNull(value.end),
      time_zone: asStringOrNull(value.time_zone),
    };
  }
  throw new Error('Expected null, ISO date string, or Notion date value');
}

function toPeopleArray(value: JsonValue): Array<{ id: string }> {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array of person identifiers');
  }
  return value.map((entry) => {
    if (typeof entry === 'string') {
      return { id: entry };
    }
    if (isRecord(entry) && typeof entry.id === 'string') {
      return { id: entry.id };
    }
    throw new Error('Invalid people item');
  });
}

function toFilesArray(value: JsonValue): NotionFileAsset[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array of files');
  }
  return value.map((entry) => {
    if (typeof entry === 'string') {
      return { type: 'external', name: entry, external: { url: entry } };
    }
    if (isRecord(entry) && typeof entry.type === 'string') {
      return entry as unknown as NotionFileAsset;
    }
    throw new Error('Invalid file item');
  });
}

function toRelationArray(value: JsonValue): Array<{ id: string }> {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array of relation identifiers');
  }
  return value.map((entry) => {
    if (typeof entry === 'string') {
      return { id: entry };
    }
    if (isRecord(entry) && typeof entry.id === 'string') {
      return { id: entry.id };
    }
    throw new Error('Invalid relation item');
  });
}

function isRawNotionPropertyValue(value: Record<string, unknown>): boolean {
  return KNOWN_PROPERTY_KEYS.some((key) => key in value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }
  return value as JsonValue;
}

function stringifyFallback(value: unknown): string {
  return value === null || value === undefined ? '' : JSON.stringify(value);
}

function fileAssetToString(file: NotionFileAsset): string {
  return file.external?.url ?? file.file?.url ?? file.name ?? '';
}

function defaultAnnotations() {
  return {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: 'default',
  };
}

function isRecord(value: JsonValue): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringOrNull(value: unknown): string | null | undefined {
  return value === null ? null : asString(value);
}

const KNOWN_PROPERTY_KEYS = [
  'checkbox',
  'created_by',
  'created_time',
  'date',
  'email',
  'files',
  'formula',
  'last_edited_by',
  'last_edited_time',
  'multi_select',
  'number',
  'people',
  'phone_number',
  'relation',
  'rich_text',
  'rollup',
  'select',
  'status',
  'title',
  'url',
];
