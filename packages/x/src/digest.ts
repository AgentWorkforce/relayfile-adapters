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
        text: `${xIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasDigestPath(event: DigestChangeEvent): boolean {
  const path = digestEventPath(event);
  return (
    typeof path === 'string'
    && isCanonicalDigestPath(path)
    && (
      digestEventPath(event) === 'x'
      || digestEventPath(event) === '/x'
      || digestEventPath(event).startsWith('x/')
      || digestEventPath(event).startsWith('/x/')
    )
  );
}

function isCanonicalDigestPath(path: string): boolean {
  const segments = normalizeDigestPath(path).split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? '';
  return leaf !== 'LAYOUT.md'
    && leaf !== '_index.json'
    && !segments.includes('by-id')
    && !segments.includes('by-query')
    && !segments.includes('by-author')
    && !segments.includes('by-conversation')
    && !segments.includes('by-username')
    && !segments.includes('results');
}

function compareEvents(left: DigestChangeEvent, right: DigestChangeEvent): number {
  const leftMs = eventTimeMs(left);
  const rightMs = eventTimeMs(right);
  return (
    leftMs - rightMs
    || (left.id ?? '').localeCompare(right.id ?? '')
    || digestEventPath(left).localeCompare(digestEventPath(right))
  );
}

function eventTimeMs(event: DigestChangeEvent): number {
  const raw = event.timestamp ?? event.occurredAt ?? '';
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

function xIdentifier(path: string): string {
  if (path.includes('/searches/')) return `search ${recordBasename(path)}`;
  if (path.includes('/posts/')) return `post ${recordBasename(path)}`;
  if (path.includes('/users/')) return `user ${recordBasename(path)}`;
  return recordBasename(path);
}

function recordBasename(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const segment = segments.at(-1) === 'meta.json' ? segments.at(-2) : segments.at(-1);
  return (segment ?? path).replace(/\.[^.]+$/u, '');
}

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (hasActionVerb(action, 'search|searched|run|ran')) {
    return 'ran';
  }
  if (hasActionVerb(action, 'create|created|add|added|write|written')) {
    return 'was created';
  }
  if (hasActionVerb(action, 'delete|deleted|remove|removed')) {
    return 'was deleted';
  }
  return 'was updated';
}

function hasActionVerb(action: string, verbs: string): boolean {
  return new RegExp(`(^|[^a-z0-9])(${verbs})([^a-z0-9]|$)`, 'u').test(action);
}
