export interface DigestWindow {
  readonly from: string;
  readonly to: string;
}

export interface DigestChangeEvent {
  readonly id?: string;
  readonly timestamp?: string;
  readonly occurredAt?: string;
  readonly eventType?: string;
  readonly type?: string;
  readonly action?: string;
  readonly canonicalPath?: string;
  readonly path?: string;
}

export interface DigestContext {
  readonly provider: string;
  readonly window: DigestWindow;
  changeEvents(filter?: {
    providers?: string[];
    paths?: string[];
  }): Promise<readonly DigestChangeEvent[]>;
}

export interface DigestBullet {
  readonly text: string;
  readonly canonicalPath: string;
}

export interface DigestSection {
  readonly provider: string;
  readonly bullets: readonly DigestBullet[];
}

export type DigestHandler = (ctx: DigestContext) => Promise<DigestSection | null>;

export const digest: DigestHandler = async (ctx) => {
  const events = await ctx.changeEvents({ providers: [ctx.provider] });
  const bullets = events
    .filter(hasDigestPath)
    .slice()
    .sort(compareEvents)
    .map((event) => {
      const canonicalPath = normalizeDigestPath(digestEventPath(event));
      return {
        text: `${notionIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasDigestPath(event: DigestChangeEvent): boolean {
  return (
    typeof digestEventPath(event) === 'string'
    && isCanonicalDigestPath(digestEventPath(event))
    && (
      digestEventPath(event) === 'notion'
      || digestEventPath(event) === '/notion'
      || digestEventPath(event).startsWith('notion/')
      || digestEventPath(event).startsWith('/notion/')
    )
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
  if (provider === 'notion') return hasNotionAliasDirectory(segments);

  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const parent = segments[index - 1];
    if (segment && parent && DIGEST_ALIAS_SEGMENTS.has(segment) && DIGEST_ALIAS_PARENT_SEGMENTS.has(parent)) {
      return true;
    }
  }
  return false;
}

const NOTION_DATABASE_ALIAS_SEGMENTS = new Set([
  'by-id',
  'by-title',
]);

const NOTION_PAGE_ALIAS_SEGMENTS = new Set([
  'by-database',
  'by-id',
  'by-parent',
  'by-title',
]);

const NOTION_USER_ALIAS_SEGMENTS = new Set([
  'by-id',
  'by-name',
]);

const NOTION_PAGE_CONTENT_LEAVES = new Set([
  'blocks',
  'comments.json',
  'content.md',
  'page.md',
]);

function hasNotionAliasDirectory(segments: readonly string[]): boolean {
  if (segments[0] !== 'notion') return false;

  if (segments[1] === 'databases') {
    const alias = segments[2];
    return Boolean(
      alias
      && NOTION_DATABASE_ALIAS_SEGMENTS.has(alias)
      && segments[3] !== 'metadata.json'
      && segments[3] !== 'pages',
    );
  }

  if (segments[1] === 'pages') {
    const alias = segments[2];
    return Boolean(
      alias
      && NOTION_PAGE_ALIAS_SEGMENTS.has(alias)
      && !NOTION_PAGE_CONTENT_LEAVES.has(segments[3] ?? ''),
    );
  }

  if (segments[1] === 'users') {
    const alias = segments[2];
    return Boolean(alias && NOTION_USER_ALIAS_SEGMENTS.has(alias));
  }

  return false;
}

function compareEvents(left: DigestChangeEvent, right: DigestChangeEvent): number {
  // Compare parsed timestamps in ms rather than ISO strings: lexicographic
  // string compare misorders events whose timestamps describe the same
  // instant with different textual offsets (e.g. `Z` vs `+00:00`).
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

function notionIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const segment = segments.at(-1) === 'page.md' || segments.at(-1) === 'content.md'
    ? segments.at(-2) ?? path
    : segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, '');
  const separatorIndex = basename.lastIndexOf('__');
  return separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;
}

const ACTION_VERB_PATTERN_1 = actionVerbRegex('create|created|add|added|write|written');
const ACTION_VERB_PATTERN_2 = actionVerbRegex('archive|archived');
const ACTION_VERB_PATTERN_3 = actionVerbRegex('delete|deleted|remove|removed');

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (hasActionVerb(action, ACTION_VERB_PATTERN_1)) {
    return 'was created';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_2)) {
    return 'was archived';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_3)) {
    return 'was deleted';
  }
  return 'was updated';
}

function actionVerbRegex(verbs: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])(${verbs})([^a-z0-9]|$)`, 'u');
}

function hasActionVerb(action: string, pattern: RegExp): boolean {
  return pattern.test(action);
}
