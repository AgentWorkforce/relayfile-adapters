import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { NotionAdapter } from '../adapter.js';

const PAGE_ID = '2fd6800c-1c90-80ea-9ec8-fe4a0daa66b8';

describe('NotionAdapter sync cursor handling', () => {
  it('keeps the prior cursor when a primary file write fails', async () => {
    const priorCursor = '2026-03-01T00:00:00.000Z';
    const changedAt = '2026-03-02T00:00:00.000Z';
    const adapter = new NotionAdapter(failingRelayClient() as never, undefined, {
      pageIds: [PAGE_ID],
      enableMarkdown: false,
      fetchBlockJson: false,
      fetchComments: false,
    });
    adapter.api.paginate = mock.fn(async () => [page(PAGE_ID, changedAt)]) as never;

    const result = await adapter.sync('ws-notion', { cursor: priorCursor });

    assert.equal(result.nextCursor, priorCursor);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /primary write failed/);
  });
});

function failingRelayClient() {
  return {
    async readFile() {
      throw new Error('missing');
    },
    async writeFile(input: { path: string }) {
      if (input.path.endsWith('/meta.json')) {
        throw new Error('primary write failed');
      }
      return { id: input.path, status: 'queued' as const };
    },
  };
}

function page(id: string, lastEditedTime: string) {
  return {
    object: 'page',
    id,
    created_time: '2026-03-01T00:00:00.000Z',
    last_edited_time: lastEditedTime,
    archived: false,
    in_trash: false,
    url: `https://notion.so/${id.replace(/-/g, '')}`,
    parent: { type: 'workspace', workspace: true },
    properties: {
      Name: {
        id: 'title',
        type: 'title',
        title: [
          {
            type: 'text',
            plain_text: 'Landing',
            text: { content: 'Landing', link: null },
            annotations: {},
            href: null,
          },
        ],
      },
    },
  };
}
