import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computePath,
  joinPath,
  makeObjectId,
  normalizeGraphResource,
  normalizeSegment,
  parseObjectId,
  parseResourceUrl,
  parseTeamsPath,
} from '../src/path-mapper.ts';
import type { TeamsObjectType } from '../src/types.ts';

describe('normalizeSegment', () => {
  it('replaces unsafe filesystem characters with underscores', () => {
    assert.strictEqual(normalizeSegment('  thumbs up! '), 'thumbs_up_');
    assert.strictEqual(normalizeSegment('a/b\\c:d'), 'a_b_c_d');
    assert.strictEqual(normalizeSegment('safe-1.2_3'), 'safe-1.2_3');
  });
});

describe('joinPath', () => {
  it('joins segments and collapses duplicate slashes', () => {
    assert.strictEqual(joinPath('/teams', 'team-1', 'metadata.json'), '/teams/team-1/metadata.json');
    assert.strictEqual(joinPath('/teams/', '/team-1/'), '/teams/team-1/');
  });
});

describe('normalizeGraphResource', () => {
  it('strips Graph API version prefixes from absolute URLs', () => {
    assert.strictEqual(
      normalizeGraphResource('https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1'),
      '/teams/team-1/channels/channel-1',
    );
    assert.strictEqual(
      normalizeGraphResource('https://graph.microsoft.com/beta/chats/chat-1'),
      '/chats/chat-1',
    );
  });

  it('normalizes relative resources, query strings, and trailing slashes', () => {
    assert.strictEqual(normalizeGraphResource('/v1.0/teams/team-1?$select=id'), '/teams/team-1');
    assert.strictEqual(normalizeGraphResource('/teams/team-1/'), '/teams/team-1');
    assert.strictEqual(normalizeGraphResource('teams/team-1'), '/teams/team-1');
  });
});

describe('makeObjectId / parseObjectId round trips', () => {
  const cases: Array<{ objectType: TeamsObjectType; parts: Record<string, string> }> = [
    { objectType: 'team', parts: { teamId: 'team-1' } },
    { objectType: 'channel', parts: { teamId: 'team-1', channelId: 'channel-1' } },
    { objectType: 'message', parts: { teamId: 'team-1', channelId: 'channel-1', messageId: 'msg-1' } },
    {
      objectType: 'reply',
      parts: { teamId: 'team-1', channelId: 'channel-1', messageId: 'msg-1', replyId: 'reply-1' },
    },
    { objectType: 'tab', parts: { teamId: 'team-1', channelId: 'channel-1', tabId: 'tab-1' } },
    { objectType: 'member', parts: { teamId: 'team-1', userId: 'user-1' } },
    { objectType: 'chat', parts: { chatId: 'chat-1' } },
    { objectType: 'chat_message', parts: { chatId: 'chat-1', messageId: 'msg-1' } },
    {
      objectType: 'reaction',
      parts: {
        teamId: 'team-1',
        channelId: 'channel-1',
        messageId: 'msg-1',
        reactionType: 'like',
        userId: 'user-1',
      },
    },
  ];

  for (const { objectType, parts } of cases) {
    it(`round-trips ${objectType} object ids`, () => {
      const objectId = makeObjectId(objectType, parts);
      assert.deepStrictEqual(parseObjectId(objectType, objectId), parts);
    });
  }

  it('rejects unsupported object types', () => {
    assert.throws(() => makeObjectId('nope' as TeamsObjectType, {}), /Unsupported Teams object type/);
    assert.throws(() => parseObjectId('nope' as TeamsObjectType, 'id'), /Unsupported Teams object type/);
  });

  it('rejects missing required object id segments instead of emitting empty path segments', () => {
    assert.throws(() => makeObjectId('message', { teamId: 'team-1', channelId: 'channel-1' }), /Missing messageId/);
    assert.throws(() => parseObjectId('reply', 'team-1:channel-1:msg-1'), /missing replyId/);
  });
});

