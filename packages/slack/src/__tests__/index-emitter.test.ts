import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSlackBotsAliasFile,
  buildSlackChannelByNameAliasFile,
  buildSlackChannelsIndexFile,
  buildSlackRootIndexFile,
  buildSlackUserByNameAliasFile,
  buildSlackUsersIndexFile,
} from '../index-emitter.js';

test('buildSlackRootIndexFile defaults to channels + users roots', () => {
  const file = buildSlackRootIndexFile();
  assert.equal(file.path, '/slack/_index.json');
  assert.equal(file.contentType, 'application/json; charset=utf-8');
  const parsed = JSON.parse(file.content) as Array<{ name: string; path: string }>;
  assert.deepEqual(parsed, [
    { name: 'channels', path: '/slack/channels' },
    { name: 'users', path: '/slack/users' },
  ]);
});

test('buildSlackChannelsIndexFile produces canonical row shape sorted newest-first', () => {
  const file = buildSlackChannelsIndexFile([
    { id: 'C001', title: 'general', updated: '2026-05-10T00:00:00Z' },
    { id: 'C002', title: 'random', updated: '2026-05-12T00:00:00Z' },
  ]);
  assert.equal(file.path, '/slack/channels/_index.json');
  const parsed = JSON.parse(file.content) as Array<{ id: string; title: string; updated: string }>;
  assert.deepEqual(parsed.map((row) => row.id), ['C002', 'C001']);
});

test('buildSlackUsersIndexFile preserves is_bot per row', () => {
  const file = buildSlackUsersIndexFile([
    { id: 'U001', title: 'Sam', updated: '2026-05-12T00:00:00Z', is_bot: false },
    { id: 'B001', title: 'Relayfile bot', updated: '2026-05-12T00:00:00Z', is_bot: true },
  ]);
  assert.equal(file.path, '/slack/users/_index.json');
  const parsed = JSON.parse(file.content) as Array<{ id: string; is_bot: boolean }>;
  assert.equal(parsed.length, 2);
  // jq '.[] | select(.is_bot|not)' should yield only the human user.
  const humans = parsed.filter((row) => !row.is_bot);
  const bots = parsed.filter((row) => row.is_bot);
  assert.deepEqual(humans.map((row) => row.id), ['U001']);
  assert.deepEqual(bots.map((row) => row.id), ['B001']);
});

test('buildSlackChannelByNameAliasFile writes to /slack/channels/by-name/<slug>.json', () => {
  const file = buildSlackChannelByNameAliasFile({
    id: 'C001',
    name: 'general',
    path: '/slack/channels/C001__general/meta.json',
  });
  assert.equal(file.path, '/slack/channels/by-name/general.json');
  const parsed = JSON.parse(file.content) as { id: string; name: string; path: string };
  assert.equal(parsed.id, 'C001');
  assert.equal(parsed.path, '/slack/channels/C001__general/meta.json');
});

test('buildSlackChannelByNameAliasFile disambiguates with a collision suffix', () => {
  const a = buildSlackChannelByNameAliasFile(
    { id: 'C001', name: 'general', path: '/slack/channels/C001__general/meta.json' },
    true,
  );
  const b = buildSlackChannelByNameAliasFile(
    { id: 'C002', name: 'general', path: '/slack/channels/C002__general/meta.json' },
    true,
  );
  assert.notEqual(a.path, b.path);
  assert.ok(a.path.startsWith('/slack/channels/by-name/general-'));
  assert.ok(b.path.startsWith('/slack/channels/by-name/general-'));
});

test('buildSlackUserByNameAliasFile carries is_bot through the pointer', () => {
  const file = buildSlackUserByNameAliasFile({
    id: 'B001',
    name: 'Relayfile bot',
    is_bot: true,
    path: '/slack/users/B001__relayfile-bot/meta.json',
  });
  assert.equal(file.path, '/slack/users/by-name/relayfile-bot.json');
  const parsed = JSON.parse(file.content) as { id: string; is_bot: boolean };
  assert.equal(parsed.is_bot, true);
});

test('buildSlackBotsAliasFile writes to /slack/users/bots/<id>__<slug>.json', () => {
  const file = buildSlackBotsAliasFile({
    id: 'B001',
    name: 'Relayfile bot',
    is_bot: true,
    path: '/slack/users/B001__relayfile-bot/meta.json',
  });
  assert.equal(file.path, '/slack/users/bots/B001__relayfile-bot.json');
  const parsed = JSON.parse(file.content) as { is_bot: boolean; path: string };
  assert.equal(parsed.is_bot, true);
  assert.equal(parsed.path, '/slack/users/B001__relayfile-bot/meta.json');
});

test('buildSlackBotsAliasFile rejects non-bot pointers', () => {
  assert.throws(
    () =>
      buildSlackBotsAliasFile({
        id: 'U001',
        name: 'Human User',
        is_bot: false,
        path: '/slack/users/U001__human-user/meta.json',
      }),
    /requires pointer\.is_bot=true/,
  );
});
