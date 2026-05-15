/**
 * Adapter-owned auxiliary-file emission for Slack.
 *
 * Phase 2 port of the cross-adapter `emitAuxiliaryFiles` contract defined
 * in `@relayfile/adapter-core` (Phase 1 reference: confluence). Adapter-core
 * exports `runEmitBatch`, `IndexFileReconciler`, `PriorAliasReader`, and
 * the typed result shape; this module wires Slack's per-resource path /
 * alias / index conventions into those primitives.
 *
 * Behavior (per-resource):
 *
 *   1. **Channel** records emit a canonical `<channelId>__<channelName>/meta.json`,
 *      a `by-name/<slug>.json` alias (when the name slugs to a non-empty value),
 *      and a row in `/slack/channels/_index.json` (`{ id, title, updated }`).
 *      Renames reconcile by looking up the prior `name` in the existing
 *      `_index.json` rows (slack-specific — slack stores the prior handle
 *      in the index row rather than under a separate by-id alias the way
 *      confluence does, because the canonical path itself is keyed on
 *      `<id>__<slug>` and there's no separate id-only stable URL).
 *
 *   2. **User** records emit canonical `<userId>__<userName>/meta.json`,
 *      `by-name/<slug>.json` alias, plus `bots/<id>__<slug>.json` when
 *      `is_bot: true`. Index row: `{ id, title, name, updated, is_bot }`
 *      — `name` is the handle (the cloud#546 review fix), persisted so
 *      rename reconciliation has an unambiguous prior slug source.
 *      Bot-flip (`is_bot: true → false`) deletes the stale `bots/` alias
 *      while leaving `by-name` in place.
 *
 *   3. **Message** / **Thread** / **Thread reply** records emit only the
 *      canonical `meta.json` (and per-reply `<ts>.json`) under their
 *      channel directory. No alias fan-out and no index file at this
 *      level. Because the message record itself doesn't carry the parent
 *      channel name, the path falls back to the bare `<channelId>` segment
 *      — readers join via the channel index to discover the human-readable
 *      directory name.
 *
 *   4. **Root index** at `/slack/_index.json` is written **unconditionally**
 *      on every call (regression for cloud#546 — even a message-only sync
 *      must produce the root index so consumers can `ls /slack` reliably).
 *
 *   5. **Tombstones** (`{ id, _deleted: true }`) recover the prior name from
 *      the existing index row, remove the canonical + `by-name` + `bots/`
 *      paths, AND drop the index row (regression for
 *      `relayfile-adapters#78` Devin finding 7ec987b — without the index
 *      `.remove`, `_index.json` accumulates ghost entries).
 *
 *   6. Per-path failures land in `EmitAuxiliaryFilesResult.errors`; the
 *      fan-out continues. Reads (reconciliation + index merge) degrade to
 *      "no prior state" when the client lacks `readFile`.
 */

