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
    .filter(hasCanonicalPath)
    .slice()
    .sort(compareEvents)
    .map((event) => {
      const canonicalPath = normalizeDigestPath(event.canonicalPath);
      return {
        text: `${linearIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasCanonicalPath(event: DigestChangeEvent): event is DigestChangeEvent & { canonicalPath: string } {
  return (
    typeof event.canonicalPath === 'string'
    && (event.canonicalPath === 'linear' || event.canonicalPath.startsWith('linear/') || event.canonicalPath.startsWith('/linear/'))
  );
}

function compareEvents(left: DigestChangeEvent, right: DigestChangeEvent): number {
  // Compare parsed timestamps in ms rather than ISO strings: lexicographic
  // string compare misorders events whose timestamps describe the same
  // instant with different textual offsets (e.g. `Z` vs `+00:00`).
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

function linearIdentifier(path: string): string {
  const segment = path.split('/').filter(Boolean).at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, '');
  const separatorIndex = basename.lastIndexOf('__');
  return separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;
}

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (/(create|created|open|opened|add|added|write|written)/u.test(action)) {
    return 'was created';
  }
  if (/(delete|deleted|remove|removed)/u.test(action)) {
    return 'was deleted';
  }
  if (/(close|closed|resolve|resolved|cancel|canceled)/u.test(action)) {
    return 'was closed';
  }
  return 'was updated';
}
