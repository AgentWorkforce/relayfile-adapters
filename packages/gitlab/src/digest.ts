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
        text: `${gitLabIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasCanonicalPath(event: DigestChangeEvent): event is DigestChangeEvent & { canonicalPath: string } {
  return (
    typeof event.canonicalPath === 'string'
    && (event.canonicalPath === 'gitlab' || event.canonicalPath.startsWith('gitlab/') || event.canonicalPath.startsWith('/gitlab/'))
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

function gitLabIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const terminal = segments.at(-1);
  const segment = terminal === 'meta.json' || terminal === 'metadata.json'
    ? segments.at(-2) ?? path
    : terminal ?? path;
  const basename = segment.replace(/\.[^.]+$/u, '');
  const separatorIndex = basename.indexOf('__');
  const id = separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;

  if (path.includes('/merge_requests/')) return `MR !${id}`;
  if (path.includes('/issues/')) return `issue #${id}`;
  if (path.includes('/pipelines/')) return `pipeline #${id}`;
  if (path.includes('/commits/')) return `commit ${id.slice(0, 12)}`;
  return id;
}

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (/\b(open|opened|create|created|add|added|write|written)\b/u.test(action)) {
    return 'was opened';
  }
  if (/\b(merge|merged)\b/u.test(action)) {
    return 'was merged';
  }
  if (/\b(success|succeeded)\b/u.test(action)) {
    return 'succeeded';
  }
  if (/\b(close|closed)\b/u.test(action)) {
    return 'was closed';
  }
  if (/\b(delete|deleted|remove|removed)\b/u.test(action)) {
    return 'was deleted';
  }
  return 'was updated';
}
