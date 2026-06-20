import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from '@relayfile/adapter-core/digest';

export type {
  DigestBullet,
  DigestChangeEvent,
  DigestContext,
  DigestHandler,
  DigestSection,
  DigestWindow,
};

export const digest: DigestHandler = createDigestHandler({
  provider: 'telegram',
  identify: telegramIdentifier,
  actionRules: [
    { verbs: 'create|created|add|added|write|written|send|sent|post|posted', pastTense: 'was captured' },
    { verbs: 'edit|edited|update|updated', pastTense: 'was updated' },
    { verbs: 'react|reacted|reaction', pastTense: 'had a reaction update' },
    { verbs: 'delete|deleted|remove|removed', pastTense: 'was deleted' },
  ],
});

function telegramIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const tail = segments.at(-1);
  const stem =
    tail === 'meta.json'
      ? segments.at(-2) ?? path
      : tail?.replace(/\.json$/u, '') ?? path;
  const id = stem.includes('__') ? stem.slice(0, stem.lastIndexOf('__')) : stem;

  if (path.includes('/messages/')) return `message ${id}`;
  if (path.includes('/callback-queries/')) return `callback ${id}`;
  if (path.includes('/inline-queries/')) return `inline query ${id}`;
  if (path.includes('/chats/')) return `chat ${id}`;
  if (path.includes('/updates/')) return `update ${id}`;
  return id;
}