describe('computePath / parseTeamsPath round trips', () => {
  it('round-trips every object type through its VFS path', () => {
    const ids: Array<[TeamsObjectType, string]> = [
      ['team', 'team-1'],
      ['channel', 'team-1:channel-1'],
      ['message', 'team-1:channel-1:msg-1'],
      ['reply', 'team-1:channel-1:msg-1:reply-1'],
      ['tab', 'team-1:channel-1:tab-1'],
      ['member', 'team-1:user-1'],
      ['chat', 'chat-1'],
      ['chat_message', 'chat-1:msg-1'],
      ['reaction', 'team-1:channel-1:msg-1:like:user-1'],
    ];

    for (const [objectType, objectId] of ids) {
      const path = computePath(objectType, objectId);
      const parsed = parseTeamsPath(path);
      assert.ok(parsed, `expected ${path} to parse`);
      assert.strictEqual(parsed.objectType, objectType);
      assert.strictEqual(makeObjectId(objectType, parsed.parts), objectId);
    }
  });

  it('supports a custom mount root for computePath', () => {
    assert.strictEqual(
      computePath('message', 'team-1:channel-1:msg-1', '/custom'),
      '/custom/team-1/channels/channel-1/messages/msg-1.json',
    );
  });

  it('rejects incomplete object ids before computing canonical paths', () => {
    assert.throws(() => computePath('channel', 'team-1'), /missing channelId/);
    assert.throws(() => computePath('chat_message', 'chat-1:'), /missing messageId/);
  });

  it('parses reaction paths into reaction type and user', () => {
    assert.deepStrictEqual(
      parseTeamsPath('/teams/team-1/channels/channel-1/messages/msg-1/reactions/like--user-1.json'),
      {
        objectType: 'reaction',
        parts: {
          teamId: 'team-1',
          channelId: 'channel-1',
          messageId: 'msg-1',
          reactionType: 'like',
          userId: 'user-1',
        },
      },
    );
  });

  it('returns null for paths outside the Teams layout', () => {
    assert.strictEqual(parseTeamsPath('/slack/T1/channels/C1.json'), null);
    assert.strictEqual(parseTeamsPath('/teams/team-1/unknown/file.json'), null);
  });
});

describe('parseResourceUrl', () => {
  it('parses absolute Graph URLs', () => {
    assert.deepStrictEqual(
      parseResourceUrl('https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/msg-1'),
      {
        objectType: 'message',
        parts: { teamId: 'team-1', channelId: 'channel-1', messageId: 'msg-1' },
      },
    );
  });

  it('parses channel, member, team, chat, and chat message resources', () => {
    assert.deepStrictEqual(parseResourceUrl('/teams/team-1/channels/channel-1'), {
      objectType: 'channel',
      parts: { teamId: 'team-1', channelId: 'channel-1' },
    });
    assert.deepStrictEqual(parseResourceUrl('/teams/team-1/members/member-1'), {
      objectType: 'member',
      parts: { teamId: 'team-1', userId: 'member-1' },
    });
    assert.deepStrictEqual(parseResourceUrl('/teams/team-1'), {
      objectType: 'team',
      parts: { teamId: 'team-1' },
    });
    assert.deepStrictEqual(parseResourceUrl('/chats/chat-1'), {
      objectType: 'chat',
      parts: { chatId: 'chat-1' },
    });
    assert.deepStrictEqual(parseResourceUrl('/chats/chat-1/messages/msg-1'), {
      objectType: 'chat_message',
      parts: { chatId: 'chat-1', messageId: 'msg-1' },
    });
  });

  it('parses tab resources', () => {
    assert.deepStrictEqual(parseResourceUrl('/teams/team-1/channels/channel-1/tabs/tab-1'), {
      objectType: 'tab',
      parts: { teamId: 'team-1', channelId: 'channel-1', tabId: 'tab-1' },
    });
  });

  it('returns null for unrecognized resources', () => {
    assert.strictEqual(parseResourceUrl('/users/user-1'), null);
    assert.strictEqual(parseResourceUrl('/teams/team-1/apps/app-1'), null);
  });
});
