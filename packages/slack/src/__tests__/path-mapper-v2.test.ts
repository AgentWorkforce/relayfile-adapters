import assert from 'node:assert/strict';
import test from 'node:test';

import {
  channelMetadataPath,
  channelMessagesDirectory,
  messageLegacyPath,
  messagePath,
  slackBotsAliasPath,
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

test('messagePath emits <ts>__<slug>/meta.json with first ~40 chars of text', () => {
  assert.equal(
    messagePath('C0ADE9B71CN', '1711111111.000100', 'Hello team — first message of the day!'),
    '/slack/channels/C0ADE9B71CN/messages/1711111111_000100__hello-team-first-message-of-the-day/meta.json',
  );
});

test('messagePath truncates very long message text at a word boundary', () => {
  const longText = 'this is a relatively long message that should be truncated to keep the directory segment readable';
  const path = messagePath('C0ADE9B71CN', '1711111111.000100', longText);
  // segment should be `<ts>__<slug>` where slug is <= 40 chars and ends on a word boundary.
  const segment = path.split('/').at(-2)!;
  const [tsToken, slug] = segment.split('__');
  assert.equal(tsToken, '1711111111_000100');
  assert.ok(slug && slug.length > 0 && slug.length <= 40);
  assert.ok(!slug.endsWith('-'));
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
    '/slack/channels/C0ADE9B71CN__general/messages/1711111111_000100__hi/meta.json',
  );
});

test('channelMessagesDirectory uses the v2 channel segment', () => {
  assert.equal(
    channelMessagesDirectory('C0ADE9B71CN', 'general'),
    '/slack/channels/C0ADE9B71CN__general/messages',
  );
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
    '/slack/channels/C0ADE9B71CN__general/messages/1711111111_000100__hello-world/meta.json',
  );
  assert.ok(candidates[1]!.endsWith('/message.json'));
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
