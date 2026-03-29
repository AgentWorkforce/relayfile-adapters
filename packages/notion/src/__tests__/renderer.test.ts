import { describe, expect, it } from 'vitest';
import { renderBlocksToMarkdown } from '../content/renderer.js';
import type { NotionBlock } from '../types.js';

describe('blocks to markdown renderer', () => {
  it('renders headings, lists, code, and nested children', () => {
    const blocks: NotionBlock[] = [
      block('heading_1', { rich_text: [text('Roadmap')] }),
      block('paragraph', { rich_text: [text('Ship the adapter')] }),
      {
        ...block('bulleted_list_item', { rich_text: [text('Write tests')] }, true),
        children: [block('to_do', { rich_text: [text('Cover writeback')], checked: true })],
      },
      block('code', { rich_text: [text('const done = true;')], language: 'ts' }),
    ];

    expect(renderBlocksToMarkdown(blocks)).toBe(
      [
        '# Roadmap',
        '',
        'Ship the adapter',
        '',
        '- Write tests',
        '    - [x] Cover writeback',
        '',
        '```ts',
        'const done = true;',
        '```',
      ].join('\n'),
    );
  });

  it('renders media, tables, equations, and page links', () => {
    const blocks: NotionBlock[] = [
      block('image', { external: { url: 'https://example.com/image.png' }, caption: [text('Diagram')] }),
      block('bookmark', { url: 'https://example.com' }),
      block('equation', { expression: 'a^2 + b^2 = c^2' }),
      block('link_preview', { url: 'https://example.com/preview' }),
      block('link_to_page', { page_id: 'page-2' }),
      {
        ...block('table', {}, true),
        children: [
          block('table_row', { cells: [[text('Name')], [text('Value')]] }),
          block('table_row', { cells: [[text('Status')], [text('Done')]] }),
        ],
      },
    ];

    expect(renderBlocksToMarkdown(blocks)).toBe(
      [
        '![Diagram](https://example.com/image.png)',
        '',
        '[https://example.com](https://example.com)',
        '',
        '$$',
        'a^2 + b^2 = c^2',
        '$$',
        '',
        '[https://example.com/preview](https://example.com/preview)',
        '',
        '<page_link>page-2</page_link>',
        '',
        '| Name | Value |',
        '| --- | --- |',
        '| Status | Done |',
      ].join('\n'),
    );
  });
});

function block(type: string, data: Record<string, unknown>, hasChildren = false): NotionBlock {
  return {
    object: 'block',
    id: `${type}-1`,
    type,
    has_children: hasChildren,
    [type]: data,
  } as NotionBlock;
}

function text(content: string) {
  return {
    type: 'text' as const,
    text: { content, link: null },
    plain_text: content,
    href: null,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
  };
}
