import { notionUserPath, notionUsersCollectionPath } from '../path-mapper.js';
import type { FileSemantics } from '@relayfile/sdk';
import type { NotionApiClient } from '../client.js';
import type { NotionUser, NotionVfsFile } from '../types.js';

export interface NotionNormalizedUser {
  object: 'user';
  id: string;
  type: string | null;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
}

/**
 * `GET /v1/users` — the only Notion API surface that lists workspace users.
 *
 * The integration token's scope determines what shows up:
 *   - Internal integrations see members they share at least one shared
 *     page with, plus all bot users.
 *   - User-installed OAuth apps see the installing user + bots.
 *
 * Display names (`name`) are stable enough for an alias but **not unique**
 * — bot integrations frequently share names with their human owners — so
 * the by-name alias always includes the `<short_id>` suffix.
 */
export async function listUsers(client: NotionApiClient): Promise<NotionUser[]> {
  return client.paginate<NotionUser>('GET', '/v1/users');
}

export function normalizeUser(user: NotionUser): NotionNormalizedUser {
  return {
    object: 'user',
    id: user.id,
    type: user.type ?? null,
    name: user.name ?? null,
    avatarUrl: user.avatar_url ?? null,
    email: user.person?.email ?? null,
  };
}

export function buildUserFile(user: NotionUser): NotionVfsFile {
  const normalized = normalizeUser(user);
  return {
    path: notionUserPath(user.id, normalized.name ?? undefined),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(normalized, null, 2)}\n`,
    aliasMetadata: {
      scopePath: notionUsersCollectionPath(),
      id: user.id,
      name: normalized.name ?? undefined,
      aliasKind: 'user',
    },
    semantics: buildUserSemantics(user),
  };
}

export async function ingestUserArtifacts(client: NotionApiClient): Promise<NotionVfsFile[]> {
  const users = await listUsers(client);
  return users.map((user) => buildUserFile(user));
}

function buildUserSemantics(user: NotionUser): FileSemantics {
  return {
    properties: {
      provider: 'notion',
      'provider.object_id': user.id,
      'provider.object_type': 'user',
      'notion.user_id': user.id,
    },
  };
}
