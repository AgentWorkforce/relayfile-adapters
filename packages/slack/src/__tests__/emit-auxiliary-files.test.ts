import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emitSlackAuxiliaryFiles } from '../emit-auxiliary-files.js';
import {
  channelMetadataPath,
  messagePath,
  slackBotsAliasPath,
  slackByNameChannelAliasPath,
  slackByNameUserAliasPath,
  slackChannelsIndexPath,
  slackRootIndexPath,
  slackUsersIndexPath,
  threadPath,
  threadReplyPath,
  userMetadataPath,
} from '../path-mapper.js';

interface CapturingClient {
  writes: Array<{ path: string; content: string; contentType?: string }>;
  deletes: Array<{ path: string }>;
  reads: Array<{ path: string }>;
  files: Map<string, string>;
  writeFile: (input: { workspaceId: string; path: string; content: string; contentType?: string }) => Promise<{ created?: boolean } | void>;
  deleteFile?: (input: { workspaceId: string; path: string }) => Promise<void> | void;
  readFile?: (input: { workspaceId: string; path: string }) => Promise<{ content: string } | null>;
}

function createClient(options: {
  initialFiles?: Record<string, string>;
  failWriteOn?: ReadonlySet<string>;
  noRead?: boolean;
} = {}): CapturingClient {
  const files = new Map<string, string>(Object.entries(options.initialFiles ?? {}));
  const writes: CapturingClient['writes'] = [];
  const deletes: CapturingClient['deletes'] = [];
  const reads: CapturingClient['reads'] = [];
  const failWriteOn = options.failWriteOn ?? new Set<string>();

  const client: CapturingClient = {
    writes,
    deletes,
    reads,
    files,
    async writeFile(input) {
      const entry: { path: string; content: string; contentType?: string } = {
        path: input.path,
        content: input.content,
      };
      if (input.contentType !== undefined) entry.contentType = input.contentType;
      writes.push(entry);
      if (failWriteOn.has(input.path)) {
        throw new Error(`forced write failure at ${input.path}`);
      }
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      deletes.push({ path: input.path });
      files.delete(input.path);
    },
  };

  if (!options.noRead) {
    client.readFile = async (input) => {
      reads.push({ path: input.path });
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    };
  }

  return client;
}

