// Minimal but faithful Markdown -> Atlassian Document Format (ADF) converter.
//
// Jira Cloud's REST v3 comment/description fields require ADF, not plain text or
// HTML. Relayfile authors write Markdown, so the writeback resolver runs the
// comment body through this converter. Supported: paragraphs (soft-wrapped),
// ATX headings, fenced code blocks, bullet/ordered lists, and inline bold,
// italic, inline code, and links. Anything unrecognized degrades to plain text.

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: AdfNode[];
}

export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

function textNode(
  text: string,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>,
): AdfNode {
  return marks && marks.length ? { type: 'text', text, marks } : { type: 'text', text };
}

// Inline patterns in priority order. Inline code wins over emphasis so that
// `*x*` inside backticks stays literal; links are matched before emphasis so a
// URL's underscores don't become italics.
const INLINE_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpExecArray) => AdfNode | null;
}> = [
  { re: /`([^`]+)`/, build: (m) => textNode(m[1] ?? '', [{ type: 'code' }]) },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    build: (m) => textNode(m[1] ?? '', [{ type: 'link', attrs: { href: m[2] ?? '' } }]),
  },
  { re: /\*\*([^*]+)\*\*/, build: (m) => textNode(m[1] ?? '', [{ type: 'strong' }]) },
  { re: /__([^_]+)__/, build: (m) => textNode(m[1] ?? '', [{ type: 'strong' }]) },
  { re: /\*([^*]+)\*/, build: (m) => textNode(m[1] ?? '', [{ type: 'em' }]) },
  { re: /(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/, build: (m) => textNode(m[1] ?? '', [{ type: 'em' }]) },
];

function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  let rest = text;
  while (rest.length) {
    let best: { idx: number; len: number; node: AdfNode } | null = null;
    for (const pattern of INLINE_PATTERNS) {
      const m = pattern.re.exec(rest);
      if (!m) continue;
      if (best === null || m.index < best.idx) {
        const node = pattern.build(m);
        if (node) best = { idx: m.index, len: m[0].length, node };
      }
    }
    if (!best) {
      if (rest) nodes.push(textNode(rest));
      break;
    }
    if (best.idx > 0) nodes.push(textNode(rest.slice(0, best.idx)));
    nodes.push(best.node);
    rest = rest.slice(best.idx + best.len);
  }
  // ADF text nodes must be non-empty.
  return nodes.filter((n) => n.type !== 'text' || (n.text && n.text.length > 0));
}

function listItem(text: string): AdfNode {
  return { type: 'listItem', content: [{ type: 'paragraph', content: parseInline(text) }] };
}

function parseBlocks(markdown: string): AdfNode[] {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: AdfNode[] = [];
  let i = 0;
  const isBlockStart = (l: string) => /^(#{1,6})\s|^\s*[-*]\s|^\s*\d+\.\s|^```/.test(l);

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++; // consume closing fence
      const codeText = buf.join('\n');
      blocks.push({
        type: 'codeBlock',
        ...(lang ? { attrs: { language: lang } } : {}),
        content: codeText ? [{ type: 'text', text: codeText }] : [],
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        attrs: { level: (heading[1] ?? '#').length },
        content: parseInline((heading[2] ?? '').trim()),
      });
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push(listItem((lines[i] ?? '').replace(/^\s*[-*]\s+/, '')));
        i++;
      }
      blocks.push({ type: 'bulletList', content: items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push(listItem((lines[i] ?? '').replace(/^\s*\d+\.\s+/, '')));
        i++;
      }
      blocks.push({ type: 'orderedList', content: items });
      continue;
    }

    // Paragraph: gather soft-wrapped lines until a blank line or a new block.
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !isBlockStart(lines[i] ?? '')) {
      para.push((lines[i] ?? '').trim());
      i++;
    }
    blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
  }

  return blocks;
}

/**
 * Convert a Markdown string into an ADF document. Always returns a valid doc
 * (an empty input yields a single empty paragraph).
 */
export function markdownToAdf(markdown: string): AdfDoc {
  const content = parseBlocks(markdown);
  return {
    type: 'doc',
    version: 1,
    content: content.length ? content : [{ type: 'paragraph', content: [] }],
  };
}

/** True when a value already looks like an ADF document (pass-through case). */
export function isAdfDoc(value: unknown): value is AdfDoc {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'doc' &&
    Array.isArray((value as { content?: unknown }).content)
  );
}
