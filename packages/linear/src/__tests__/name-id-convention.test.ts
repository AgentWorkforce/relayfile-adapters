import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import test from 'node:test';

import { getLinearCommentHumanReadable, getLinearIssueHumanReadable } from '../queries.js';
import { linearCommentPath, linearIssuePath, nameWithId, parseNameWithId } from '../path-mapper.js';

const ISSUE_ID = '50cf92f3-f53c-4ab6-bf05-ea76ebd21692';
const COMMENT_ID = '2fd6800c-1c90-80ea-9ec8-fe4a0daa66b8';

test('Linear issue paths preserve public identifiers verbatim in the human-readable segment', () => {
  const path = linearIssuePath(
    ISSUE_ID,
    getLinearIssueHumanReadable({
      identifier: 'AGE-8',
      title: 'Ship Mixed Case path handling before Friday',
    }),
  );

  assert.equal(path, `/linear/issues/AGE-8__${ISSUE_ID}.json`);
  assert.deepEqual(parseNameWithId(basename(path)), {
    humanReadable: 'AGE-8',
    id: ISSUE_ID,
    ext: 'json',
  });
});

test('Linear comment paths prefer the parent issue identifier over a body snippet', () => {
  const path = linearCommentPath(
    COMMENT_ID,
    getLinearCommentHumanReadable({
      issue: { identifier: 'AGE-8' },
      body: 'This comment body should not win over the public identifier',
    }),
  );

  assert.equal(path, `/linear/comments/AGE-8__${COMMENT_ID}.json`);
});

test('Linear naming collision suffixes are deterministic and derived from the id', () => {
  const seenNames = new Set<string>();
  const first = nameWithId('Needs Review', ISSUE_ID, { existingNames: seenNames });
  const secondId = '64b9f51c-4492-401e-b5c7-8eb2d5687a11';
  const second = nameWithId('Needs Review', secondId, { existingNames: seenNames });
  const expectedHash = createHash('sha256').update(secondId).digest('hex').slice(0, 8);

  assert.equal(first, `needs-review__${ISSUE_ID}`);
  assert.equal(second, `needs-review-${expectedHash}__${secondId}`);
});

test('Linear identifier preservation only applies to exact uppercase team-prefixed identifiers', () => {
  const named = nameWithId('age-8', ISSUE_ID);
  assert.equal(named, `age-8__${ISSUE_ID}`);
});

test('Linear drops empty or punctuation-only human-readable segments to a bare id filename', () => {
  assert.equal(nameWithId(undefined, ISSUE_ID), ISSUE_ID);
  assert.equal(nameWithId('!!!', ISSUE_ID), ISSUE_ID);
  assert.deepEqual(parseNameWithId(`${ISSUE_ID}.json`), {
    humanReadable: null,
    id: ISSUE_ID,
    ext: 'json',
  });
});
