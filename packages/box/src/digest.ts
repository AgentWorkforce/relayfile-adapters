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
        text: `${boxIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

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
    && segments.slice(0, -1).every((segment) => !segment.startsWith('by-'));
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

function boxIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const segment = segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, '');
  const separatorIndex = basename.lastIndexOf('__');
  return `file ${separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename}`;
}

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  // Check compound actions (lock_create, unlock) before simple create/upload
  // so that LOCK_CREATE is not misclassified as "uploaded".
  if (hasActionVerb(action, 'unlock|unlocked')) {
    return 'was unlocked';
  }
  if (hasActionVerb(action, 'lock|locked')) {
    return 'was locked';
  }
  if (hasActionVerb(action, 'create|created|upload|uploaded|write|written|add|added')) {
    return 'was uploaded';
  }
  if (hasActionVerb(action, 'copy|copied')) {
    return 'was copied';
  }
  if (hasActionVerb(action, 'move|moved|rename|renamed')) {
    return 'was moved';
  }
  if (hasActionVerb(action, 'trash|trashed')) {
    return 'was trashed';
  }
  if (hasActionVerb(action, 'delete|deleted|remove|removed')) {
    return 'was deleted';
  }
  return 'was modified';
}

function hasActionVerb(action: string, verbs: string): boolean {
  return new RegExp(`(^|[^a-z0-9])(${verbs})([^a-z0-9]|$)`, 'u').test(action);
}
