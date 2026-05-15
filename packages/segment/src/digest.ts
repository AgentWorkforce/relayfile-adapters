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

/**
 * Segment is an append-only event adapter. Records are immutable once
 * written — there is no delete or terminal lifecycle state. The digest
 * surfaces created and upserted events so agents can see new activity.
 */
export const digest: DigestHandler = async (ctx) => {
  const events = await ctx.changeEvents({ providers: [ctx.provider] });
  const bullets = events
    .filter(hasCanonicalPath)
    .slice()
    .sort(compareEvents)
    .map((event) => {
      const canonicalPath = normalizeDigestPath(event.canonicalPath);
      return {
        text: `${segmentIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasCanonicalPath(event: DigestChangeEvent): event is DigestChangeEvent & { canonicalPath: string } {
  return (
    typeof event.canonicalPath === 'string'
    && (event.canonicalPath === 'segment' || event.canonicalPath === '/segment' || event.canonicalPath.startsWith('segment/') || event.canonicalPath.startsWith('/segment/'))
  );
}

function compareEvents(left: DigestChangeEvent, right: DigestChangeEvent): number {
  const leftMs = eventTimeMs(left);
  const rightMs = eventTimeMs(right);
  return (
    leftMs - rightMs
    || (left.id ?? '').localeCompare(right.id ?? '')
    || (left.canonicalPath ?? '').localeCompare(right.canonicalPath ?? '')
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

function normalizeDigestPath(path: string): string {
  return path.replace(/^\/+/u, '');
}

function segmentIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const segment = segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, '');
  const separatorIndex = basename.lastIndexOf('--');
  const label = separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;

  if (path.includes('/identify/')) return `identify ${label}`;
  if (path.includes('/track/')) return `track ${label}`;
  if (path.includes('/page/')) return `page ${label}`;
  if (path.includes('/groups/')) return `group ${label}`;
  return label;
}

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (hasActionVerb(action, 'create|created|add|added|write|written')) {
    return 'was created';
  }
  if (hasActionVerb(action, 'upsert|upserted')) {
    return 'was upserted';
  }
  return 'was updated';
}

function hasActionVerb(action: string, verbs: string): boolean {
  // Safe: all call sites pass static verb lists with simple alternation.
  return new RegExp(`(^|[^a-z0-9])(${verbs})([^a-z0-9]|$)`, 'u').test(action);
}
