import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from '@relayfile/adapter-core';

export type {
  DigestBullet,
  DigestChangeEvent,
  DigestContext,
  DigestHandler,
  DigestSection,
  DigestWindow,
};

export const digest: DigestHandler = createDigestHandler({
  provider: 'dropbox',
  identify: dropboxIdentifier,
  alias: {
    mode: 'any',
    segments: [
      'by-id',
      'by-path',
      'by-day',
      'by-status',
      'by-type',
      'by-parent',
    ],
  },
  actionRules: [
    { verbs: 'create|created|add|added|upload|uploaded', pastTense: 'was created' },
    { verbs: 'update|updated|modify|modified|write|written|sync|synced', pastTense: 'was modified' },
    { verbs: 'move|moved|rename|renamed', pastTense: 'was moved' },
    { verbs: 'share|shared', pastTense: 'was shared' },
    { verbs: 'unshare|unshared', pastTense: 'was unshared' },
    { verbs: 'archive|archived', pastTense: 'was archived' },
    { verbs: 'delete|deleted|remove|removed|trash|trashed', pastTense: 'was deleted' },
    { verbs: 'close|closed|complete|completed|resolve|resolved', pastTense: 'was completed' },
  ],
});

function dropboxIdentifier(path: string): string {
  const normalized = path.replace(/^\/+/u, '');
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments.at(-1) ?? 'record';

  if (segments[1] === 'files') {
    const fullPath = segments.slice(2).join('/').replace(/\.json$/u, '');
    return `file ${fullPath || basename}`;
  }
  if (segments[1] === 'folders') {
    const fullPath = segments.slice(2).join('/').replace(/\.json$/u, '');
    return `folder ${fullPath || basename}`;
  }
  if (segments[1] === 'shared-folders') {
    return `shared folder ${basename.replace(/\.json$/u, '')}`;
  }
  if (segments[1] === 'shared-links') {
    return `shared link ${basename.replace(/\.json$/u, '')}`;
  }

  if (segments.length > 2) {
    return `file ${segments.slice(2).join('/')}`;
  }

  return basename;
}
