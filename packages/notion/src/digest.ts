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
        text: `${notionIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasCanonicalPath(event: DigestChangeEvent): event is DigestChangeEvent & { canonicalPath: string } {
  return (
    typeof event.canonicalPath === 'string'
    && (event.canonicalPath === 'notion' || event.canonicalPath.startsWith('notion/') || event.canonicalPath.startsWith('/notion/'))
  );
}

function compareEvents(left: DigestChangeEvent, right: DigestChangeEvent): number {
  return (
    eventTime(left).localeCompare(eventTime(right))
    || (left.id ?? '').localeCompare(right.id ?? '')
    || (left.canonicalPath ?? '').localeCompare(right.canonicalPath ?? '')
  );
}

function eventTime(event: DigestChangeEvent): string {
  return event.timestamp ?? event.occurredAt ?? '';
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

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (/(create|created|add|added|write|written)/u.test(action)) {
    return 'was created';
  }
  if (/(delete|deleted|remove|removed|archive|archived)/u.test(action)) {
    return 'was archived';
  }
  return 'was updated';
}
