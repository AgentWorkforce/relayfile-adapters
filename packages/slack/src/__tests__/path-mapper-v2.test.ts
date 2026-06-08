import assert from 'node:assert/strict';
import test from 'node:test';

import {
  channelMetadataPath,
  channelMessagesDirectory,
  directMessageDirectory,
  directMessagePath,
  directMessageThreadReplyPath,
  messageLegacyPath,
  messagePath,
  parseSlackDirectMessagePath,
  parseSlackDirectMessageThreadReplyPath,
  reactionPath,
  slackBotsAliasPath,
  slackThreadReplyReadCandidatePaths,
  threadReplyLegacyPath,
  threadReplyPath,
  slackByNameChannelAliasPath,
  slackByNameUserAliasPath,
  slackChannelsIndexPath,
  slackMessageReadCandidatePaths,
  slackNameWithId,
  slackRootIndexPath,
  slackUsersIndexPath,
  userMetadataPath,
} from '../path-mapper.js';

test('slackNameWithId composes <id>__<slug>', () => {
  assert.equal(slackNameWithId('General', 'C0ADE9B71CN'), 'C0ADE9B71CN__general');
  assert.equal(slackNameWithId('Customer Success', 'C01ABC1234'), 'C01ABC1234__customer-success');
});

test('slackNameWithId falls back to bare id when name is empty', () => {
  assert.equal(slackNameWithId(undefined, 'C0ADE9B71CN'), 'C0ADE9B71CN');
  assert.equal(slackNameWithId('', 'C0ADE9B71CN'), 'C0ADE9B71CN');
});

test('slackNameWithId returns bare id when the name is just the id fallback', () => {
  // Regression: upstream channel-name resolution sometimes falls back to the
  // channel id itself; that must not mint a duplicate `<ID>__<lowercased-id>`
  // tree (observed live as C0AD7UU0J1G__c0ad7uu0j1g).
  assert.equal(slackNameWithId('c0ad7uu0j1g', 'C0AD7UU0J1G'), 'C0AD7UU0J1G');
  assert.equal(slackNameWithId('C0AD7UU0J1G', 'C0AD7UU0J1G'), 'C0AD7UU0J1G');
  assert.equal(slackNameWithId(' C0AD7UU0J1G ', 'C0AD7UU0J1G'), 'C0AD7UU0J1G');
});

test('channelMetadataPath ignores an id-fallback channel name', () => {
  assert.equal(
    channelMetadataPath('C0AD7UU0J1G', 'c0ad7uu0j1g'),
    '/slack/channels/C0AD7UU0J1G/meta.json',
  );
});

test('channelMetadataPath uses <id>__<slug> with channel name', () => {
  assert.equal(
    channelMetadataPath('C0ADE9B71CN', 'general'),
    '/slack/channels/C0ADE9B71CN__general/meta.json',
  );
});

test('channelMetadataPath falls back to bare id when no name is given', () => {
  // Matches the live state observed on workspace `rw_517d60b6` prior to v2.
  assert.equal(channelMetadataPath('C0ADE9B71CN'), '/slack/channels/C0ADE9B71CN/meta.json');
});

test('userMetadataPath uses <id>__<slug> with display name', () => {
  assert.equal(
    userMetadataPath('U0123ABCDEF', 'Sam Carter'),
    '/slack/users/U0123ABCDEF__sam-carter/meta.json',
  );
  assert.equal(userMetadataPath('U0123ABCDEF'), '/slack/users/U0123ABCDEF/meta.json');
});

test('messagePath emits stable <ts>/meta.json even when text is provided', () => {
  assert.equal(
    messagePath('C0ADE9B71CN', '1711111111.000100', 'Hello team — first message of the day!'),
    '/slack/channels/C0ADE9B71CN/messages/1711111111_000100/meta.json',
  );
});

