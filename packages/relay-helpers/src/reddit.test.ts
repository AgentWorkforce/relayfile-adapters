import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { redditClient } from './reddit.js';

async function mount(): Promise<{ root: string; opts: { relayfileMountRoot: string; writebackTimeoutMs: number } }> {
  const root = await mkdtemp(path.join(tmpdir(), 'relay-helpers-reddit-'));
  return { root, opts: { relayfileMountRoot: root, writebackTimeoutMs: 0 } };
}

test('redditClient.posts.path lowercases the subreddit segment', () => {
  const reddit = redditClient();
  assert.equal(
    reddit.posts.path({ subreddit: 'LocalLLaMA' }),
    '/reddit/subreddits/localllama/posts',
  );
  assert.equal(
    reddit.posts.path({ subreddit: 'localllama' }),
    '/reddit/subreddits/localllama/posts',
  );
});

test('redditClient.posts.path strips the `r/` prefix', () => {
  const reddit = redditClient();
  assert.equal(
    reddit.posts.path({ subreddit: 'r/LocalLLaMA' }),
    '/reddit/subreddits/localllama/posts',
  );
  assert.equal(
    reddit.posts.path({ subreddit: 'R/programming' }),
    '/reddit/subreddits/programming/posts',
  );
});

test('redditClient.posts.list reads the lowercased path where records live', async () => {
  const { root, opts } = await mount();
  // The adapter's canonical write path lowercases the subreddit; a record ends
  // up under /reddit/subreddits/localllama/posts/ regardless of what case the
  // caller uses to read.
  await mkdir(path.join(root, 'reddit/subreddits/localllama/posts'), { recursive: true });
  await writeFile(
    path.join(root, 'reddit/subreddits/localllama/posts/hello-world__abc123.json'),
    JSON.stringify({ id: 'localllama/abc123', title: 'hello world', subreddit: 'localllama' }),
  );

  const reddit = redditClient(opts);
  const listed = await reddit.posts.list<{ id: string }>({ subreddit: 'LocalLLaMA' });
  assert.deepEqual(listed.map((row) => row.id), ['localllama/abc123']);
});

test('redditClient.posts.write drops a draft in the lowercased collection', async () => {
  const { root, opts } = await mount();
  const reddit = redditClient(opts);
  await reddit.posts.write({ subreddit: 'r/LocalLLaMA' }, { title: 'draft', text: 'body' });

  const dir = path.join(root, 'reddit/subreddits/localllama/posts');
  const entries = (await readdir(dir)).filter((entry) => entry.endsWith('.json'));
  assert.equal(entries.length, 1, `expected one draft in ${dir}, saw ${entries.join(', ') || 'none'}`);
  const body = JSON.parse(await readFile(path.join(dir, entries[0]), 'utf8')) as unknown;
  assert.deepEqual(body, { title: 'draft', text: 'body' });
});

test('redditClient preserves the generic subreddits resource (no params to normalize)', async () => {
  const { root, opts } = await mount();
  await mkdir(path.join(root, 'reddit/subreddits'), { recursive: true });
  await writeFile(
    path.join(root, 'reddit/subreddits/programming.json'),
    JSON.stringify({ name: 'programming' }),
  );

  const reddit = redditClient(opts);
  assert.equal(reddit.subreddits.path(), '/reddit/subreddits');
  const listed = await reddit.subreddits.list<{ name: string }>();
  assert.deepEqual(listed.map((row) => row.name), ['programming']);
});
