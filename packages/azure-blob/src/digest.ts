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
        text: `${azureBlobIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasCanonicalPath(event: DigestChangeEvent): event is DigestChangeEvent & { canonicalPath: string } {
  return (
    typeof event.canonicalPath === 'string'
    && (event.canonicalPath === 'azure-blob' || event.canonicalPath === '/azure-blob' || event.canonicalPath.startsWith('azure-blob/') || event.canonicalPath.startsWith('/azure-blob/'))
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

function azureBlobIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  // Skip provider prefix, account, container to get the blob name
  const blob = segments.length > 3 ? segments.slice(3).join('/') : segments.at(-1) ?? path;
  return `blob ${blob.replace(/\.json$/u, '')}`;
}

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (matchVerb(action, 'create|created|put|upload|uploaded|write|written')) {
    return 'was uploaded';
  }
  if (matchVerb(action, 'copy|copied|snapshot|snapshotted')) {
    return 'was copied';
  }
  if (matchVerb(action, 'archive|archived|tier|tiered')) {
    return 'was archived';
  }
  if (matchVerb(action, 'delete|deleted|remove|removed')) {
    return 'was deleted';
  }
  return 'was modified';
}

function matchVerb(action: string, verbs: string): boolean {
  // Azure Blob events use camelCase (e.g. BlobCreated, BlobDeleted) where
  // verbs are not at word boundaries. Check both boundary-delimited and
  // substring matches.
  return verbs.split('|').some((v) => action.includes(v));
}
