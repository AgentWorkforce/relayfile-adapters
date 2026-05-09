import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReadOnlyFieldError, resolveDeleteRequest, resolveWritebackRequest } from '../writeback.js';

describe('writeback rule matching', () => {
  it('maps page JSON to PATCH /v1/pages/{id}', () => {
    const request = resolveWritebackRequest(
      '/notion/databases/db-1/pages/00000000-0000-0000-0000-000000000001.json',
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
      endpoint: '/v1/pages/00000000-0000-0000-0000-000000000001',
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

  it('maps the canonical <slug>__<32hex> form emitted by the notion path-mapper to PATCH', () => {
    // Pins #49: notion path-mapper now emits `<slug>__<id>` rather than the
    // legacy `<slug>--<id>`. classifyWrite + extractNotionId must accept
    // both forms so canonical paths PATCH instead of misclassifying as create.
    const request = resolveWritebackRequest(
      '/notion/databases/db-1/pages/release-notes__00000000000000000000000000000001.json',
      JSON.stringify({
        properties: {
          Name: { id: 'title', type: 'title', value: 'Renamed' },
        },
      }),
    );
    assert.strictEqual(request.action, 'update_page_properties');
    assert.strictEqual(request.method, 'PATCH');
    assert.strictEqual(request.endpoint, '/v1/pages/00000000-0000-0000-0000-000000000001');
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

  it('maps database page draft templates to page creation', () => {
    const request = resolveWritebackRequest(
      '/notion/databases/db-1/pages/draft-page.json',
      JSON.stringify({
        properties: {
          Name: {
            id: 'title',
            type: 'title',
            value: 'New page title',
          },
        },
      }),
    );

    assert.strictEqual(request.action, 'create_page');
    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(request.endpoint, '/v1/pages');
    assert.deepStrictEqual(request.body.parent, { database_id: 'db-1' });
    assert.throws(
      () => resolveWritebackRequest('/notion/databases/db-1/pages/draft-page.json', '{"id":"page-1","properties":{}}'),
      (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
    );
    assert.throws(
      () => resolveWritebackRequest('/notion/databases/db-1/pages/draft-page.json', '{}'),
      /must include a properties object/,
    );
    assert.deepStrictEqual(resolveDeleteRequest('/notion/databases/db-1/pages/00000000-0000-0000-0000-000000000001.json'), {
      action: 'delete_page',
      method: 'PATCH',
      endpoint: '/v1/pages/00000000-0000-0000-0000-000000000001',
      body: { archived: true },
    });
    assert.throws(
      () => resolveDeleteRequest('/notion/databases/db-1/pages/draft-page.json'),
      /No Notion delete writeback rule matched/,
    );
  });
});
