import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWrite, executeFileNativeWriteback } from '@relayfile/adapter-core';
import type { FileNativeWritebackRequest } from '@relayfile/adapter-core';
import { resources } from '../resources.js';
import { ReadOnlyFieldError, resolveDeleteRequest, resolveWritebackRequest } from '../writeback.js';

const PAGE_ONE = '00000000-0000-0000-0000-000000000001';
const PAGE_TWO = '00000000-0000-0000-0000-000000000002';
const PAGE_THREE = '00000000-0000-0000-0000-000000000003';

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

  it('surfaces the helpful "re-sync required" error for legacy 8-hex slugged standalone paths', () => {
    // Pins a CodeRabbit Review finding: the canonical-id gate previously
    // rejected legacy <slug>(?:--|__)<8-hex> paths as drafts, dropping the
    // helpful error from extractNotionId. The gate now also recognizes the
    // legacy form so it flows into extractNotionId, which throws.
    assert.throws(
      () => resolveDeleteRequest('/notion/pages/release-notes--deadbeef.json'),
      /legacy 8-char id suffix/,
    );
    assert.throws(
      () =>
        resolveWritebackRequest(
          '/notion/pages/release-notes__deadbeef.json',
          '{"properties":{}}',
        ),
      /legacy 8-char id suffix/,
    );
  });

  it('rejects standalone-page draft delete (no canonical id) instead of archiving', () => {
    // Pins a Devin Review finding: standalone notion pages aren't declared
    // as a resource, so classifyWrite returns null and the delete resolver
    // would archive any draft path it saw. The canonical-id gate now ensures
    // only canonical UUIDs (or <slug>(?:--|__)<32hex> forms) trigger archive.
    assert.throws(
      () => resolveDeleteRequest('/notion/pages/draft-page.json'),
      /No Notion delete writeback rule matched/,
    );
    assert.throws(
      () => resolveWritebackRequest('/notion/pages/draft-page.json', '{"properties":{}}'),
      /No Notion writeback rule matched/,
    );
    assert.deepStrictEqual(
      resolveDeleteRequest('/notion/pages/00000000-0000-0000-0000-000000000001.json'),
      {
        action: 'delete_page',
        method: 'PATCH',
        endpoint: '/v1/pages/00000000-0000-0000-0000-000000000001',
        body: { archived: true },
      },
    );
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

  it('maps properties.json aliases to PATCH /v1/pages/{id}', () => {
    const content = JSON.stringify({
      properties: {
        Name: { id: 'title', type: 'title', value: 'Properties alias update' },
      },
    });

    const databasePageRequest = resolveWritebackRequest(
      '/notion/databases/db-1/pages/release-notes__00000000000000000000000000000001/properties.json',
      content,
    );
    const standalonePageRequest = resolveWritebackRequest(
      '/notion/pages/00000000-0000-0000-0000-000000000002/properties.json',
      content,
    );

    assert.strictEqual(databasePageRequest.action, 'update_page_properties');
    assert.strictEqual(databasePageRequest.method, 'PATCH');
    assert.strictEqual(databasePageRequest.endpoint, '/v1/pages/00000000-0000-0000-0000-000000000001');
    assert.deepStrictEqual(databasePageRequest.body.properties, standalonePageRequest.body.properties);
    assert.strictEqual(standalonePageRequest.action, 'update_page_properties');
    assert.strictEqual(standalonePageRequest.method, 'PATCH');
    assert.strictEqual(standalonePageRequest.endpoint, '/v1/pages/00000000-0000-0000-0000-000000000002');
    assert.throws(
      () => resolveWritebackRequest('/notion/databases/db-1/pages/draft-page/properties.json', content),
      /No Notion writeback rule matched/,
    );
    assert.throws(
      () => resolveWritebackRequest('/notion/pages/draft-page/properties.json', content),
      /No Notion writeback rule matched/,
    );
  });

  it('allows page patches that only update archive state, icon, or cover', () => {
    const archived = resolveWritebackRequest(
      `/notion/pages/${PAGE_ONE}.json`,
      JSON.stringify({ archived: true }),
    );
    const icon = resolveWritebackRequest(
      `/notion/databases/db-1/pages/${PAGE_TWO}/properties.json`,
      JSON.stringify({ icon: { type: 'emoji', emoji: ':check:' } }),
    );
    const cover = resolveWritebackRequest(
      `/notion/pages/${PAGE_THREE}/properties.json`,
      JSON.stringify({ cover: { type: 'external', external: { url: 'https://example.com/cover.png' } } }),
    );

    assert.deepStrictEqual(archived.body, {
      properties: undefined,
      archived: true,
      icon: undefined,
      cover: undefined,
    });
    assert.deepStrictEqual(icon.body, {
      properties: undefined,
      archived: undefined,
      icon: { type: 'emoji', emoji: ':check:' },
      cover: undefined,
    });
    assert.deepStrictEqual(cover.body, {
      properties: undefined,
      archived: undefined,
      icon: undefined,
      cover: { type: 'external', external: { url: 'https://example.com/cover.png' } },
    });
    assert.throws(
      () => resolveWritebackRequest(`/notion/pages/${PAGE_ONE}.json`, '{}'),
      /must include properties, archived, icon, or cover/,
    );
  });

  it('maps markdown and comments writeback paths', () => {
    const markdown = resolveWritebackRequest(`/notion/pages/${PAGE_ONE}/content.md`, '# Updated');
    const markdownObject = resolveWritebackRequest(
      `/notion/databases/db-1/pages/${PAGE_TWO}/content.md`,
      '{"markdown":"# Updated from schema-shaped content"}',
    );
    const comment = resolveWritebackRequest(`/notion/pages/${PAGE_ONE}/comments.json`, '"Looks good"');
    const markdownObjectBody = markdownObject.body as {
      replace_content: { new_str: string };
    };

    assert.strictEqual(markdown.endpoint, `/v1/pages/${PAGE_ONE}/markdown`);
    assert.deepStrictEqual(markdownObjectBody.replace_content.new_str, '# Updated from schema-shaped content');
    assert.strictEqual(comment.endpoint, '/v1/comments');
    assert.deepStrictEqual(comment.body, {
      parent: { page_id: PAGE_ONE },
      rich_text: [{ type: 'text', text: { content: 'Looks good', link: null } }],
    });
    assert.throws(
      () => resolveWritebackRequest(`/notion/pages/${PAGE_ONE}/comments.json`, '{}'),
      /expects text or richText/,
    );
    assert.throws(
      () => resolveWritebackRequest(`/notion/pages/${PAGE_ONE}/comments.json`, '""'),
      /expects a non-empty comment body/,
    );
  });

  it('rejects draft-like exact-file markdown and comments sidecars', () => {
    for (const path of [
      '/notion/pages/draft-page/content.md',
      '/notion/pages/draft-page/comments.json',
      '/notion/databases/db-1/pages/draft-page/content.md',
      '/notion/databases/db-1/pages/draft-page/comments.json',
    ]) {
      assert.equal(classifyWrite(path, resources), null, path);
      assert.throws(
        () => resolveWritebackRequest(path, path.endsWith('.md') ? '# Draft' : '"Draft"'),
        /No Notion writeback rule matched/,
        path,
      );
    }
  });

  it('executes plain markdown writes through the generic file-native router', async () => {
    const result = await executeFileNativeWriteback({
      path: `/notion/pages/${PAGE_THREE}/content.md`,
      content: '# Updated from plain markdown',
      resources,
      loadSchema(resource) {
        assert.equal(resource.schema, 'discovery/notion/pages/{pageId}/content.md/.schema.json');
        return {
          type: 'object',
          properties: {
            markdown: { type: 'string' },
          },
          additionalProperties: false,
        };
      },
      resolveWritebackRequest(path, content) {
        return resolveWritebackRequest(path, content) as unknown as FileNativeWritebackRequest;
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.route.kind, 'patch');
      assert.equal(result.request?.endpoint, `/v1/pages/${PAGE_THREE}/markdown`);
      const body = result.request?.body as { replace_content: { new_str: string } };
      assert.equal(body.replace_content.new_str, '# Updated from plain markdown');
    }
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

  it('classifies Notion exact-file resources with the generic router', () => {
    const create = classifyWrite('/notion/databases/db-1/pages/draft-page.json', resources);
    assert.equal(create?.kind, 'create');
    assert.equal(create?.resource.schema, 'discovery/notion/databases/{databaseId}/pages/.schema.json');
    assert.equal(create?.id, 'draft-page');

    const page = classifyWrite('/notion/databases/db-1/pages/00000000000000000000000000000001/meta.json', resources);
    assert.equal(page?.kind, 'patch');
    assert.equal(page?.resource.schema, 'discovery/notion/databases/{databaseId}/pages/{pageId}/meta.json/.schema.json');
    assert.equal(page?.id, '00000000000000000000000000000001');

    const properties = classifyWrite('/notion/pages/00000000000000000000000000000002/properties.json', resources);
    assert.equal(properties?.kind, 'patch');
    assert.equal(properties?.resource.schema, 'discovery/notion/pages/{pageId}/properties.json/.schema.json');
    assert.equal(properties?.id, '00000000000000000000000000000002');

    const content = classifyWrite('/notion/pages/00000000000000000000000000000002/content.md', resources);
    assert.equal(content?.kind, 'patch');
    assert.equal(content?.resource.schema, 'discovery/notion/pages/{pageId}/content.md/.schema.json');
    assert.equal(content?.id, '00000000000000000000000000000002');
  });
});
