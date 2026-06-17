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
  provider: 'fathom',
  identify: fathomIdentifier,
  alias: {
    mode: 'any',
    segments: [
      'by-assignee',
      'by-created-at',
      'by-day',
      'by-id',
      'by-name',
      'by-owner',
      'by-recording-id',
      'by-status',
      'by-team',
      'by-title',
      'by-uuid',
    ],
  },
  actionRules: [
    { verbs: 'create|created|add|added|write|written', pastTense: 'was created' },
    { verbs: 'delete|deleted|remove|removed', pastTense: 'was deleted' },
    { verbs: 'merge|merged', pastTense: 'was merged' },
    { verbs: 'archive|archived', pastTense: 'was archived' },
    { verbs: 'close|closed', pastTense: 'was closed' },
    { verbs: 'complete|completed|done', pastTense: 'was completed' },
    { verbs: 'cancel|canceled|cancelled', pastTense: 'was canceled' },
    { verbs: 'resolve|resolved', pastTense: 'was resolved' },
  ],
});

function fathomIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? path;
  const basename = leaf.replace(/\.[^.]+$/u, '');

  if (path.includes('/meetings/')) return `meeting ${basename}`;
  if (path.includes('/recordings/') && path.endsWith('/summary.json')) return `recording summary ${segments.at(-2) ?? basename}`;
  if (path.includes('/recordings/') && path.endsWith('/transcript.json')) return `recording transcript ${segments.at(-2) ?? basename}`;
  if (path.includes('/teams/')) return `team ${basename}`;
  if (path.includes('/team-members/')) return `team member ${basename}`;
  return basename;
}
