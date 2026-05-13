import { createHash } from 'node:crypto';

const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const MAX_ALIAS_SLUG_LENGTH = 80;

export function slugifyAlias(input: string): string {
  return normalizeAliasSlug(input) || 'untitled';
}

export function hasAliasSlug(input: string): boolean {
  return normalizeAliasSlug(input).length > 0;
}

function normalizeAliasSlug(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_ALIAS_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');

  return normalized;
}

export function aliasCollisionSuffix(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}
