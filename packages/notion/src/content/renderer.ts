import { richTextToPlainText } from '../pages/properties.js';
import type { JsonObject, NotionBlock, NotionFileAsset, NotionRichText } from '../types.js';

export function renderBlocksToMarkdown(blocks: NotionBlock[]): string {
  return blocks.map((block) => renderBlock(block, 0)).filter(Boolean).join('\n\n').trim();
}

export function renderRichTextToMarkdown(richText: NotionRichText[] = []): string {
  return richText
    .map((item) => {
      if (item.type === 'equation') {
        return `$${item.equation.expression}$`;
      }
      const raw = item.type === 'text' ? item.text.content : item.plain_text;
      const link = item.type === 'text' ? item.text.link?.url ?? item.href ?? undefined : item.href ?? undefined;
      let text = escapeInlineCode(raw);
      if (item.annotations.code) {
        text = `\`${text}\``;
      }
      if (item.annotations.bold) {
        text = `**${text}**`;
      }
      if (item.annotations.italic) {
        text = `*${text}*`;
      }
      if (item.annotations.strikethrough) {
        text = `~~${text}~~`;
      }
      if (item.annotations.underline) {
        text = `<u>${text}</u>`;
      }
      if (link) {
        text = `[${text}](${link})`;
      }
      return text;
    })
    .join('');
}

