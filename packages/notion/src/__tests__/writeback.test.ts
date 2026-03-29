import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWritebackRequest } from '../writeback.js';

describe('writeback rule matching', () => {
  it('maps page JSON to PATCH /v1/pages/{id}', () => {
    const request = resolveWritebackRequest(
      '/notion/databases/db-1/pages/page-1.json',
      JSON.stringify({
        properties: {
          Name: {
            id: 'title',
            type: 'title',
            value: 'Updated page title',
          },
        },
      }),
    );

    assert.deepStrictEqual(request, {
      action: 'update_page_properties',
      method: 'PATCH',
      endpoint: '/v1/pages/page-1',
      body: {
        properties: {
          Name: {
            title: [
              {
                type: 'text',
                text: { content: 'Updated page title', link: null },
                plain_text: 'Updated page title',
                href: null,
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: 'default',
                },
              },
            ],
          },
        },
        archived: undefined,
        icon: undefined,
        cover: undefined,
      },
    });
  });

  it('maps markdown and comments writeback paths', () => {
    const markdown = resolveWritebackRequest('/notion/pages/page-1/content.md', '# Updated');
    const comment = resolveWritebackRequest('/notion/pages/page-1/comments.json', '"Looks good"');

    assert.strictEqual(markdown.endpoint, '/v1/pages/page-1/markdown');
    assert.strictEqual(comment.endpoint, '/v1/comments');
    assert.deepStrictEqual(comment.body, {
      parent: { page_id: 'page-1' },
      rich_text: [{ type: 'text', text: { content: 'Looks good', link: null } }],
    });
  });
});
