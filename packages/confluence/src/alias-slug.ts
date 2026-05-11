import { createHash } from 'node:crypto';

const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const MAX_ALIAS_SLUG_LENGTH = 80;

/**
 * Mirror of the Linear alias slugifier so Confluence emits identical
 * `<sanitized>__<id>` and `by-title/<slug>.json` conventions advertised in
 * `/confluence/LAYOUT.md`. Returns `untitled` when the input slugs to nothing
 * (emoji-only / punctuation-only titles).
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

export function aliasCollisionSuffix(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}
