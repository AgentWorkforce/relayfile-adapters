import { describe, expect, it, vi } from 'vitest';
import { fetchBlockChildrenRecursively, flattenBlocks } from '../content/blocks.js';
import type { NotionBlock } from '../types.js';

describe('block tree ingestion', () => {
  it('recursively fetches nested block children', async () => {
    const paginate = vi.fn(async (_method: string, endpoint: string) => {
      if (endpoint === '/v1/blocks/root/children') {
        return [block('toggle-1', 'toggle', true), block('paragraph-1', 'paragraph')];
      }
      if (endpoint === '/v1/blocks/toggle-1/children') {
        return [block('quote-1', 'quote', true)];
      }
      if (endpoint === '/v1/blocks/quote-1/children') {
        return [block('paragraph-2', 'paragraph')];
      }
      return [];
    });

    const tree = await fetchBlockChildrenRecursively({ paginate } as never, 'root');

    expect(flattenBlocks(tree).map((entry) => entry.id)).toEqual([
      'toggle-1',
      'quote-1',
      'paragraph-2',
      'paragraph-1',
    ]);
  });
});

function block(id: string, type: string, hasChildren = false): NotionBlock {
  return {
    object: 'block',
    id,
    type,
    has_children: hasChildren,
    [type]: { rich_text: [] },
  } as NotionBlock;
}