import {
  IndexFileReconciler,
  runEmitBatch,
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitDelete,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import { slugifyAlias } from './alias-slug.js';
import {
  buildSlackRootIndexFile,
  type SlackChannelIndexRow,
  type SlackUserIndexRow,
} from './index-emitter.js';
import {
  channelMetadataPath,
  messagePath,
  slackBotsAliasPath,
  slackByNameChannelAliasPath,
  slackByNameUserAliasPath,
  slackChannelsIndexPath,
  slackUsersIndexPath,
  threadPath,
  threadReplyPath,
  userMetadataPath,
} from './path-mapper.js';
import type { RelayFileClientLike } from './slack-adapter.js';

/* -------------------------------------------------------------------------- */
/* Provider identifier reused by the rendered content wrapper.                */
/* -------------------------------------------------------------------------- */

const SLACK_PROVIDER_NAME = 'slack';
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

/* -------------------------------------------------------------------------- */
/* Record shapes accepted by the entry point.                                 */
/*                                                                            */
/* These are intentionally permissive: cloud pre-cleans Slack payloads before */
/* handing them off, and Slack's API surface yields wildly nested objects     */
/* (`user.profile.display_name`, attachments arrays, etc.). The emitter only  */
/* depends on the identifier + a small set of human-readable fields and       */
/* passes the rest through verbatim in the rendered payload.                  */
/* -------------------------------------------------------------------------- */

export interface SlackChannelRecord {
  id: string;
  name?: string;
  updated?: string;
  [key: string]: unknown;
}

export interface SlackUserRecord {
  id: string;
  name?: string;
  is_bot?: boolean;
  updated?: string;
  profile?: Record<string, unknown>;
  real_name?: string;
  [key: string]: unknown;
}

export interface SlackMessageRecord {
  channelId: string;
  ts: string;
  channelName?: string;
  [key: string]: unknown;
}

export interface SlackThreadRecord {
  channelId: string;
  threadTs: string;
  channelName?: string;
  [key: string]: unknown;
}

export interface SlackThreadReplyRecord {
  channelId: string;
  threadTs: string;
  replyTs: string;
  channelName?: string;
  [key: string]: unknown;
}

export type SlackChannelEmitRecord =
  | SlackChannelRecord
  | { id: string; _deleted: true };

export type SlackUserEmitRecord =
  | SlackUserRecord
  | { id: string; _deleted: true };

export type SlackMessageEmitRecord =
  | SlackMessageRecord
  | { channelId: string; ts: string; _deleted: true };

export type SlackThreadEmitRecord =
  | SlackThreadRecord
  | { channelId: string; threadTs: string; _deleted: true };

export type SlackThreadReplyEmitRecord =
  | SlackThreadReplyRecord
  | { channelId: string; threadTs: string; replyTs: string; _deleted: true };

export interface SlackEmitAuxiliaryFilesInput {
  workspaceId: string;
  channels?: readonly SlackChannelEmitRecord[];
  users?: readonly SlackUserEmitRecord[];
  messages?: readonly SlackMessageEmitRecord[];
  threads?: readonly SlackThreadEmitRecord[];
  threadReplies?: readonly SlackThreadReplyEmitRecord[];
  /**
   * Optional connection id surfaced in the rendered payload wrapper so
   * downstream readers can route writeback by connection.
   */
  connectionId?: string;
}

/* -------------------------------------------------------------------------- */
/* Entry point.                                                                */
/* -------------------------------------------------------------------------- */

export async function emitSlackAuxiliaryFiles(
  client: AuxiliaryEmitterClient | RelayFileClientLike,
  input: SlackEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const emitterClient = client as AuxiliaryEmitterClient;
  const workspaceId = input.workspaceId;

  const channels = input.channels ?? [];
  const users = input.users ?? [];
  const messages = input.messages ?? [];
  const threads = input.threads ?? [];
  const threadReplies = input.threadReplies ?? [];

  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  // Always emit the root index, even for empty / message-only batches.
  // This was a Devin/CodeRabbit finding on cloud#546: the root index used
  // to be gated behind the channel/user write branch, so message-only
  // syncs would never produce `/slack/_index.json`, breaking
  // `ls /slack`-style discovery.
  await writeRootIndex(emitterClient, workspaceId, aggregate);

  // Hydrate the channelName-by-id maps up front:
  //   - `priorChannelNameById` is the snapshot from the existing
  //     `_index.json` BEFORE this batch's writes apply. `emitChannels`
  //     uses this for rename reconciliation (delete the stale alias whose
  //     handle came from the prior row).
  //   - `channelNameById` overlays the intra-batch channel writes on top.
  //     Every message/thread/reply path is computed from THIS map so
  //     writes and delete tombstones target identical paths — the
  //     original review finding was that writes passed `record.channelName`
  //     (yielding `<id>__<slug>`) while deletes omitted it (yielding bare
  //     `<id>`), so tombstones missed the file they were trying to remove.
  //     See PR #79 review thread.
  const priorChannelNameById = await readPriorChannelNames(emitterClient, workspaceId);
  const channelNameById = new Map(priorChannelNameById);
  for (const record of channels) {
    if (isChannelDelete(record)) continue;
    const id = readNonEmptyString(record.id);
    const name = readNonEmptyString(record.name);
    if (id && name) channelNameById.set(id, name);
  }

  if (channels.length > 0) {
    const partial = await emitChannels(
      emitterClient,
      workspaceId,
      channels,
      input.connectionId,
      priorChannelNameById,
    );
    accumulate(aggregate, partial);
  }
  if (users.length > 0) {
    const partial = await emitUsers(emitterClient, workspaceId, users, input.connectionId);
    accumulate(aggregate, partial);
  }
  if (messages.length > 0) {
    const partial = await emitMessages(
      emitterClient,
      workspaceId,
      messages,
      input.connectionId,
      channelNameById,
    );
    accumulate(aggregate, partial);
  }
  if (threads.length > 0) {
    const partial = await emitThreads(
      emitterClient,
      workspaceId,
      threads,
      input.connectionId,
      channelNameById,
    );
    accumulate(aggregate, partial);
  }
  if (threadReplies.length > 0) {
    const partial = await emitThreadReplies(
      emitterClient,
      workspaceId,
      threadReplies,
      input.connectionId,
      channelNameById,
    );
    accumulate(aggregate, partial);
  }

  return aggregate;
}

/* -------------------------------------------------------------------------- */
/* Root index.                                                                 */
/* -------------------------------------------------------------------------- */

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const file = buildSlackRootIndexFile();
  try {
    await client.writeFile({
      workspaceId,
      path: file.path,
      content: file.content,
      contentType: file.contentType,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({ path: file.path, error: stringifyError(error) });
  }
}

/* -------------------------------------------------------------------------- */
/* Channels.                                                                   */
/* -------------------------------------------------------------------------- */

async function emitChannels(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly SlackChannelEmitRecord[],
  connectionId: string | undefined,
  /**
   * Prior-name lookup hydrated once by the entry point from the existing
   * channels `_index.json`. Slack's reconciliation anchor lives in the
   * index row (not in a by-id alias file), so this map drives stale
   * canonical / by-name deletes when a rename is detected.
   */
  priorNameById: ReadonlyMap<string, string>,
): Promise<EmitAuxiliaryFilesResult> {
  // Intra-batch slug collision detection: when two channel records slug to
  // the same value but carry different ids, every record sharing that slug
  // must use the colliding-variant alias path so neither clobbers the
  // other. Mirror the pattern in adapter-github's `nameWithId(existingNames)`.
  const collidingChannelSlugs = computeCollidingChannelSlugs(records);

  const indexReconciler = new IndexFileReconciler<SlackChannelIndexRow>({
    client,
    workspaceId,
    path: slackChannelsIndexPath(),
    builder: (rows) => ({
      path: slackChannelsIndexPath(),
      content: `${JSON.stringify(
        [...rows].sort(compareChannelRows),
      )}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isChannelDelete(record)) {
      return planChannelDelete(record.id, priorNameById, indexReconciler);
    }
    return planChannelWrite(
      record,
      priorNameById,
      indexReconciler,
      connectionId,
      collidingChannelSlugs,
    );
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

/**
 * Compute the set of slug values that appear with more than one distinct id
 * in the channel batch. Names that slug to the empty-slug sentinel
 * (`'untitled'`) are ignored — those records skip the by-name alias.
 */
function computeCollidingChannelSlugs(
  records: readonly SlackChannelEmitRecord[],
): ReadonlySet<string> {
  const slugToIds = new Map<string, Set<string>>();
  for (const record of records) {
    if (isChannelDelete(record)) continue;
    const id = readNonEmptyString(record.id);
    const name = readNonEmptyString(record.name);
    if (!id || !name) continue;
    const slug = slugifyAlias(name);
    if (slug === 'untitled') continue;
    let ids = slugToIds.get(slug);
    if (!ids) {
      ids = new Set();
      slugToIds.set(slug, ids);
    }
    ids.add(id);
  }
  const colliding = new Set<string>();
  for (const [slug, ids] of slugToIds) {
    if (ids.size > 1) colliding.add(slug);
  }
  return colliding;
}

function planChannelWrite(
  channel: SlackChannelRecord,
  priorNameById: ReadonlyMap<string, string>,
  indexReconciler: IndexFileReconciler<SlackChannelIndexRow>,
  connectionId: string | undefined,
  collidingSlugs: ReadonlySet<string>,
): EmitPlan {
  const id = readNonEmptyString(channel.id);
  if (!id) return {};

  const name = readNonEmptyString(channel.name) ?? priorNameById.get(id);
  const payload = name && !readNonEmptyString(channel.name)
    ? { ...channel, name }
    : channel;
  const content = renderContent('channel', id, payload, connectionId, false);

  const writes: EmitWrite[] = [];
  const deletes: EmitDelete[] = [];

  const canonical = channelMetadataPath(id, name);
  writes.push({ path: canonical, content, contentType: JSON_CONTENT_TYPE });

  if (name && slugifies(name)) {
    const colliding = collidingSlugs.has(slugifyAlias(name));
    writes.push({
      path: slackByNameChannelAliasPath(name, id, colliding),
      content,
      contentType: JSON_CONTENT_TYPE,
    });
  }

  // Reconcile rename: stale canonical + stale by-name from the prior handle.
  // Note: cross-batch collision state isn't tracked, so the rename targets
  // the non-colliding variant only. If a prior write happened to be the
  // colliding variant, a separate sync run will land the new state cleanly
  // — the stale colliding file is a known minor leak documented in
  // AGENTS.md follow-ups.
  const prior = priorNameById.get(id);
  if (prior && prior !== name) {
    deletes.push({ path: channelMetadataPath(id, prior) });
    if (slugifies(prior)) {
      deletes.push({ path: slackByNameChannelAliasPath(prior, id) });
    }
  }

  indexReconciler.upsert({
    id,
    title: name ?? '',
    updated: readNonEmptyString(channel.updated) ?? '',
  });

  return { writes, deletes };
}

function planChannelDelete(
  id: string,
  priorNameById: ReadonlyMap<string, string>,
  indexReconciler: IndexFileReconciler<SlackChannelIndexRow>,
): EmitPlan {
  const deletes: EmitDelete[] = [];
  const prior = priorNameById.get(id);
  // Canonical path is `<id>__<slug>` when a name is known; otherwise bare id.
  deletes.push({ path: channelMetadataPath(id, prior) });
  if (prior && slugifies(prior)) {
    deletes.push({ path: slackByNameChannelAliasPath(prior, id) });
  }
  // Drop the index row alongside the files (regression for #78 7ec987b).
  indexReconciler.remove(id);
  return { deletes };
}

/* -------------------------------------------------------------------------- */
/* Users.                                                                      */
/* -------------------------------------------------------------------------- */

async function emitUsers(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly SlackUserEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  // Hydrate prior name + bot flag from the existing `_index.json`. Slack
  // stores both on the index row (`name`, `is_bot`) so we don't need a
  // by-id alias read per user.
  const prior = await readPriorUserState(client, workspaceId);

  // Intra-batch slug collision detection for the `by-name` alias. Slack
  // user display names are non-unique by design (multiple humans named
  // "Sam"), so the second writer of a colliding slug must land at the
  // hash-disambiguated variant rather than clobbering the first.
  const collidingUserSlugs = computeCollidingUserSlugs(records);

  const indexReconciler = new IndexFileReconciler<SlackUserIndexRow>({
    client,
    workspaceId,
    path: slackUsersIndexPath(),
    builder: (rows) => ({
      path: slackUsersIndexPath(),
      content: `${JSON.stringify(
        [...rows].sort(compareUserRows),
      )}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isUserDelete(record)) {
      return planUserDelete(record.id, prior, indexReconciler);
    }
    return planUserWrite(record, prior, indexReconciler, connectionId, collidingUserSlugs);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

/**
 * Compute the set of slug values that appear with more than one distinct id
 * in the user batch. Slug derives from the handle when present, falling back
 * to display name — matching `planUserWrite`'s `slugSource` derivation.
 */
function computeCollidingUserSlugs(
  records: readonly SlackUserEmitRecord[],
): ReadonlySet<string> {
  const slugToIds = new Map<string, Set<string>>();
  for (const record of records) {
    if (isUserDelete(record)) continue;
    const id = readNonEmptyString(record.id);
    if (!id) continue;
    const handle = readUserHandle(record);
    const displayName = readUserDisplayName(record) ?? handle;
    const slugSource = handle ?? displayName;
    if (!slugSource) continue;
    const slug = slugifyAlias(slugSource);
    if (slug === 'untitled') continue;
    let ids = slugToIds.get(slug);
    if (!ids) {
      ids = new Set();
      slugToIds.set(slug, ids);
    }
    ids.add(id);
  }
  const colliding = new Set<string>();
  for (const [slug, ids] of slugToIds) {
    if (ids.size > 1) colliding.add(slug);
  }
  return colliding;
}

interface PriorUserState {
  /** Handle from the prior index row's `name` field (preferred slug source). */
  name?: string;
  /** Display name from the prior index row's `title` field (slug fallback). */
  title?: string;
  is_bot?: boolean;
}

function planUserWrite(
  user: SlackUserRecord,
  prior: Map<string, PriorUserState>,
  indexReconciler: IndexFileReconciler<SlackUserIndexRow>,
  connectionId: string | undefined,
  collidingSlugs: ReadonlySet<string>,
): EmitPlan {
  const id = readNonEmptyString(user.id);
  if (!id) return {};

  const handle = readUserHandle(user);
  const displayName = readUserDisplayName(user) ?? handle;
  const isBot = user.is_bot === true;
  const slugSource = handle ?? displayName;

  const content = renderContent('user', id, user, connectionId, false);

  const writes: EmitWrite[] = [];
  const deletes: EmitDelete[] = [];

  const canonical = userMetadataPath(id, slugSource);
  writes.push({ path: canonical, content, contentType: JSON_CONTENT_TYPE });

  if (slugSource && slugifies(slugSource)) {
    const colliding = collidingSlugs.has(slugifyAlias(slugSource));
    writes.push({
      path: slackByNameUserAliasPath(slugSource, id, colliding),
      content,
      contentType: JSON_CONTENT_TYPE,
    });
  }

  if (isBot) {
    writes.push({
      path: slackBotsAliasPath(id, slugSource),
      content,
      contentType: JSON_CONTENT_TYPE,
    });
  }

  // Reconciliation: prior name change clears stale canonical + by-name +
  // bots paths. Prior is_bot flip clears stale bots alias.
  const priorState = prior.get(id);
  if (priorState) {
    const priorSlug = priorState.name ?? priorState.title;
    if (priorSlug && priorSlug !== slugSource) {
      deletes.push({ path: userMetadataPath(id, priorSlug) });
      if (slugifies(priorSlug)) {
        deletes.push({ path: slackByNameUserAliasPath(priorSlug, id) });
      }
      if (priorState.is_bot === true) {
        deletes.push({ path: slackBotsAliasPath(id, priorSlug) });
      }
    } else if (priorState.is_bot === true && !isBot) {
      // Same name, but flipped from bot to human — remove the stale bots alias.
      deletes.push({ path: slackBotsAliasPath(id, priorSlug ?? slugSource) });
    }
  }

  indexReconciler.upsert({
    id,
    title: displayName ?? '',
    updated: readNonEmptyString(user.updated) ?? '',
    is_bot: isBot,
    ...(handle ? { name: handle } : {}),
  });

  return { writes, deletes };
}

function planUserDelete(
  id: string,
  prior: Map<string, PriorUserState>,
  indexReconciler: IndexFileReconciler<SlackUserIndexRow>,
): EmitPlan {
  const deletes: EmitDelete[] = [];
  const priorState = prior.get(id);
  const priorSlug = priorState?.name ?? priorState?.title;
  deletes.push({ path: userMetadataPath(id, priorSlug) });
  if (priorSlug && slugifies(priorSlug)) {
    deletes.push({ path: slackByNameUserAliasPath(priorSlug, id) });
  }
  if (priorState?.is_bot === true) {
    deletes.push({ path: slackBotsAliasPath(id, priorSlug) });
  }
  indexReconciler.remove(id);
  return { deletes };
}

/* -------------------------------------------------------------------------- */
/* Messages / threads / replies.                                               */
/*                                                                             */
/* No alias fan-out and no per-resource index file. Each record emits its     */
/* canonical `meta.json` (or `<ts>.json` for replies) and that's it.          */
/* -------------------------------------------------------------------------- */

async function emitMessages(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly SlackMessageEmitRecord[],
  connectionId: string | undefined,
  channelNameById: ReadonlyMap<string, string>,
): Promise<EmitAuxiliaryFilesResult> {
  return runEmitBatch(client, workspaceId, records, (record) => {
    // Derive channelName uniformly for writes and deletes from the shared
    // `channelNameById` map (prior `_index.json` + intra-batch channel
    // writes), falling back to whatever the record itself carries. This
    // closes the PR #79 review finding where writes used `record.channelName`
    // (yielding `<id>__<slug>`) while deletes omitted it (yielding bare
    // `<id>`), so a tombstone never matched the file it was meant to
    // remove.
    const channelName = resolveChannelName(
      channelNameById,
      record.channelId,
      (record as { channelName?: string }).channelName,
    );
    if (isMessageDelete(record)) {
      return {
        deletes: [{ path: messagePath(record.channelId, record.ts, undefined, channelName) }],
      };
    }
    const path = messagePath(record.channelId, record.ts, undefined, channelName);
    const content = renderContent(
      'message',
      `${record.channelId}:${record.ts}`,
      record,
      connectionId,
      false,
    );
    return { writes: [{ path, content, contentType: JSON_CONTENT_TYPE }] };
  });
}

async function emitThreads(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly SlackThreadEmitRecord[],
  connectionId: string | undefined,
  channelNameById: ReadonlyMap<string, string>,
): Promise<EmitAuxiliaryFilesResult> {
  return runEmitBatch(client, workspaceId, records, (record) => {
    const channelName = resolveChannelName(
      channelNameById,
      record.channelId,
      (record as { channelName?: string }).channelName,
    );
    if (isThreadDelete(record)) {
      return { deletes: [{ path: threadPath(record.channelId, record.threadTs, channelName) }] };
    }
    const path = threadPath(record.channelId, record.threadTs, channelName);
    const content = renderContent(
      'thread',
      `${record.channelId}:${record.threadTs}`,
      record,
      connectionId,
      false,
    );
    return { writes: [{ path, content, contentType: JSON_CONTENT_TYPE }] };
  });
}

async function emitThreadReplies(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly SlackThreadReplyEmitRecord[],
  connectionId: string | undefined,
  channelNameById: ReadonlyMap<string, string>,
): Promise<EmitAuxiliaryFilesResult> {
  return runEmitBatch(client, workspaceId, records, (record) => {
    const channelName = resolveChannelName(
      channelNameById,
      record.channelId,
      (record as { channelName?: string }).channelName,
    );
    if (isThreadReplyDelete(record)) {
      return {
        deletes: [
          {
            path: threadReplyPath(
              record.channelId,
              record.threadTs,
              record.replyTs,
              channelName,
            ),
          },
        ],
      };
    }
    const path = threadReplyPath(
      record.channelId,
      record.threadTs,
      record.replyTs,
      channelName,
    );
    const content = renderContent(
      'thread_reply',
      `${record.channelId}:${record.threadTs}:${record.replyTs}`,
      record,
      connectionId,
      false,
    );
    return { writes: [{ path, content, contentType: JSON_CONTENT_TYPE }] };
  });
}

/**
 * Pick the channelName segment to use when computing a message / thread /
 * reply path. Preference order:
 *
 *   1. The shared `channelNameById` map — prior index + intra-batch channel
 *      writes. This is the authoritative source for write/delete uniformity.
 *   2. The record's own `channelName` field — fallback for the case where
 *      the channels index hasn't been hydrated (no `readFile` on the client
 *      AND no channel records in this batch).
 *   3. `undefined` — produces bare `<id>` path segments. Both writes and
 *      deletes degrade to this together, so they still target the same
 *      file.
 */
function resolveChannelName(
  channelNameById: ReadonlyMap<string, string>,
  channelId: string,
  recordChannelName: string | undefined,
): string | undefined {
  const fromMap = channelNameById.get(channelId);
  if (fromMap) return fromMap;
  return readNonEmptyString(recordChannelName);
}

/* -------------------------------------------------------------------------- */
/* Prior-state hydration (slack-specific: name lives on the index row).       */
/* -------------------------------------------------------------------------- */

async function readPriorChannelNames(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rows = await readIndexRows<SlackChannelIndexRow>(
    client,
    workspaceId,
    slackChannelsIndexPath(),
  );
  for (const row of rows) {
    const name = readNonEmptyString(row.title);
    if (name) {
      map.set(row.id, name);
    }
  }
  return map;
}

async function readPriorUserState(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
): Promise<Map<string, PriorUserState>> {
  const map = new Map<string, PriorUserState>();
  const rows = await readIndexRows<SlackUserIndexRow>(
    client,
    workspaceId,
    slackUsersIndexPath(),
  );
  for (const row of rows) {
    const state: PriorUserState = { is_bot: row.is_bot === true };
    const priorName = readNonEmptyString(row.name);
    if (priorName) state.name = priorName;
    const priorTitle = readNonEmptyString(row.title);
    if (priorTitle) state.title = priorTitle;
    map.set(row.id, state);
  }
  return map;
}

async function readIndexRows<TRow extends { id: string }>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<TRow[]> {
  if (!client.readFile) return [];
  try {
    const result = await client.readFile({ workspaceId, path });
    if (!result || typeof result.content !== 'string' || result.content.length === 0) {
      return [];
    }
    const parsed = JSON.parse(result.content) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows: TRow[] = [];
    for (const item of parsed) {
      if (
        isRecord(item) &&
        typeof (item as { id?: unknown }).id === 'string'
      ) {
        rows.push(item as TRow);
      }
    }
    return rows;
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Rendering, helpers, type-guards.                                            */
/* -------------------------------------------------------------------------- */

function renderContent(
  objectType: string,
  objectId: string,
  payload: unknown,
  connectionId: string | undefined,
  deleted: boolean,
): string {
  return JSON.stringify(
    {
      provider: SLACK_PROVIDER_NAME,
      objectType,
      objectId,
      deleted,
      payload,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );
}

function readUserHandle(user: SlackUserRecord): string | undefined {
  return readNonEmptyString(user.name);
}

function readUserDisplayName(user: SlackUserRecord): string | undefined {
  if (isRecord(user.profile)) {
    const display = readNonEmptyString(user.profile.display_name);
    if (display) return display;
    const realName = readNonEmptyString(user.profile.real_name);
    if (realName) return realName;
  }
  return readNonEmptyString(user.real_name) ?? readNonEmptyString(user.name);
}

function compareChannelRows(left: SlackChannelIndexRow, right: SlackChannelIndexRow): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function compareUserRows(left: SlackUserIndexRow, right: SlackUserIndexRow): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Skip alias emission for inputs whose slug collapses to the empty-slug
 * sentinel `'untitled'`. The canonical `<id>__<slug>` path still resolves
 * these records via the bare id segment.
 */
function slugifies(value: string): boolean {
  return slugifyAlias(value) !== 'untitled';
}

function isChannelDelete(
  record: SlackChannelEmitRecord,
): record is { id: string; _deleted: true } {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    typeof (record as { id?: unknown }).id === 'string'
  );
}

function isUserDelete(
  record: SlackUserEmitRecord,
): record is { id: string; _deleted: true } {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    typeof (record as { id?: unknown }).id === 'string'
  );
}

function isMessageDelete(
  record: SlackMessageEmitRecord,
): record is { channelId: string; ts: string; _deleted: true } {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    typeof (record as { channelId?: unknown }).channelId === 'string' &&
    typeof (record as { ts?: unknown }).ts === 'string'
  );
}

function isThreadDelete(
  record: SlackThreadEmitRecord,
): record is { channelId: string; threadTs: string; _deleted: true } {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    typeof (record as { channelId?: unknown }).channelId === 'string' &&
    typeof (record as { threadTs?: unknown }).threadTs === 'string'
  );
}

function isThreadReplyDelete(
  record: SlackThreadReplyEmitRecord,
): record is { channelId: string; threadTs: string; replyTs: string; _deleted: true } {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    typeof (record as { channelId?: unknown }).channelId === 'string' &&
    typeof (record as { threadTs?: unknown }).threadTs === 'string' &&
    typeof (record as { replyTs?: unknown }).replyTs === 'string'
  );
}

function accumulate(
  aggregate: EmitAuxiliaryFilesResult,
  partial: EmitAuxiliaryFilesResult,
): void {
  aggregate.written += partial.written;
  aggregate.deleted += partial.deleted;
  if (partial.errors.length > 0) {
    aggregate.errors.push(...partial.errors);
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
