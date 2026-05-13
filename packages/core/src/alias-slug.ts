import { createHash } from 'node:crypto';

const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const MAX_ALIAS_SLUG_LENGTH = 80;

export function slugifyAlias(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length <= MAX_ALIAS_SLUG_LENGTH) {
    return normalized || 'untitled';
  }

  const head = normalized.slice(0, MAX_ALIAS_SLUG_LENGTH);
  const boundary = head.lastIndexOf('-');
  const truncated = (boundary > 0 ? head.slice(0, boundary) : head).replace(/-+$/g, '');

  return truncated || 'untitled';
}

export function aliasCollisionSuffix(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}