test('messagePath remains stable when message text changes', () => {
  assert.equal(
    messagePath('C0ADE9B71CN', '1711111111.000100', 'original text'),
    messagePath('C0ADE9B71CN', '1711111111.000100', 'edited text'),
  );
});

test('messagePath bare-ts when no text is provided', () => {
  // file uploads / deleted messages have no text — fall back to a bare ts dir.
  assert.equal(
    messagePath('C0ADE9B71CN', '1711111111.000100'),
    '/slack/channels/C0ADE9B71CN/messages/1711111111_000100/meta.json',
  );
});

test('messagePath includes channel slug when channel name is provided', () => {
  assert.equal(
    messagePath('C0ADE9B71CN', '1711111111.000100', 'hi', 'general'),
    '/slack/channels/C0ADE9B71CN__general/messages/1711111111_000100/meta.json',
  );
});

test('channelMessagesDirectory uses the v2 channel segment', () => {
  assert.equal(
    channelMessagesDirectory('C0ADE9B71CN', 'general'),
    '/slack/channels/C0ADE9B71CN__general/messages',
  );
});

test('direct message paths use bare user id message roots', () => {
  assert.equal(directMessageDirectory('U0123ABCDEF'), '/slack/users/U0123ABCDEF/messages');
  assert.equal(
    directMessagePath('U0123ABCDEF', '1711111111.000100'),
    '/slack/users/U0123ABCDEF/messages/1711111111_000100/meta.json',
  );
  assert.equal(
    directMessageThreadReplyPath('U0123ABCDEF', '1711111111.000100', '1711111222.000200'),
    '/slack/users/U0123ABCDEF/messages/1711111111_000100/replies/1711111222_000200.json',
  );
  assert.deepEqual(
    parseSlackDirectMessagePath(directMessagePath('U0123ABCDEF', '1711111111.000100')),
    {
      userId: 'U0123ABCDEF',
      messageTs: '1711111111.000100',
    },
  );
  assert.deepEqual(
    parseSlackDirectMessageThreadReplyPath(
      directMessageThreadReplyPath('U0123ABCDEF', '1711111111.000100', '1711111222.000200'),
    ),
    {
      userId: 'U0123ABCDEF',
      messageTs: '1711111111.000100',
      replyTs: '1711111222.000200',
    },
  );
  assert.equal(parseSlackDirectMessagePath('/slack/channels/D123/messages/1711111111_000100/meta.json'), null);
});

test('messageLegacyPath continues to emit `<slug>--<id>` and `message.json`', () => {
  // This is the v0.2.2 shape — kept only for reader back-compat.
  assert.equal(
    messageLegacyPath('C0ADE9B71CN', '1711111111.000100', undefined, 'general'),
    '/slack/channels/general--C0ADE9B71CN/messages/1711111111_000100/message.json',
  );
});

test('slackMessageReadCandidatePaths returns [v2, legacy] in order', () => {
  const candidates = slackMessageReadCandidatePaths(
    'C0ADE9B71CN',
    '1711111111.000100',
    'hello world',
    'general',
  );
  assert.equal(candidates.length, 2);
  assert.equal(
    candidates[0],
    '/slack/channels/C0ADE9B71CN__general/messages/1711111111_000100/meta.json',
  );
  assert.equal(
    candidates[1],
    '/slack/channels/general--C0ADE9B71CN/messages/1711111111_000100/message.json',
  );
});

test('index path helpers point at canonical _index.json locations', () => {
  assert.equal(slackRootIndexPath(), '/slack/_index.json');
  assert.equal(slackChannelsIndexPath(), '/slack/channels/_index.json');
  assert.equal(slackUsersIndexPath(), '/slack/users/_index.json');
});

test('slackByNameChannelAliasPath emits /slack/channels/by-name/<slug>.json', () => {
  assert.equal(
    slackByNameChannelAliasPath('general', 'C0ADE9B71CN'),
    '/slack/channels/by-name/general.json',
  );
});

