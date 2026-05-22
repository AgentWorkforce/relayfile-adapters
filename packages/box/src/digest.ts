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
  provider: "box",
  identify: (canonicalPath) => boxIdentifier(canonicalPath),
  alias: { segments: [] },
  acceptEvent: (event) => hasDigestPath(event),
  classify: (event) => pastTense(event),
});

function hasDigestPath(event: DigestChangeEvent): boolean {
  return (
    typeof digestEventPath(event) === 'string'
    && isCanonicalDigestPath(digestEventPath(event))
    && (digestEventPath(event) === 'box' || digestEventPath(event) === '/box' || digestEventPath(event).startsWith('box/') || digestEventPath(event).startsWith('/box/'))
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

function boxIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const segment = segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, '');
  const separatorIndex = basename.lastIndexOf('__');
  return `file ${separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename}`;
}

const ACTION_VERB_PATTERN_1 = actionVerbRegex('unlock|unlocked');
const ACTION_VERB_PATTERN_2 = actionVerbRegex('lock|locked');
const ACTION_VERB_PATTERN_3 = actionVerbRegex('create|created|upload|uploaded|write|written|add|added');
const ACTION_VERB_PATTERN_4 = actionVerbRegex('copy|copied');
const ACTION_VERB_PATTERN_5 = actionVerbRegex('move|moved|rename|renamed');
const ACTION_VERB_PATTERN_6 = actionVerbRegex('trash|trashed');
const ACTION_VERB_PATTERN_7 = actionVerbRegex('delete|deleted|remove|removed');

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  // Check compound actions (lock_create, unlock) before simple create/upload
  // so that LOCK_CREATE is not misclassified as "uploaded".
  if (hasActionVerb(action, ACTION_VERB_PATTERN_1)) {
    return 'was unlocked';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_2)) {
    return 'was locked';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_3)) {
    return 'was uploaded';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_4)) {
    return 'was copied';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_5)) {
    return 'was moved';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_6)) {
    return 'was trashed';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_7)) {
    return 'was deleted';
  }
  return 'was modified';
}

function actionVerbRegex(verbs: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])(${verbs})([^a-z0-9]|$)`, 'u');
}

function hasActionVerb(action: string, pattern: RegExp): boolean {
  return pattern.test(action);
}
