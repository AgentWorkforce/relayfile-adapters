import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { discoverContentMetadata } from '../discovery/discover.js';

describe('content metadata discovery', () => {
  it('uses the immediate child page as parentId for deeply nested child pages', async () => {
    const paginate = mock.fn(async (_method: string, endpoint: string) => {
      if (endpoint === '/v1/search') {
        return [
          {
            object: 'page',
            id: 'page-a',
            url: 'https://notion.so/page-a',
            last_edited_time: '2026-04-01T00:00:00.000Z',
            parent: { type: 'workspace', workspace: true },
            properties: {
              Name: {
                type: 'title',
                title: [{ plain_text: 'Page A' }],
              },
            },
          },
        ];
      }

      if (endpoint === '/v1/blocks/page-a/children') {
        return [
          {
            id: 'page-b',
            type: 'child_page',
            has_children: true,
            last_edited_time: '2026-04-02T00:00:00.000Z',
            child_page: { title: 'Page B' },
          },
        ];
      }

      if (endpoint === '/v1/blocks/page-b/children') {
        return [
          {
            id: 'page-c',
            type: 'child_page',
            has_children: false,
            last_edited_time: '2026-04-03T00:00:00.000Z',
            child_page: { title: 'Page C' },
          },
        ];
      }

      return [];
    });

    const result = await discoverContentMetadata({ paginate } as never, { depth: 'metadata' });

    const pageB = result.manifest.items.find((item) => item.id === 'page-b');
    const pageC = result.manifest.items.find((item) => item.id === 'page-c');

    assert.equal(pageB?.parentId, 'page-a');
    assert.equal(pageC?.parentId, 'page-b');
  });
});
