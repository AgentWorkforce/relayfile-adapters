import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from "@relayfile/adapter-core";

export type {
  DigestBullet,
  DigestChangeEvent,
  DigestContext,
  DigestHandler,
  DigestSection,
  DigestWindow,
};

export const digest: DigestHandler = createDigestHandler({
  provider: "google-drive",
  identify: (canonicalPath, event) => googleDriveIdentifier(canonicalPath, event),
  alias: { segments: [] },
  acceptEvent: (event) => hasDigestPath(event),
  classify: (event) => pastTense(event),
});

function hasDigestPath(event: DigestChangeEvent): boolean {
  return (
    typeof digestEventPath(event) === 'string'
    && isCanonicalDigestPath(digestEventPath(event))
    && (digestEventPath(event) === 'google-drive' || digestEventPath(event) === '/google-drive' || digestEventPath(event).startsWith('google-drive/') || digestEventPath(event).startsWith('/google-drive/'))
  );
}

function isCanonicalDigestPath(path: string): boolean {
  const segments = normalizeDigestPath(path).split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? '';
  return leaf !== 'LAYOUT.md'
    && leaf !== '_index.json'
    && !hasDigestAliasDirectory(segments);
}

const DIGEST_ALIAS_PROVIDER_SEGMENTS = new Set([
  'asana',
  'clickup',
  'confluence',
  'github',
  'gitlab',
  'jira',
  'linear',
  'notion',
  'slack',
]);

const DIGEST_ALIAS_SEGMENTS = new Set([
  'by-assignee',
  'by-creator',
  'by-database',
  'by-id',
  'by-key',
  'by-name',
  'by-parent',
  'by-priority',
  'by-ref',
  'by-space',
  'by-state',
  'by-status',
  'by-title',
  'by-uuid',
]);

const DIGEST_ALIAS_PARENT_SEGMENTS = new Set([
  'channels',
  'commits',
  'databases',
  'deployments',
  'issues',
  'pages',
  'pipelines',
  'projects',
  'pulls',
  'sprints',
  'spaces',
  'tags',
  'tasks',
  'teams',
  'users',
]);

function hasDigestAliasDirectory(segments: readonly string[]): boolean {
  const provider = segments[0] ?? '';
  if (!DIGEST_ALIAS_PROVIDER_SEGMENTS.has(provider)) return false;

  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const parent = segments[index - 1];
    if (segment && parent && DIGEST_ALIAS_SEGMENTS.has(segment) && DIGEST_ALIAS_PARENT_SEGMENTS.has(parent)) {
      return true;
    }
  }
  return false;
}

function compareEvents(left: DigestChangeEvent, right: DigestChangeEvent): number {
  const leftMs = eventTimeMs(left);
  const rightMs = eventTimeMs(right);
  return (
    leftMs - rightMs
    || compareDigestStrings(left.id ?? '', right.id ?? '')
    || compareDigestStrings(digestEventPath(left) ?? '', digestEventPath(right) ?? '')
  );
}

function compareDigestStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function eventTime(event: DigestChangeEvent): string {
  return event.timestamp ?? event.occurredAt ?? '';
}

function eventTimeMs(event: DigestChangeEvent): number {
  const raw = eventTime(event);
  if (!raw) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function digestEventPath(event: DigestChangeEvent): string {
  return event.canonicalPath ?? event.path ?? '';
}

function normalizeDigestPath(path: string): string {
  return path.replace(/^\/+/u, '');
}

function googleDriveIdentifier(path: string, event?: DigestChangeEvent): string {
  const segments = path.split('/').filter(Boolean);
  const leaf = segments[2] ?? path;
  const wrapperName = segments[1] === 'files' && segments.length === 3
    ? googleDriveWrapperName(event, leaf)
    : null;
  if (wrapperName) {
    return `file ${wrapperName}`;
  }
  // Skip provider prefix and account to get the file path
  const file = segments.length > 2 ? segments.slice(2).join('/') : segments.at(-1) ?? path;
  return `file ${file}`;
}

function googleDriveWrapperName(event: DigestChangeEvent | undefined, leaf: string): string | null {
  const content = event?.content;
  const id = decodePathLeafId(leaf);
  if (!(
    isRecord(content)
    && content.id === id
    && (
      typeof content.name === 'string'
      || typeof content.mimeType === 'string'
      || Array.isArray(content.parents)
      || typeof content.webViewLink === 'string'
    )
  )) {
    return null;
  }
  const name = typeof content.name === 'string' ? content.name.trim() : '';
  if (!name || name === id) return null;
  return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodePathLeafId(leaf: string): string {
  const raw = leaf.replace(/\.json$/u, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const ACTION_VERB_PATTERN_1 = actionVerbRegex('create|created|upload|uploaded|write|written|add|added');
const ACTION_VERB_PATTERN_2 = actionVerbRegex('trash|trashed');
const ACTION_VERB_PATTERN_3 = actionVerbRegex('delete|deleted|remove|removed');
const ACTION_VERB_PATTERN_4 = actionVerbRegex('move|moved|rename|renamed');

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (hasActionVerb(action, ACTION_VERB_PATTERN_1)) {
    return 'was created';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_2)) {
    return 'was trashed';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_3)) {
    return 'was deleted';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_4)) {
    return 'was moved';
  }
  return 'was modified';
}

function actionVerbRegex(verbs: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])(${verbs})([^a-z0-9]|$)`, 'u');
}

function hasActionVerb(action: string, pattern: RegExp): boolean {
  return pattern.test(action);
}
