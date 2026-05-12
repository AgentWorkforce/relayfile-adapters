import { createHash } from 'node:crypto';

const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const MAX_ALIAS_SLUG_LENGTH = 80;

/**
 * Slugify a display name for use as an alias filename (e.g. `by-name/<slug>.json`).
 *
 * Rules:
 *  - NFKD-normalize and strip combining marks so accented characters fold to ASCII.
 *  - Lowercase, replace any run of non-alphanumerics with a single `-`.
 *  - Truncate to {@link MAX_ALIAS_SLUG_LENGTH}.
 *  - Falls back to `'untitled'` if the input has no slug-able characters.
 */
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
 * Short deterministic suffix derived from an id, for disambiguating two records
 * that slug to the same alias filename (e.g. two users named "Sam").
 */
export function aliasCollisionSuffix(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}