function renderBlock(block: NotionBlock, depth: number): string {
  const data = getBlockData(block);
  const nested = renderChildren(block.children, depth + 1);
  const text = getBlockText(block, data);

  switch (block.type) {
    case 'paragraph':
      return joinBlock(text, nested);
    case 'heading_1':
      return joinBlock(`# ${text}`, nested);
    case 'heading_2':
      return joinBlock(`## ${text}`, nested);
    case 'heading_3':
      return joinBlock(`### ${text}`, nested);
    case 'bulleted_list_item':
      return joinBlock(`${indent(depth)}- ${text}`, nested, true);
    case 'numbered_list_item':
      return joinBlock(`${indent(depth)}1. ${text}`, nested, true);
    case 'to_do':
      return joinBlock(`${indent(depth)}- [${data.checked ? 'x' : ' '}] ${text}`, nested, true);
    case 'toggle':
      return [`<details>`, `<summary>${text}</summary>`, nested, `</details>`].filter(Boolean).join('\n');
    case 'quote':
      return joinBlock(prefixLines(text, '> '), nested ? prefixLines(nested, '> ') : '', false);
    case 'callout':
      return joinBlock(`<callout>${text}</callout>`, nested);
    case 'equation':
      return text ? `$$\n${text}\n$$` : '$$\n$$';
    case 'code': {
      const code = text || richTextToPlainText(asRichTextArray(data.rich_text));
      const language = typeof data.language === 'string' ? data.language : '';
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case 'divider':
      return '---';
    case 'image':
      return renderImageLikeBlock('image', data);
    case 'file':
      return renderMediaTag('file', data);
    case 'video':
      return renderMediaTag('video', data);
    case 'audio':
      return renderMediaTag('audio', data);
    case 'pdf':
      return renderMediaTag('pdf', data);
    case 'bookmark':
      return data.url ? `[${text || data.url}](${data.url})` : text;
    case 'embed':
      return data.url ? `<embed src="${data.url}" />` : '<embed />';
    case 'link_preview':
      return data.url ? `[${data.url}](${data.url})` : '<link_preview />';
    case 'breadcrumb':
      return '<breadcrumb />';
    case 'child_page':
      return `<page>${data.title ?? text}</page>`;
    case 'child_database':
      return `<database>${data.title ?? text}</database>`;
    case 'link_to_page':
      return renderLinkToPage(data);
    case 'table':
      return renderTable(block);
    case 'table_of_contents':
      return '<table_of_contents/>';
    case 'template':
      return joinBlock(`<template>${text}</template>`, nested);
    case 'synced_block':
      return joinBlock('<synced_block>', nested);
    case 'column_list':
      return joinBlock('<columns>', nested);
    case 'column':
      return joinBlock('<column>', nested);
    default:
      return block.children?.length ? joinBlock(`<unknown alt="${block.type}"/>`, nested) : `<unknown alt="${block.type}"/>`;
  }
}

function renderChildren(children: NotionBlock[] | undefined, depth: number): string {
  if (!children?.length) {
    return '';
  }
  return children
    .map((child) => renderBlock(child, depth))
    .filter(Boolean)
    .map((content) => (depth > 0 && shouldIndentChild(content) ? indentBlock(content) : content))
    .join('\n\n');
}

function shouldIndentChild(content: string): boolean {
  return !content.startsWith('<details>') && !content.startsWith('```');
}

function renderImageLikeBlock(type: string, data: JsonObject): string {
  const asset = getAssetUrl(data);
  const caption = renderRichTextToMarkdown(asRichTextArray(data.caption));
  if (!asset) {
    return `<${type} />`;
  }
  return `![${caption}](${asset})`;
}

function renderMediaTag(tag: string, data: JsonObject): string {
  const asset = getAssetUrl(data);
  const caption = renderRichTextToMarkdown(asRichTextArray(data.caption));
  return asset ? `<${tag} src="${asset}">${caption}</${tag}>` : `<${tag} />`;
}

function renderTable(block: NotionBlock): string {
  const rows = block.children?.filter((child) => child.type === 'table_row') ?? [];
  if (rows.length === 0) {
    return '<table></table>';
  }
  const renderedRows = rows.map((row) => {
    const cells = (((row.table_row as { cells?: NotionRichText[][] } | undefined)?.cells) ?? []).map((cell) =>
      renderRichTextToMarkdown(cell),
    );
    return `| ${cells.join(' | ')} |`;
  });
  const separator = `| ${new Array(renderedRows[0].split('|').length - 2).fill('---').join(' | ')} |`;
  return [renderedRows[0], separator, ...renderedRows.slice(1)].join('\n');
}

function renderLinkToPage(data: JsonObject): string {
  if (typeof data.page_id === 'string') {
    return `<page_link>${data.page_id}</page_link>`;
  }
  if (typeof data.database_id === 'string') {
    return `<database_link>${data.database_id}</database_link>`;
  }
  if (typeof data.comment_id === 'string') {
    return `<comment_link>${data.comment_id}</comment_link>`;
  }
  return '<link_to_page />';
}

function getBlockText(block: NotionBlock, data: JsonObject): string {
  const richText = asRichTextArray(data.rich_text);
  if (richText.length > 0) {
    return renderRichTextToMarkdown(richText);
  }
  if (block.type === 'equation' && isObject(data.expression) && typeof data.expression.expression === 'string') {
    return data.expression.expression;
  }
  if (block.type === 'equation' && typeof data.expression === 'string') {
    return data.expression;
  }
  if (typeof data.title === 'string') {
    return data.title;
  }
  if (typeof data.url === 'string') {
    return data.url;
  }
  if (block.type === 'code') {
    return richTextToPlainText(richText);
  }
  return '';
}

function getBlockData(block: NotionBlock): JsonObject {
  const raw = block[block.type];
  return isObject(raw) ? (raw as JsonObject) : {};
}

function joinBlock(base: string, nested: string, listLike = false): string {
  if (!nested) {
    return base;
  }
  if (listLike) {
    return `${base}\n${indentBlock(nested)}`;
  }
  return `${base}\n\n${nested}`;
}

function indent(depth: number): string {
  return '  '.repeat(Math.max(0, depth - 1));
}

function indentBlock(content: string): string {
  return content
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
}

function prefixLines(content: string, prefix: string): string {
  return content
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function getAssetUrl(data: JsonObject): string | undefined {
  if (isObject(data.file) && typeof data.file.url === 'string') {
    return data.file.url;
  }
  if (isObject(data.external) && typeof data.external.url === 'string') {
    return data.external.url;
  }
  return undefined;
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, '\\`');
}

function asRichTextArray(value: unknown): NotionRichText[] {
  return Array.isArray(value) ? (value as unknown as NotionRichText[]) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
