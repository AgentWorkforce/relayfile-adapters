import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AuxiliaryEmitterClient,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from '@relayfile/adapter-core';

import { emitRedditAuxiliaryFiles, type RedditDeletedRecord } from './emit-auxiliary-files.js';
import {
  redditPostByIdAliasPath,
  redditPostsIndexPath,
  redditSubredditPostsIndexPath,
  redditSubredditsIndexPath,
} from './path-mapper.js';

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  files: Map<string, string>;
}

function createClient(initialFiles: Record<string, string> = {}): CapturingClient {
  const files = new Map(Object.entries(initialFiles));
  return {
    writes: [],
    deletes: [],
    files,
    async writeFile(input) {
      this.writes.push(input);
      this.files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      this.deletes.push(input);
      this.files.delete(input.path);
    },
    async readFile(input: EmitReadInput): Promise<EmitReadResult | null> {
      const content = this.files.get(input.path);
      return content === undefined ? null : { content };
    },
  };
}

test('subreddit tombstones normalize r/ prefix when deleting aliases and index rows', async () => {
  const client = createClient({
    [redditSubredditsIndexPath()]: JSON.stringify([
      {
        id: 'agentrelay',
        title: 'Agent Relay',
        updated: '2026-05-29T00:00:00.000Z',
      },
    ]),
  });

  const tombstone: RedditDeletedRecord = {
    id: 'r/AgentRelay',
    _deleted: true,
    objectType: 'subreddit',
  };

  const result = await emitRedditAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    subreddits: [tombstone],
  });

  assert.deepEqual(result.errors, []);
  assert.ok(client.deletes.some((entry) => entry.path === '/reddit/subreddits/agentrelay.json'));
  assert.ok(client.deletes.some((entry) => entry.path === '/reddit/subreddits/by-id/agentrelay.json'));

  const indexContent = client.files.get(redditSubredditsIndexPath());
  assert.ok(indexContent, 'subreddits index should be rewritten');
  assert.deepEqual(JSON.parse(indexContent), []);
});

test('post tombstones delete canonical file path resolved from by-id alias payload', async () => {
  const byIdAlias = redditPostByIdAliasPath('agentrelay', 'abc123');
  const canonical = '/reddit/subreddits/agentrelay/posts/launch-week-recap__abc123.json';
  const client = createClient({
    [byIdAlias]: JSON.stringify({ canonicalPath: canonical }),
    [redditPostsIndexPath()]: JSON.stringify([
      { id: 'agentrelay/abc123', title: 'Launch week recap', updated: '2026-05-29T00:00:00.000Z', subreddit: 'agentrelay' },
    ]),
    [redditSubredditPostsIndexPath('agentrelay')]: JSON.stringify([
      { id: 'agentrelay/abc123', title: 'Launch week recap', updated: '2026-05-29T00:00:00.000Z', subreddit: 'agentrelay' },
    ]),
  });

  const result = await emitRedditAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    posts: [{ id: 'agentrelay/abc123', _deleted: true, objectType: 'post' }],
  });

  assert.deepEqual(result.errors, []);
  assert.ok(client.deletes.some((entry) => entry.path === canonical));
  assert.ok(client.deletes.some((entry) => entry.path === byIdAlias));
});

test('post upserts do not require scoped id format', async () => {
  const client = createClient();
  const result = await emitRedditAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    posts: [
      {
        id: 'abc123',
        post_id: 'abc123',
        subreddit: 'AgentRelay',
        title: 'Hello world',
      },
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.ok(
    client.writes.some((entry) => entry.path === '/reddit/subreddits/agentrelay/posts/hello-world__abc123.json'),
  );
});
