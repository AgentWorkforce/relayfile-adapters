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
        text: `${s3Identifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasDigestPath(event: DigestChangeEvent): boolean {
  return (
    typeof digestEventPath(event) === 'string'
    && isCanonicalDigestPath(digestEventPath(event))
    && (digestEventPath(event) === 's3' || digestEventPath(event) === '/s3' || digestEventPath(event).startsWith('s3/') || digestEventPath(event).startsWith('/s3/'))
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
    || (left.id ?? '').localeCompare(right.id ?? '')
    || (digestEventPath(left) ?? '').localeCompare(digestEventPath(right) ?? '')
  );
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

function s3Identifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  // Skip provider prefix and bucket to get the object key
  const key = segments.length > 2 ? segments.slice(2).join('/') : segments.at(-1) ?? path;
  return `object ${key.replace(/\.json$/u, '')}`;
}

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (hasActionVerb(action, 'create|created|put|upload|uploaded|write|written')) {
    return 'was uploaded';
  }
  if (hasActionVerb(action, 'objectrestore|restore|restored')) {
    return 'was restored';
  }
  if (hasActionVerb(action, 'copy|copied')) {
    return 'was copied';
  }
  if (hasActionVerb(action, 'delete|deleted|remove|removed')) {
    return 'was deleted';
  }
  return 'was modified';
}

function hasActionVerb(action: string, verbs: string): boolean {
  return new RegExp(`(^|[^a-z0-9])(${verbs})([^a-z0-9]|$)`, 'u').test(action);
}
