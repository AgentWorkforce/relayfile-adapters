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
        text: `${gitLabIdentifier(canonicalPath)} ${pastTense(event)}`,
        canonicalPath,
      };
    });

  return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
};

function hasDigestPath(event: DigestChangeEvent): boolean {
  return (
    typeof digestEventPath(event) === 'string'
    && isCanonicalDigestPath(digestEventPath(event))
    && (digestEventPath(event) === 'gitlab' || digestEventPath(event) === '/gitlab' || digestEventPath(event).startsWith('gitlab/') || digestEventPath(event).startsWith('/gitlab/'))
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
  if (provider === 'gitlab') return hasGitLabAliasDirectory(segments);

  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const parent = segments[index - 1];
    if (segment && parent && DIGEST_ALIAS_SEGMENTS.has(segment) && DIGEST_ALIAS_PARENT_SEGMENTS.has(parent)) {
      return true;
    }
  }
  return false;
}

const GITLAB_RESOURCE_SEGMENTS = new Set([
  'commits',
  'deployments',
  'files',
  'issues',
  'merge_requests',
  'pipelines',
  'snippets',
  'tags',
]);

const GITLAB_ALIAS_RESOURCE_SEGMENTS = new Set([
  'commits',
  'deployments',
  'issues',
  'merge_requests',
  'pipelines',
  'tags',
]);

function hasGitLabAliasDirectory(segments: readonly string[]): boolean {
  if (segments[0] !== 'gitlab' || segments[1] !== 'projects') return false;

  for (let index = 2; index < segments.length - 1; index += 1) {
    if (isGitLabAliasAt(segments, index)) return true;
  }
  return false;
}

type GitLabResourceSegment = 'commits' | 'deployments' | 'files' | 'issues' | 'merge_requests' | 'pipelines' | 'snippets' | 'tags';

function gitLabResourceSegmentIndex(segments: readonly string[]): number {
  for (let index = segments.length - 2; index >= 2; index -= 1) {
    const segment = segments[index];
    if (segment && GITLAB_RESOURCE_SEGMENTS.has(segment)) {
      return index;
    }
  }
  return -1;
}

function gitLabResourceSegment(segments: readonly string[]): GitLabResourceSegment | undefined {
  const index = gitLabResourceSegmentIndex(segments);
  if (index >= 0) return segments[index] as GitLabResourceSegment;
  return undefined;
}

function isGitLabAliasAt(segments: readonly string[], resourceIndex: number): boolean {
  const resource = segments[resourceIndex];
  const alias = segments[resourceIndex + 1];
  if (!resource || !GITLAB_ALIAS_RESOURCE_SEGMENTS.has(resource) || !alias) {
    return false;
  }

  if (alias === 'by-state' || alias === 'by-assignee' || alias === 'by-creator' || alias === 'by-priority' || alias === 'by-status') {
    return segments.length === resourceIndex + 4;
  }

  if (alias === 'by-id' || alias === 'by-title' || alias === 'by-ref') {
    return segments.length === resourceIndex + 3;
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

function gitLabIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const resource = gitLabResourceSegment(segments);
  const terminal = segments.at(-1);
  const segment = terminal === 'meta.json' || terminal === 'metadata.json'
    ? segments.at(-2) ?? path
    : terminal ?? path;
  const basename = segment.replace(/\.[^.]+$/u, '');
  const id = gitLabRecordId(resource, basename);

  if (resource === 'merge_requests') return `MR !${id}`;
  if (resource === 'issues') return `issue #${id}`;
  if (resource === 'pipelines') return `pipeline #${id}`;
  if (resource === 'commits') return `commit ${id.slice(0, 12)}`;
  if (resource === 'deployments') return `deployment #${id}`;
  if (resource === 'files') return `file ${id}`;
  if (resource === 'snippets') return `snippet ${id}`;
  if (resource === 'tags') return `tag ${id}`;
  return id;
}

function gitLabRecordId(resource: GitLabResourceSegment | undefined, basename: string): string {
  const separatorIndex = basename.indexOf('__');
  if (separatorIndex <= 0) return basename;

  if (resource === 'deployments' || resource === 'files' || resource === 'tags') {
    return resource === 'files' ? basename : basename.slice(separatorIndex + 2);
  }
  return basename.slice(0, separatorIndex);
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
  if (/\b(fail|failed)\b/u.test(action)) {
    return 'failed';
  }
  if (/\b(skip|skipped)\b/u.test(action)) {
    return 'was skipped';
  }
  if (/\b(cancel|canceled|cancelled)\b/u.test(action)) {
    return 'was canceled';
  }
  if (/\b(close|closed)\b/u.test(action)) {
    return 'was closed';
  }
  if (/\b(delete|deleted|remove|removed)\b/u.test(action)) {
    return 'was deleted';
  }
  return 'was updated';
}
