import { createHash } from 'node:crypto';

const COMBINING_MARKS_PATTERN = /[̀-ͯ]/g;
const MAX_ALIAS_SLUG_LENGTH = 80;

const NOTION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTION_BARE_HEX_PATTERN = /^[0-9a-f]{32}$/i;

export function slugifyAlias(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_ALIAS_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');

  return normalized || 'untitled';
}

/**
 * Stable 8-char short id derived from a Notion UUID. We take the last 8
 * hex characters of the dehyphenated UUID, which is the last 8 chars of
 * the 12-char trailing segment of a canonical UUID. This makes the suffix:
 *
 *   - **Deterministic**: same UUID always produces the same short id.
 *   - **Recomputable**: an agent holding the UUID can derive the alias
 *     filename without round-tripping through the index.
 *   - **Collision-resistant**: 32 bits of UUID entropy. Notion UUIDs are
 *     randomly generated, so collisions across a workspace are vanishingly
 *     rare at typical workspace sizes (thousands of records).
 *
 * For non-UUID ids (synthetic test fixtures, legacy ids that don't match
 * the canonical pattern) we fall back to a sha256-derived 8-char hex,
 * matching the legacy `aliasCollisionSuffix` behavior so existing fixtures
 * keep working.
 */
export function aliasShortId(id: string): string {
  if (NOTION_UUID_PATTERN.test(id)) {
    return id.replace(/-/g, '').toLowerCase().slice(-8);
  }
  if (NOTION_BARE_HEX_PATTERN.test(id)) {
    return id.toLowerCase().slice(-8);
  }
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}

/**
 * Legacy alias collision suffix — sha256(id) truncated to 8 hex chars.
 * Retained for backward compatibility with paths emitted by older
 * versions of the adapter; new code should prefer `aliasShortId`, which
 * derives directly from the UUID and is therefore recomputable by an
 * agent that only holds the canonical id.
 */
export function aliasCollisionSuffix(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}
