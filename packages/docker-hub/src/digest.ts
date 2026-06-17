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
  provider: 'docker-hub',
  identify: (canonicalPath) => dockerHubIdentifier(canonicalPath),
  alias: {
    mode: 'any',
    segments: ['by-id', 'by-namespace', 'by-repository'],
  },
  acceptEvent: (_event, canonicalPath) => isCanonicalDockerHubRecordPath(canonicalPath),
  actionRules: [
    { verbs: 'delete|deleted|remove|removed', pastTense: 'was deleted' },
    { verbs: 'create|created|add|added|write|written', pastTense: 'was created' },
    { verbs: 'push|pushed|image_push|image-push', pastTense: 'was updated' },
  ],
  defaultPastTense: 'was updated',
});

function isCanonicalDockerHubRecordPath(path: string): boolean {
  return /^docker-hub\/repositories\/[^/]+\/[^/]+\.json$/u.test(path)
    || /^docker-hub\/repositories\/[^/]+\/[^/]+\/tags\/[^/]+\.json$/u.test(path)
    || /^docker-hub\/repositories\/[^/]+\/[^/]+\/webhooks\/[^/]+\.json$/u.test(path);
}

function normalizeDigestPath(path: string): string {
  return path.replace(/^\/+/u, '');
}

function dockerHubIdentifier(path: string): string {
  const segments = normalizeDigestPath(path).split('/').filter(Boolean);
  const namespace = decodePathPart(segments[2] ?? '');
  const repository = decodeRecordLeaf(segments[3] ?? '');
  if (segments[4] === 'tags') {
    return `tag ${namespace}/${repository}:${decodeRecordLeaf(segments[5] ?? '')}`;
  }
  if (segments[4] === 'webhooks') {
    return `webhook ${namespace}/${repository}/${decodeRecordLeaf(segments[5] ?? '')}`;
  }
  if (segments[1] === 'repositories') {
    return `repository ${namespace}/${repository}`;
  }
  return decodeRecordLeaf(segments.at(-1) ?? path);
}

function decodeRecordLeaf(segment: string): string {
  return decodePathPart(segment).replace(/\.[^.]+$/u, '');
}

function decodePathPart(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
