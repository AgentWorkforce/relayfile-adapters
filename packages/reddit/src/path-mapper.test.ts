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
