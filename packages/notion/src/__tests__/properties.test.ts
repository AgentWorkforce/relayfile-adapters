import { describe, expect, it } from 'vitest';
import { deserializePropertyValue, serializePropertyValue } from '../pages/properties.js';
import type { NotionPageProperty } from '../types.js';

function property<T extends NotionPageProperty>(value: T): T {
  return value;
}

describe('property serialization', () => {
  it('serializes each supported writeable property type', () => {
    const values: NotionPageProperty[] = [
      property({
        id: '1',
        type: 'title',
        title: [{ type: 'text', text: { content: 'Hello', link: null }, plain_text: 'Hello', href: null, annotations: defaults() }],
      }),
      property({
        id: '2',
        type: 'rich_text',
        rich_text: [{ type: 'text', text: { content: 'World', link: null }, plain_text: 'World', href: null, annotations: defaults() }],
      }),
      property({ id: '3', type: 'number', number: 42 }),
      property({ id: '4', type: 'select', select: { name: 'Open' } }),
      property({ id: '5', type: 'multi_select', multi_select: [{ name: 'A' }, { name: 'B' }] }),
      property({ id: '6', type: 'status', status: { name: 'In Progress' } }),
      property({ id: '7', type: 'date', date: { start: '2026-03-28' } }),
      property({ id: '8', type: 'people', people: [{ object: 'user', id: 'user-1', name: 'Ada' }] }),
      property({ id: '9', type: 'files', files: [{ type: 'external', external: { url: 'https://example.com/file.png' } }] }),
      property({ id: '10', type: 'checkbox', checkbox: true }),
      property({ id: '11', type: 'url', url: 'https://example.com' }),
      property({ id: '12', type: 'email', email: 'team@example.com' }),
      property({ id: '13', type: 'phone_number', phone_number: '+4712345678' }),
      property({ id: '14', type: 'relation', relation: [{ id: 'page-2' }] }),
      property({ id: '15', type: 'formula', formula: { type: 'number', number: 4 } }),
      property({ id: '16', type: 'rollup', rollup: { type: 'array', array: [{ type: 'number', number: 2 }] } }),
    ];

    const serialized = values.map(serializePropertyValue);
    expect(serialized.map((entry) => entry.type)).toEqual(values.map((entry) => entry.type));

    expect(deserializePropertyValue(serialized[0])).toEqual({
      title: [{ type: 'text', text: { content: 'Hello', link: null }, plain_text: 'Hello', href: null, annotations: defaults() }],
    });
    expect(deserializePropertyValue(serialized[3])).toEqual({ select: { name: 'Open' } });
    expect(deserializePropertyValue(serialized[4])).toEqual({ multi_select: [{ name: 'A' }, { name: 'B' }] });
    expect(deserializePropertyValue(serialized[7])).toEqual({ people: [{ id: 'user-1' }] });
    expect(deserializePropertyValue(serialized[8])).toEqual({
      files: [{ type: 'external', external: { url: 'https://example.com/file.png' } }],
    });
    expect(serialized[5].displayValue).toBe('In Progress');
    expect(serialized[6].displayValue).toBe('2026-03-28');
    expect(serialized[14].value).toEqual({ type: 'number', number: 4 });
    expect(serialized[15].value).toEqual({ type: 'array', array: [{ type: 'number', number: 2 }] });
  });

  it('rejects read-only properties on writeback', () => {
    const value = serializePropertyValue(property({ id: '17', type: 'formula', formula: { type: 'number', number: 4 } }));
    expect(() => deserializePropertyValue(value)).toThrow(/read-only/);
  });
});

function defaults() {
  return {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: 'default',
  };
}
