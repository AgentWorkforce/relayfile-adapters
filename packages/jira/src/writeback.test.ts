import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveJiraWritebackRequest } from './writeback.js';

describe('jira writeback', () => {
  it('resolves issue transition create writebacks', () => {
    const request = resolveJiraWritebackRequest(
      '/jira/issues/ENG-42/transitions/start-progress.json',
      JSON.stringify({ transition: { id: '31' } }),
    );

    assert.deepStrictEqual(request, {
      action: 'transition_issue',
      method: 'POST',
      endpoint: '/rest/api/3/issue/ENG-42/transitions',
      body: { transition: { id: '31' } },
    });
  });

  it('accepts a bare transition id payload', () => {
    const request = resolveJiraWritebackRequest(
      '/jira/issues/ENG-42/transitions/create transition.json',
      '" 41 "',
    );

    assert.deepStrictEqual(request.body, { transition: { id: '41' } });
  });

  it('rejects missing transition ids', () => {
    assert.throws(
      () =>
        resolveJiraWritebackRequest(
          '/jira/issues/ENG-42/transitions/create transition.json',
          JSON.stringify({ transition: {} }),
        ),
      /transition\.id/,
    );
  });
});
