import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRedditRootIndexFile, redditSubredditIndexRow } from './index-emitter.js';

test('buildRedditRootIndexFile uses canonical root path', () => {
  const root = buildRedditRootIndexFile();
  assert.equal(root.path, '/reddit/_index.json');
});

test('redditSubredditIndexRow uses deterministic timestamp from created_utc when available', () => {
  const row = redditSubredditIndexRow({
    id: 'agentrelay',
    name: 'agentrelay',
    title: 'Agent Relay',
    created_utc: 1_700_000_000,
  });
  assert.equal(row.updated, '2023-11-14T22:13:20.000Z');
});

test('redditSubredditIndexRow falls back when created_utc is not finite', () => {
  const row = redditSubredditIndexRow({
    id: 'agentrelay',
    name: 'agentrelay',
    created_utc: Number.POSITIVE_INFINITY,
  });
  assert.match(row.updated, /^\d{4}-\d{2}-\d{2}T/);
});
