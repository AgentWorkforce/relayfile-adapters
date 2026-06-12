import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { markdownToAdf, isAdfDoc } from './adf.js';
import { resolveJiraWritebackRequest } from './writeback.js';

describe('markdownToAdf', () => {
  it('wraps plain text in a single paragraph', () => {
    const doc = markdownToAdf('hello world');
    assert.deepStrictEqual(doc, {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
    });
  });

  it('renders inline bold, italic and code marks', () => {
    const doc = markdownToAdf('a **b** _c_ `d`');
    const para = doc.content[0];
    assert.equal(para?.type, 'paragraph');
    assert.deepStrictEqual(para?.content, [
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'em' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'd', marks: [{ type: 'code' }] },
    ]);
  });

  it('renders links', () => {
    const doc = markdownToAdf('see [docs](https://x.dev/p)');
    assert.deepStrictEqual(doc.content[0]?.content, [
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x.dev/p' } }] },
    ]);
  });

  it('does not format inside inline code', () => {
    const doc = markdownToAdf('`**not bold**`');
    assert.deepStrictEqual(doc.content[0]?.content, [
      { type: 'text', text: '**not bold**', marks: [{ type: 'code' }] },
    ]);
  });

  it('renders headings with the right level', () => {
    const doc = markdownToAdf('## Title');
    assert.deepStrictEqual(doc.content[0], {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Title' }],
    });
  });

  it('renders bullet and ordered lists', () => {
    const bullet = markdownToAdf('- one\n- two');
    assert.equal(bullet.content[0]?.type, 'bulletList');
    assert.equal(bullet.content[0]?.content?.length, 2);
    assert.deepStrictEqual(bullet.content[0]?.content?.[0], {
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
    });
    const ordered = markdownToAdf('1. a\n2. b');
    assert.equal(ordered.content[0]?.type, 'orderedList');
    assert.equal(ordered.content[0]?.content?.length, 2);
  });

  it('renders fenced code blocks with language', () => {
    const doc = markdownToAdf('```ts\nconst x = 1;\n```');
    assert.deepStrictEqual(doc.content[0], {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    });
  });

  it('splits paragraphs on blank lines and soft-wraps within one', () => {
    const doc = markdownToAdf('line one\nline two\n\nsecond para');
    assert.equal(doc.content.length, 2);
    assert.deepStrictEqual(doc.content[0]?.content, [{ type: 'text', text: 'line one line two' }]);
    assert.deepStrictEqual(doc.content[1]?.content, [{ type: 'text', text: 'second para' }]);
  });

  it('does not infinite loop on block starts that do not match block parsers', () => {
    const doc = markdownToAdf('```ts {1-5}');
    assert.deepStrictEqual(doc.content[0], {
      type: 'paragraph',
      content: [{ type: 'text', text: '```ts {1-5}' }],
    });
  });

  it('yields a valid empty doc for empty input', () => {
    assert.deepStrictEqual(markdownToAdf(''), {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [] }],
    });
  });

  it('isAdfDoc recognizes ADF docs', () => {
    assert.equal(isAdfDoc({ type: 'doc', content: [] }), true);
    assert.equal(isAdfDoc('plain'), false);
    assert.equal(isAdfDoc({ body: 'x' }), false);
  });
});

describe('jira create-comment writeback emits ADF', () => {
  it('converts a markdown comment body to an ADF document', () => {
    const req = resolveJiraWritebackRequest(
      '/jira/issues/ENG-7/comments/new.json',
      JSON.stringify({ body: 'Investigating **now**' }),
    );
    assert.equal(req.action, 'create_comment');
    const body = (req.body as { body: unknown }).body as { type?: string; content?: unknown[] };
    assert.equal(body.type, 'doc');
    assert.deepStrictEqual(body.content, [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Investigating ' },
          { type: 'text', text: 'now', marks: [{ type: 'strong' }] },
        ],
      },
    ]);
  });

  it('passes an already-ADF body through unchanged', () => {
    const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
    const req = resolveJiraWritebackRequest(
      '/jira/issues/ENG-7/comments/new.json',
      JSON.stringify({ body: adf }),
    );
    assert.deepStrictEqual((req.body as { body: unknown }).body, adf);
  });
});
