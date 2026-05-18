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
    || compareDigestStrings(left.id ?? '', right.id ?? '')
    || compareDigestStrings(digestEventPath(left), digestEventPath(right))
  );
}

function compareDigestStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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
  if (path.includes('/searches/')) return `search ${recordId(path, 'directory')}`;
  if (path.includes('/posts/')) return `post ${recordId(path, 'flat')}`;
  if (path.includes('/users/')) return `user ${recordId(path, 'flat')}`;
  return recordBasename(path);
}

function recordId(path: string, shape: 'directory' | 'flat'): string {
  const basename = recordBasename(path);
  const separatorIndex = basename.indexOf('__');
  if (separatorIndex <= 0) return basename;
  return shape === 'directory' ? basename.slice(0, separatorIndex) : basename.slice(separatorIndex + 2);
}

function recordBasename(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const segment = segments.at(-1) === 'meta.json' ? segments.at(-2) : segments.at(-1);
  return (segment ?? path).replace(/\.[^.]+$/u, '');
}

const ACTION_VERB_PATTERN_1 = actionVerbRegex('search|searched|run|ran');
const ACTION_VERB_PATTERN_2 = actionVerbRegex('create|created|add|added|write|written');
const ACTION_VERB_PATTERN_3 = actionVerbRegex('close|closed');
const ACTION_VERB_PATTERN_4 = actionVerbRegex('merge|merged');
const ACTION_VERB_PATTERN_5 = actionVerbRegex('archive|archived');
const ACTION_VERB_PATTERN_6 = actionVerbRegex('complete|completed');
const ACTION_VERB_PATTERN_7 = actionVerbRegex('cancel|canceled|cancelled');
const ACTION_VERB_PATTERN_8 = actionVerbRegex('resolve|resolved');
const ACTION_VERB_PATTERN_9 = actionVerbRegex('delete|deleted|remove|removed');

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (hasActionVerb(action, ACTION_VERB_PATTERN_1)) {
    return 'ran';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_2)) {
    return 'was created';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_3)) {
    return 'was closed';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_4)) {
    return 'was merged';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_5)) {
    return 'was archived';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_6)) {
    return 'was completed';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_7)) {
    return 'was canceled';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_8)) {
    return 'was resolved';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_9)) {
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
