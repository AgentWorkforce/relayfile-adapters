import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeRedditPathFromModel,
  parseRedditPostScopedId,
  redditRootIndexPath,
} from './path-mapper.js';

test('computeRedditPathFromModel supports unscoped post ids when subreddit is provided', () => {
  const path = computeRedditPathFromModel('redditpost', 'abc123', { subreddit: 'r/AI' });
  assert.equal(path, '/reddit/subreddits/ai/posts/abc123.json');
});

test('computeRedditPathFromModel rejects unscoped post ids when subreddit is missing', () => {
  assert.throws(
    () => computeRedditPathFromModel('redditpost', 'abc123'),
    /subreddit is not provided/,
  );
});

test('parseRedditPostScopedId normalizes subreddit casing and prefix', () => {
  const scoped = parseRedditPostScopedId('AgentRelay/abc123');
  assert.deepEqual(scoped, { subreddit: 'agentrelay', postId: 'abc123' });
});

test('redditRootIndexPath is stable', () => {
  assert.equal(redditRootIndexPath(), '/reddit/_index.json');
});

test('computeRedditPathFromModel caps the slug for very long post titles so the filename stays under NAME_MAX', () => {
  const title =
    "I just don't get it, these big tech companies can illegally scrape the entire internet and " +
    'gatekeep their better models behind higher prices so it is natural that people look for ' +
    'affordable options and there will be providers who apparently distill models from them';
  const path = computeRedditPathFromModel('redditpost', 'localllama/1uvwn9q', { title });
  const filename = path.split('/').pop() ?? '';
  assert.ok(
    Buffer.byteLength(filename, 'utf8') <= 100,
    `expected filename to stay well under NAME_MAX, got ${Buffer.byteLength(filename, 'utf8')} bytes: ${filename}`,
  );
  assert.match(filename, /^[a-z0-9-]+__1uvwn9q\.json$/);
});
