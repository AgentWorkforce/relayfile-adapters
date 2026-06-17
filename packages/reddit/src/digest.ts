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
  provider: 'reddit',
  identify: (canonicalPath) => redditIdentifier(canonicalPath),
  alias: {
    mode: 'any',
    segments: ['by-id', 'by-status'],
  },
  acceptEvent: (_event, canonicalPath) => isCanonicalRedditRecordPath(canonicalPath),
  actionRules: [
    { verbs: 'create|created|add|added|write|written', pastTense: 'was created' },
    { verbs: 'archive|archived', pastTense: 'was archived' },
    { verbs: 'lock|locked', pastTense: 'was locked' },
    { verbs: 'remove|removed', pastTense: 'was removed' },
    { verbs: 'delete|deleted', pastTense: 'was deleted' },
  ],
  defaultPastTense: 'was updated',
});

function isCanonicalRedditRecordPath(path: string): boolean {
  return /^reddit\/subreddits\/[^/]+\.json$/u.test(path)
    || /^reddit\/subreddits\/[^/]+\/posts\/[^/]+\.json$/u.test(path);
}

function normalizeDigestPath(path: string): string {
  return path.replace(/^\/+/, '');
}

function redditIdentifier(path: string): string {
  const segments = normalizeDigestPath(path).split('/').filter(Boolean);
  if (segments[1] === 'subreddits' && segments[3] === 'posts') {
    return `post r/${decodePart(segments[2] ?? '')}/${decodeLeaf(segments[4] ?? '')}`;
  }
  if (segments[1] === 'subreddits') {
    return `subreddit r/${decodeLeaf(segments[2] ?? '')}`;
  }
  return decodeLeaf(segments.at(-1) ?? path);
}

function decodeLeaf(segment: string): string {
  return decodePart(segment).replace(/\.[^.]+$/u, '');
}

function decodePart(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