describe('emitSlackAuxiliaryFiles', () => {
  it('writes the root index and returns zero per-resource counts on empty input', async () => {
    const client = createClient();
    const result = await emitSlackAuxiliaryFiles(client, { workspaceId: 'ws-1' });
    // Root index is always written → written: 1.
    assert.equal(result.written, 1);
    assert.equal(result.deleted, 0);
    assert.deepEqual(result.errors, []);
    assert.ok(client.files.has(slackRootIndexPath()), 'root index always emitted');
  });

  it('writes the root index even for a message-only batch', async () => {
    // Regression for cloud#546 review finding: the root index used to be
    // gated behind the channel/user write branch.
    const client = createClient();
    const result = await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      messages: [{ channelId: 'C001', ts: '1715500000.000100', text: 'hello' }],
    });
    assert.deepEqual(result.errors, []);
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(slackRootIndexPath()), 'root index emitted for message-only batch');
    assert.ok(writtenPaths.includes(messagePath('C001', '1715500000.000100')));
  });

  it('emits canonical + by-name alias + index row for a channel', async () => {
    const client = createClient();
    const result = await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [{ id: 'C001', name: 'general', updated: '2026-05-12T00:00:00Z' }],
    });

    assert.deepEqual(result.errors, []);
    const written = client.writes.map((w) => w.path);
    assert.ok(written.includes(channelMetadataPath('C001', 'general')));
    assert.ok(written.includes(slackByNameChannelAliasPath('general', 'C001')));
    assert.ok(written.includes(slackChannelsIndexPath()));

    const indexBytes = client.files.get(slackChannelsIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{ id: string; title: string; updated: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'C001');
    assert.equal(rows[0]!.title, 'general');
    assert.equal(rows[0]!.updated, '2026-05-12T00:00:00Z');
  });

  it('emits canonical + by-name alias + index row for a user', async () => {
    const client = createClient();
    const result = await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [
        {
          id: 'U001',
          name: 'sam',
          real_name: 'Sam Smith',
          profile: { display_name: 'Sam Smith' },
          updated: '2026-05-12T00:00:00Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    const written = client.writes.map((w) => w.path);
    assert.ok(written.includes(userMetadataPath('U001', 'sam')));
    assert.ok(written.includes(slackByNameUserAliasPath('sam', 'U001')));
    assert.ok(written.includes(slackUsersIndexPath()));

    const rows = JSON.parse(client.files.get(slackUsersIndexPath())!) as Array<{
      id: string;
      title: string;
      name: string;
      updated: string;
      is_bot: boolean;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'U001');
    assert.equal(rows[0]!.name, 'sam', 'handle persisted on index row');
    assert.equal(rows[0]!.title, 'Sam Smith');
    assert.equal(rows[0]!.is_bot, false);
  });

  it('emits the bots alias for is_bot=true users', async () => {
    const client = createClient();
    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [
        { id: 'B001', name: 'relayfile-bot', is_bot: true, updated: '2026-05-12T00:00:00Z' },
      ],
    });
    const written = client.writes.map((w) => w.path);
    assert.ok(written.includes(slackBotsAliasPath('B001', 'relayfile-bot')));
    assert.ok(written.includes(slackByNameUserAliasPath('relayfile-bot', 'B001')));

    const rows = JSON.parse(client.files.get(slackUsersIndexPath())!) as Array<{ id: string; is_bot: boolean }>;
    assert.equal(rows[0]!.is_bot, true);
  });

  it('reconciles channel rename via the prior name on the existing index row', async () => {
    // Seed the channels _index.json with the prior handle.
    const priorIndex = [
      { id: 'C001', title: 'old-name', updated: '2026-05-11T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [slackChannelsIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    const result = await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [{ id: 'C001', name: 'new-name', updated: '2026-05-12T00:00:00Z' }],
    });

    assert.deepEqual(result.errors, []);
    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(channelMetadataPath('C001', 'old-name')),
      `expected old canonical to be deleted, got: ${deletedPaths.join(', ')}`,
    );
    assert.ok(
      deletedPaths.includes(slackByNameChannelAliasPath('old-name', 'C001')),
      'expected old by-name alias to be deleted',
    );
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(channelMetadataPath('C001', 'new-name')));
    assert.ok(writtenPaths.includes(slackByNameChannelAliasPath('new-name', 'C001')));
  });

  it('preserves prior channel name for sparse lifecycle updates', async () => {
    const priorIndex = [
      { id: 'C001', title: 'general', updated: '2026-05-11T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [slackChannelsIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    const result = await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [{ id: 'C001', is_archived: true, updated: '2026-05-12T00:00:00Z' }],
    });

    assert.deepEqual(result.errors, []);
    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(!deletedPaths.includes(channelMetadataPath('C001', 'general')));
    assert.ok(!deletedPaths.includes(slackByNameChannelAliasPath('general', 'C001')));

    const written = client.writes.find((w) => w.path === channelMetadataPath('C001', 'general'));
    assert.ok(written, 'expected sparse lifecycle update to keep the named canonical path');
    const payload = JSON.parse(written.content) as { payload?: { name?: string; is_archived?: boolean } };
    assert.equal(payload.payload?.name, 'general');
    assert.equal(payload.payload?.is_archived, true);
  });

  it('reconciles user rename via the prior handle on the existing index row', async () => {
    const priorIndex = [
      { id: 'U001', title: 'Sam Smith', name: 'sam', is_bot: false, updated: '2026-05-11T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [slackUsersIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [{ id: 'U001', name: 'sammy', updated: '2026-05-12T00:00:00Z' }],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(deletedPaths.includes(userMetadataPath('U001', 'sam')));
    assert.ok(deletedPaths.includes(slackByNameUserAliasPath('sam', 'U001')));

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(userMetadataPath('U001', 'sammy')));
    assert.ok(writtenPaths.includes(slackByNameUserAliasPath('sammy', 'U001')));
  });

  it('deletes the bots alias when a user flips from is_bot=true to is_bot=false', async () => {
    const priorIndex = [
      { id: 'B001', title: 'relayfile-bot', name: 'relayfile-bot', is_bot: true, updated: '2026-05-11T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [slackUsersIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [
        { id: 'B001', name: 'relayfile-bot', is_bot: false, updated: '2026-05-12T00:00:00Z' },
      ],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(slackBotsAliasPath('B001', 'relayfile-bot')),
      `expected bots alias deletion, got: ${deletedPaths.join(', ')}`,
    );
    // by-name alias stays — same handle.
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(slackByNameUserAliasPath('relayfile-bot', 'B001')));
  });

  it('channel delete tombstone removes canonical + by-name AND drops index row', async () => {
    // Regression for adapter-core / relayfile-adapters#78 (Devin finding,
    // fixed in 7ec987b): delete plans must also drop the index row.
    const priorIndex = [
      { id: 'C001', title: 'general', updated: '2026-05-11T00:00:00Z' },
      { id: 'C002', title: 'random', updated: '2026-05-10T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [slackChannelsIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [{ id: 'C001', _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    assert.ok(deletedPaths.has(channelMetadataPath('C001', 'general')));
    assert.ok(deletedPaths.has(slackByNameChannelAliasPath('general', 'C001')));

    // Index file was rewritten WITHOUT the deleted row (only C002 survives).
    const indexBytes = client.files.get(slackChannelsIndexPath())!;
    const rows = JSON.parse(indexBytes) as Array<{ id: string }>;
    assert.deepEqual(rows.map((r) => r.id), ['C002'], 'deleted channel id removed from index');
  });

  it('user delete tombstone removes canonical + by-name + bots AND drops index row', async () => {
    const priorIndex = [
      { id: 'B001', title: 'relayfile-bot', name: 'relayfile-bot', is_bot: true, updated: '2026-05-11T00:00:00Z' },
      { id: 'U002', title: 'Sam', name: 'sam', is_bot: false, updated: '2026-05-10T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [slackUsersIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [{ id: 'B001', _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    assert.ok(deletedPaths.has(userMetadataPath('B001', 'relayfile-bot')));
    assert.ok(deletedPaths.has(slackByNameUserAliasPath('relayfile-bot', 'B001')));
    assert.ok(deletedPaths.has(slackBotsAliasPath('B001', 'relayfile-bot')));

    const rows = JSON.parse(client.files.get(slackUsersIndexPath())!) as Array<{ id: string }>;
    assert.deepEqual(rows.map((r) => r.id), ['U002'], 'deleted user id removed from index');
  });

  it('skips reconciliation when the client has no readFile but still emits new aliases + indexes', async () => {
    const client = createClient({ noRead: true });
    const result = await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [{ id: 'C001', name: 'general', updated: '2026-05-12T00:00:00Z' }],
      users: [{ id: 'U001', name: 'sam', updated: '2026-05-12T00:00:00Z' }],
    });

    assert.equal(client.deletes.length, 0);
    assert.deepEqual(result.errors, []);
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(slackRootIndexPath()));
    assert.ok(writtenPaths.includes(channelMetadataPath('C001', 'general')));
    assert.ok(writtenPaths.includes(slackByNameChannelAliasPath('general', 'C001')));
    assert.ok(writtenPaths.includes(userMetadataPath('U001', 'sam')));
    assert.ok(writtenPaths.includes(slackByNameUserAliasPath('sam', 'U001')));
  });

  it('captures per-path write failures in errors without aborting the fan-out', async () => {
    const failingPath = slackByNameChannelAliasPath('general', 'C001');
    const client = createClient({ failWriteOn: new Set([failingPath]) });

    const result = await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [{ id: 'C001', name: 'general', updated: '2026-05-12T00:00:00Z' }],
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.path, failingPath);
    assert.match(result.errors[0]!.error, /forced write failure/);

    // Canonical path landed, index file landed, root index landed.
    assert.ok(client.files.has(channelMetadataPath('C001', 'general')));
    assert.ok(client.files.has(slackChannelsIndexPath()));
    assert.ok(client.files.has(slackRootIndexPath()));
  });

  /* ------------------------------------------------------------------ */
  /* By-name alias collision handling (CodeRabbit PR #79 review).        */
  /*                                                                     */
  /* AGENTS.md "Each alias subtree needs a collision test." Two records  */
  /* whose names slug to the same value must each emit a path-distinct   */
  /* alias (the second uses the hash-disambiguated variant), never       */
  /* clobber-overwriting each other.                                     */
  /* ------------------------------------------------------------------ */

  it('channel by-name alias uses the colliding variant when two channels slug to the same value', async () => {
    const client = createClient();
    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [
        { id: 'C001', name: 'dup', updated: '2026-05-12T00:00:00Z' },
        { id: 'C002', name: 'dup', updated: '2026-05-12T00:00:00Z' },
      ],
    });

    const written = client.writes.map((w) => w.path);
    // Canonical paths are id-keyed so they never collide.
    assert.ok(written.includes(channelMetadataPath('C001', 'dup')));
    assert.ok(written.includes(channelMetadataPath('C002', 'dup')));
    // Both by-name aliases use the colliding variant (hash-disambiguated).
    const aliasC001 = slackByNameChannelAliasPath('dup', 'C001', true);
    const aliasC002 = slackByNameChannelAliasPath('dup', 'C002', true);
    assert.ok(written.includes(aliasC001), `expected colliding alias for C001 (${aliasC001})`);
    assert.ok(written.includes(aliasC002), `expected colliding alias for C002 (${aliasC002})`);
    // The non-colliding "first writer wins" variant must NOT be emitted.
    const nonCollidingPath = slackByNameChannelAliasPath('dup', 'C001', false);
    assert.equal(
      written.filter((p) => p === nonCollidingPath).length,
      0,
      'non-colliding alias path must not be written when slug collides intra-batch',
    );
    // The two colliding aliases land at distinct files.
    assert.notEqual(aliasC001, aliasC002, 'colliding aliases must produce distinct filenames');
  });

  it('user by-name alias uses the colliding variant when two users slug to the same handle', async () => {
    const client = createClient();
    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      users: [
        { id: 'U001', name: 'sam', real_name: 'Sam One', updated: '2026-05-12T00:00:00Z' },
        { id: 'U002', name: 'sam', real_name: 'Sam Two', updated: '2026-05-12T00:00:00Z' },
      ],
    });

    const written = client.writes.map((w) => w.path);
    assert.ok(written.includes(userMetadataPath('U001', 'sam')));
    assert.ok(written.includes(userMetadataPath('U002', 'sam')));
    const aliasU001 = slackByNameUserAliasPath('sam', 'U001', true);
    const aliasU002 = slackByNameUserAliasPath('sam', 'U002', true);
    assert.ok(written.includes(aliasU001), `expected colliding alias for U001 (${aliasU001})`);
    assert.ok(written.includes(aliasU002), `expected colliding alias for U002 (${aliasU002})`);
    const nonCollidingPath = slackByNameUserAliasPath('sam', 'U001', false);
    assert.equal(
      written.filter((p) => p === nonCollidingPath).length,
      0,
      'non-colliding alias path must not be written when slug collides intra-batch',
    );
    assert.notEqual(aliasU001, aliasU002);
  });

  it('does NOT trigger collision handling when the same id+name appears twice (deterministic single emit)', async () => {
    // Same id, same name → same record (or a benign duplicate). The
    // colliding-variant must NOT activate because there's only one
    // distinct id participating in the slug.
    const client = createClient();
    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [
        { id: 'C001', name: 'general', updated: '2026-05-12T00:00:00Z' },
        { id: 'C001', name: 'general', updated: '2026-05-12T00:00:00Z' },
      ],
    });

    const written = client.writes.map((w) => w.path);
    // Plain (non-colliding) alias path is the one that lands.
    assert.ok(
      written.includes(slackByNameChannelAliasPath('general', 'C001', false)),
      'same-id duplicate must use the non-colliding alias path',
    );
    // Hash-disambiguated variant must NOT be emitted.
    const collidingVariant = slackByNameChannelAliasPath('general', 'C001', true);
    assert.equal(
      written.filter((p) => p === collidingVariant).length,
      0,
      'colliding variant must not activate when only one distinct id shares the slug',
    );
  });

  /* ------------------------------------------------------------------ */
  /* Message / thread / reply path uniformity (CodeRabbit + Devin       */
  /* PR #79 review).                                                     */
  /*                                                                     */
  /* Writes used `record.channelName` (yielding `<id>__<slug>`); deletes */
  /* omitted it (yielding bare `<id>`). The two are STRUCTURALLY         */
  /* DIFFERENT paths, so tombstones missed the file they meant to        */
  /* remove. Fix: both writes and deletes derive `channelName` from the  */
  /* shared `channelNameById` map (prior _index.json + intra-batch       */
  /* channels), with the record's own `channelName` as fallback.         */
  /* ------------------------------------------------------------------ */

  it('message delete recovers channelName from the prior channels index so write and delete paths match', async () => {
    const channelName = 'general';
    const priorChannelsIndex = [
      { id: 'C001', title: channelName, updated: '2026-05-11T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [slackChannelsIndexPath()]: JSON.stringify(priorChannelsIndex),
      },
    });

    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      messages: [
        // First a write WITHOUT explicit channelName in the record — the
        // emitter should still synthesize the `<id>__<slug>` path from the
        // index. Then a delete for the same ts — the path must match.
        { channelId: 'C001', ts: '1715500000.000100', text: 'hello' },
        { channelId: 'C001', ts: '1715500000.000100', _deleted: true },
      ],
    });

    const expected = messagePath('C001', '1715500000.000100', undefined, channelName);
    const writtenPaths = client.writes.map((w) => w.path);
    const deletedPaths = client.deletes.map((d) => d.path);

    assert.ok(
      writtenPaths.includes(expected),
      `expected write at channelName-bearing path ${expected}, got: ${writtenPaths.join(', ')}`,
    );
    assert.ok(
      deletedPaths.includes(expected),
      `expected delete at channelName-bearing path ${expected}, got: ${deletedPaths.join(', ')}`,
    );
    // The legacy bare-id delete path must NOT appear.
    const bareIdPath = messagePath('C001', '1715500000.000100');
    assert.equal(
      deletedPaths.filter((p) => p === bareIdPath).length,
      0,
      'delete must not target the bare-id path when the channel name is known',
    );
  });

  it('thread + reply delete recover channelName from the intra-batch channel write', async () => {
    // No prior index — channel name is only available because the same
    // batch writes the channel. The shared `channelNameById` overlay must
    // make it visible to thread/reply path computation for both writes
    // and deletes.
    const client = createClient();

    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      channels: [{ id: 'C001', name: 'general', updated: '2026-05-12T00:00:00Z' }],
      threads: [
        { channelId: 'C001', threadTs: '1715500000.000100', _deleted: true },
      ],
      threadReplies: [
        {
          channelId: 'C001',
          threadTs: '1715500000.000100',
          replyTs: '1715500001.000200',
          _deleted: true,
        },
      ],
    });

    const expectedThread = threadPath('C001', '1715500000.000100', 'general');
    const expectedReply = threadReplyPath(
      'C001',
      '1715500000.000100',
      '1715500001.000200',
      'general',
    );
    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(expectedThread),
      `expected thread delete at ${expectedThread}, got: ${deletedPaths.join(', ')}`,
    );
    assert.ok(
      deletedPaths.includes(expectedReply),
      `expected reply delete at ${expectedReply}, got: ${deletedPaths.join(', ')}`,
    );
  });

  it('message write+delete fall back to bare-id path together when no channels index and no record.channelName', async () => {
    // Worst-case path uniformity check: when neither the prior index nor
    // the batch nor the record carries a channelName, BOTH the write and
    // the delete must degrade to the bare-id path — so a same-batch
    // write+delete still targets the same file.
    const client = createClient({ noRead: true });

    await emitSlackAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      messages: [
        { channelId: 'C001', ts: '1715500000.000100', text: 'hello' },
        { channelId: 'C001', ts: '1715500000.000100', _deleted: true },
      ],
    });

    const bareIdPath = messagePath('C001', '1715500000.000100');
    const writtenPaths = client.writes.map((w) => w.path);
    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(writtenPaths.includes(bareIdPath));
    assert.ok(deletedPaths.includes(bareIdPath));
  });
});