test('slackByNameChannelAliasPath disambiguates colliding slugs with a short hash', () => {
  const a = slackByNameChannelAliasPath('general', 'C01ABC1234', true);
  const b = slackByNameChannelAliasPath('general', 'C0XYZ5678', true);
  // Same base slug, different hash suffix.
  assert.ok(a.startsWith('/slack/channels/by-name/general-'));
  assert.ok(b.startsWith('/slack/channels/by-name/general-'));
  assert.notEqual(a, b);
});

test('slackByNameUserAliasPath emits /slack/users/by-name/<slug>.json', () => {
  assert.equal(
    slackByNameUserAliasPath('Sam Carter', 'U0123ABCDEF'),
    '/slack/users/by-name/sam-carter.json',
  );
});

test('slackByNameUserAliasPath handles colliding display names deterministically', () => {
  // Two different users named "Sam" — both should slug to a unique filename
  // when emitted with `colliding=true`.
  const a = slackByNameUserAliasPath('Sam', 'U001');
  const b = slackByNameUserAliasPath('Sam', 'U002');
  assert.equal(a, b, 'without colliding flag the helper returns the same slug filename');

  const aWithSuffix = slackByNameUserAliasPath('Sam', 'U001', true);
  const bWithSuffix = slackByNameUserAliasPath('Sam', 'U002', true);
  assert.notEqual(aWithSuffix, bWithSuffix);
  assert.ok(aWithSuffix.startsWith('/slack/users/by-name/sam-'));
  assert.ok(bWithSuffix.startsWith('/slack/users/by-name/sam-'));
});

test('slackBotsAliasPath emits /slack/users/bots/<id>__<slug>.json', () => {
  assert.equal(
    slackBotsAliasPath('B0123BOT', 'relayfile-bot'),
    '/slack/users/bots/B0123BOT__relayfile-bot.json',
  );
});

test('slackBotsAliasPath falls back to bare id when no name is given', () => {
  assert.equal(slackBotsAliasPath('B0123BOT'), '/slack/users/bots/B0123BOT.json');
});

test('threadReplyPath is a directory record and does not collide with its reaction children', () => {
  const channelId = 'C123';
  const threadTs = '1711111111.000100';
  const replyTs = '1711111222.000200';

  const reply = threadReplyPath(channelId, threadTs, replyTs);
  assert.equal(
    reply,
    '/slack/channels/C123/threads/1711111111_000100/replies/1711111222_000200/meta.json',
  );

  // The reply's children (reactions) must nest UNDER the reply's directory —
  // never as a sibling that shares the reply's name with a different node type.
  // This is the invariant whose violation wedged the mount: a flat leaf file
  // `replies/<ts>.json` could not coexist with the `replies/<ts>/` directory.
  const replyDir = reply.replace(/\/meta\.json$/u, '');
  const reaction = reactionPath({
    targetType: 'thread_reply',
    channelId,
    threadTs,
    replyTs,
    reaction: 'tada',
    userId: 'U1',
  });
  assert.equal(
    reaction,
    `${replyDir}/reactions/tada--U1.json`,
  );
  assert.ok(
    reaction.startsWith(`${replyDir}/`),
    'reaction must nest under the reply directory',
  );
  assert.ok(
    !reaction.startsWith(`${replyDir}.json`),
    'reply stem must be a directory, not a flat .json file',
  );

  // Back-compat: readers can still resolve a reply mirrored by a pre-0.8.x
  // adapter at the legacy flat path.
  assert.deepEqual(slackThreadReplyReadCandidatePaths(channelId, threadTs, replyTs), [
    reply,
    threadReplyLegacyPath(channelId, threadTs, replyTs),
  ]);
  assert.equal(
    threadReplyLegacyPath(channelId, threadTs, replyTs),
    '/slack/channels/C123/threads/1711111111_000100/replies/1711111222_000200.json',
  );
});
