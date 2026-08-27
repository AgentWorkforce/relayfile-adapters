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
  provider: 'ramp',
  identify: rampIdentifier,
  alias: {
    mode: 'any',
    segments: [
      'by-email',
      'by-id',
      'by-invoice-number',
      'by-merchant',
      'by-name',
      'by-number',
      'by-purchase-order',
      'by-receipt-status',
      'by-reimbursement',
      'by-renewal-status',
      'by-state',
      'by-status',
      'by-transaction',
      'by-user',
      'by-vendor',
    ],
  },
  actionRules: [
    { verbs: 'create|created|open|opened|add|added|write|written', pastTense: 'was created' },
    { verbs: 'approve|approved', pastTense: 'was approved' },
    { verbs: 'pay|paid', pastTense: 'was paid' },
    { verbs: 'reimburse|reimbursed', pastTense: 'was reimbursed' },
    { verbs: 'archive|archived', pastTense: 'was archived' },
    { verbs: 'delete|deleted|remove|removed', pastTense: 'was deleted' },
    { verbs: 'reject|rejected|decline|declined', pastTense: 'was rejected' },
    { verbs: 'close|closed|resolve|resolved', pastTense: 'was closed' },
    { verbs: 'cancel|canceled|cancelled', pastTense: 'was canceled' },
  ],
});

function rampIdentifier(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const segments = normalized.split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? path;

  if (leaf === 'meta.json') {
    const directory = segments.at(-2) ?? '';
    const separatorIndex = directory.indexOf('__');
    return separatorIndex > 0 ? directory.slice(separatorIndex + 2) : directory;
  }

  const basename = leaf.replace(/\.[^.]+$/u, '');
  const separatorIndex = basename.lastIndexOf('__');
  return separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;
}
