import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWrite } from '@relayfile/adapter-core';

import { resources } from './resources.js';
import { resolveDeleteRequest, resolveWritebackRequest } from './writeback.js';

const REPO = '/github/repos/acme/widgets';

function kinds(path: string): [string | undefined, string | undefined] {
  return [classifyWrite(path, resources)?.kind, classifyWrite(path, resources, { fsEvent: 'delete' })?.kind];
}

test('github resources declare the operations the writeback handler implements', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.name, resource.operations])),
    {
      issues: ['create', 'update'],
      'issue-comments': ['create', 'update'],
      reviews: ['create', 'update', 'delete'],
      'pull-requests': ['create'],
      refs: ['create', 'update'],
      'close-pull-request': ['update'],
      merge: ['update'],
      replies: ['create'],
    },
  );
});

test('github routes only the declared operations per resource', () => {
  assert.deepEqual(kinds(`${REPO}/issues/create request.json`), ['create', undefined]);
  assert.deepEqual(kinds(`${REPO}/issues/42.json`), ['patch', undefined]);
  assert.deepEqual(kinds(`${REPO}/issues/42/comments/create comment.json`), ['create', undefined]);
  assert.deepEqual(kinds(`${REPO}/issues/42/comments/123.json`), ['patch', undefined]);
  assert.deepEqual(kinds(`${REPO}/pulls/7/reviews/draft@review.json`), ['create', undefined]);
  assert.deepEqual(kinds(`${REPO}/pulls/7/reviews/991.json`), ['patch', 'delete']);
  assert.deepEqual(kinds(`${REPO}/pull-requests/factory.json`), ['create', undefined]);
  assert.deepEqual(kinds(`${REPO}/pull-requests/52.json`), [undefined, undefined]);
  assert.deepEqual(kinds(`${REPO}/refs/factory.json`), ['create', undefined]);
  assert.deepEqual(kinds(`${REPO}/refs/refs%2Fheads%2Fmain.json`), ['patch', undefined]);
  assert.deepEqual(kinds(`${REPO}/pulls/42/close.json`), ['patch', undefined]);
  assert.deepEqual(kinds(`${REPO}/pulls/42/merge.json`), ['patch', undefined]);
  assert.deepEqual(kinds(`${REPO}/pulls/42/review-comments/999/replies/reply-draft.json`), ['create', undefined]);
  assert.deepEqual(kinds(`${REPO}/pulls/42/review-comments/999/replies/1001.json`), [undefined, undefined]);
});

test('github review deletes still resolve', () => {
  assert.equal(resolveDeleteRequest(`${REPO}/pulls/7/reviews/991.json`).method, 'DELETE');
});

test('github review comment replies are created from drafts, not from canonical reply files', () => {
  assert.equal(
    resolveWritebackRequest(`${REPO}/pulls/42/review-comments/999/replies/reply-draft.json`, '{"body":"Thanks"}').endpoint,
    '/repos/acme/widgets/pulls/42/comments/999/replies',
  );
  // Rewriting a synced reply file must not post a duplicate reply.
  assert.throws(
    () => resolveWritebackRequest(`${REPO}/pulls/42/review-comments/999/replies/1001.json`, '{"body":"Thanks"}'),
    /Unsupported GitHub writeback path/,
  );
});
