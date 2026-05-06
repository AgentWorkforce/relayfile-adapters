import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWritebackRequest } from '../writeback.js';

const PAGE_UUID = '2fd6800c-1c90-80ea-9ec8-fe4a0daa66b8';
const PAGE_HEX = PAGE_UUID.replace(/-/g, '');

describe('notion writeback id extraction', () => {
  it('reverses slug--<32hex> to canonical UUID for content.md updates', () => {
    const req = resolveWritebackRequest(
      `/notion/databases/db-1/pages/superhuman-application--${PAGE_HEX}/content.md`,
      '# Body',
    );
    assert.strictEqual(req.endpoint, `/v1/pages/${PAGE_UUID}/markdown`);
  });

  it('reverses slug--<32hex> for standalone-page content.md updates', () => {
    const req = resolveWritebackRequest(
      `/notion/pages/landing--${PAGE_HEX}/content.md`,
      '# Body',
    );
    assert.strictEqual(req.endpoint, `/v1/pages/${PAGE_UUID}/markdown`);
  });

  it('reverses slug--<32hex> for comments writeback', () => {
    const req = resolveWritebackRequest(
      `/notion/databases/db-1/pages/landing--${PAGE_HEX}/comments.json`,
      '"hello"',
    );
    assert.deepStrictEqual(
      (req.body as { parent: { page_id: string } }).parent,
      { page_id: PAGE_UUID },
    );
  });

  it('reverses slug--<32hex> for properties (page.json) writeback', () => {
    const req = resolveWritebackRequest(
      `/notion/databases/db-1/pages/landing--${PAGE_HEX}.json`,
      JSON.stringify({
        properties: {
          Name: { id: 'title', type: 'title', value: 'New' },
        },
      }),
    );
    assert.strictEqual(req.endpoint, `/v1/pages/${PAGE_UUID}`);
  });

  it('rejects legacy 8-char id suffix paths with a clear re-sync message', () => {
    assert.throws(
      () =>
        resolveWritebackRequest(
          '/notion/databases/db-1/pages/superhuman-application--2fd6800c/content.md',
          '# Body',
        ),
      /legacy 8-char id suffix.*relayfile pull/,
    );
  });

  it('passes synthetic ids (used in fixture tests) straight through', () => {
    // `page-1` is not UUID-shaped; the API will validate. This preserves
    // backwards-compatibility with the existing writeback test suite.
    const req = resolveWritebackRequest(
      '/notion/pages/page-1/content.md',
      '# Body',
    );
    assert.strictEqual(req.endpoint, '/v1/pages/page-1/markdown');
  });
});
