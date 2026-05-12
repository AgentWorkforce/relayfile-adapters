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
});
