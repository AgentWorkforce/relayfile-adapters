import {
  slackByNameChannelAliasPath,
  slackByNameUserAliasPath,
  slackBotsAliasPath,
  slackChannelsIndexPath,
  slackRootIndexPath,
  slackUsersIndexPath,
} from './path-mapper.js';

export interface SlackIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

export interface SlackChannelIndexRow {
  id: string;
  title: string;
  updated: string;
}

export interface SlackUserIndexRow {
  id: string;
  title: string;
  updated: string;
  is_bot: boolean;
}

export interface SlackRootIndexRow {
  name: string;
  path: string;
}

/**
 * Build `/slack/_index.json` — a static listing of top-level resource roots.
 * The roots are stable; callers can override the default if they only sync a
 * subset of resources.
 */
export function buildSlackRootIndexFile(
  rows: SlackRootIndexRow[] = [
    { name: 'channels', path: '/slack/channels' },
    { name: 'users', path: '/slack/users' },
  ],
): SlackIndexFile {
  return {
    path: slackRootIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(rows)}\n`,
  };
}

export function buildSlackChannelsIndexFile(rows: SlackChannelIndexRow[]): SlackIndexFile {
  return {
    path: slackChannelsIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareChannelRows))}\n`,
  };
}

export function buildSlackUsersIndexFile(rows: SlackUserIndexRow[]): SlackIndexFile {
  return {
    path: slackUsersIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareUserRows))}\n`,
  };
}

export interface SlackChannelAliasPointer {
  id: string;
  name: string;
  path: string;
}

export interface SlackUserAliasPointer {
  id: string;
  name: string;
  is_bot: boolean;
  path: string;
}

/**
 * Build the `by-name` alias file for a channel. `pointer.path` is the
 * canonical channel record (e.g. `/slack/channels/C0123__general/meta.json`).
 */
export function buildSlackChannelByNameAliasFile(
  pointer: SlackChannelAliasPointer,
  colliding = false,
): SlackIndexFile {
  return {
    path: slackByNameChannelAliasPath(pointer.name, pointer.id, colliding),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify({ id: pointer.id, name: pointer.name, path: pointer.path })}\n`,
  };
}

/**
 * Build the `by-name` alias file for a user. Slack display names are
 * non-unique by design, so set `colliding=true` when emitting a duplicate
 * slug.
 */
export function buildSlackUserByNameAliasFile(
  pointer: SlackUserAliasPointer,
  colliding = false,
): SlackIndexFile {
  return {
    path: slackByNameUserAliasPath(pointer.name, pointer.id, colliding),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify({
      id: pointer.id,
      name: pointer.name,
      is_bot: pointer.is_bot,
      path: pointer.path,
    })}\n`,
  };
}

/**
 * Build the bot alias file at `/slack/users/bots/<id>__<slug>.json`. Same
 * content shape as the `by-name` alias.
 */
export function buildSlackBotsAliasFile(pointer: SlackUserAliasPointer): SlackIndexFile {
  return {
    path: slackBotsAliasPath(pointer.id, pointer.name),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify({
      id: pointer.id,
      name: pointer.name,
      is_bot: true,
      path: pointer.path,
    })}\n`,
  };
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
