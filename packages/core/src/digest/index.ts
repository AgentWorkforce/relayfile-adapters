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

export interface DigestActionRule {
  readonly verbs: string;
  readonly pastTense: string;
}

export interface DigestAliasConfig {
  readonly mode?: "parent-scoped" | "any";
  readonly segments?: readonly string[];
  readonly parentSegments?: readonly string[];
}

export interface CreateDigestHandlerOptions {
  readonly provider?: string;
  readonly pathPrefix?: string;
  readonly identify: (canonicalPath: string) => string;
  readonly actionRules?: readonly DigestActionRule[];
  readonly defaultPastTense?: string;
  readonly alias?: DigestAliasConfig;
}

const DEFAULT_ALIAS_SEGMENTS = new Set([
  "by-assignee",
  "by-creator",
  "by-day",
  "by-database",
  "by-folder",
  "by-id",
  "by-key",
  "by-name",
  "by-parent",
  "by-priority",
  "by-ref",
  "by-space",
  "by-state",
  "by-status",
  "by-title",
  "by-uuid",
]);

const DEFAULT_PARENT_SEGMENTS = new Set([
  "channels",
  "commits",
  "databases",
  "deployments",
  "issues",
  "pages",
  "pipelines",
  "projects",
  "pulls",
  "sprints",
  "spaces",
  "tags",
  "tasks",
  "teams",
  "users",
]);

type CompiledActionRule = {
  readonly regex: RegExp;
  readonly pastTense: string;
};

export function createDigestHandler(options: CreateDigestHandlerOptions): DigestHandler {
  const compiledRules = compileActionRules(options.actionRules ?? []);
  const defaultPastTense = options.defaultPastTense ?? "was updated";
  const aliasMode = options.alias?.mode ?? "parent-scoped";
  const aliasSegments = new Set(options.alias?.segments ?? DEFAULT_ALIAS_SEGMENTS);
  const aliasParents = new Set(options.alias?.parentSegments ?? DEFAULT_PARENT_SEGMENTS);

  return async (ctx: DigestContext) => {
    const provider = options.provider ?? ctx.provider;
    const prefix = normalizeDigestPath(options.pathPrefix ?? provider);
    const events = await ctx.changeEvents({ providers: [ctx.provider] });
    const bullets = events
      .filter((event) =>
        hasDigestPath(event, prefix, provider, aliasMode, aliasSegments, aliasParents),
      )
      .slice()
      .sort(compareEvents)
      .map((event) => {
        const canonicalPath = normalizeDigestPath(digestEventPath(event));
        return {
          text: `${options.identify(canonicalPath)} ${pastTense(event, compiledRules, defaultPastTense)}`,
          canonicalPath,
        };
      });

    return bullets.length === 0 ? null : { provider: ctx.provider, bullets };
  };
}

function hasDigestPath(
  event: DigestChangeEvent,
  prefix: string,
  provider: string,
  aliasMode: "parent-scoped" | "any",
  aliasSegments: ReadonlySet<string>,
  aliasParents: ReadonlySet<string>,
): boolean {
  const eventPath = digestEventPath(event);
  if (!eventPath || !isCanonicalDigestPath(eventPath, provider, aliasMode, aliasSegments, aliasParents)) {
    return false;
  }

  return (
    eventPath === prefix
    || eventPath === `/${prefix}`
    || eventPath.startsWith(`${prefix}/`)
    || eventPath.startsWith(`/${prefix}/`)
  );
}

function isCanonicalDigestPath(
  path: string,
  provider: string,
  aliasMode: "parent-scoped" | "any",
  aliasSegments: ReadonlySet<string>,
  aliasParents: ReadonlySet<string>,
): boolean {
  const segments = normalizeDigestPath(path).split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? "";
  return (
    leaf !== "LAYOUT.md" &&
    leaf !== "_index.json" &&
    !hasDigestAliasDirectory(segments, provider, aliasMode, aliasSegments, aliasParents)
  );
}

function hasDigestAliasDirectory(
  segments: readonly string[],
  provider: string,
  aliasMode: "parent-scoped" | "any",
  aliasSegments: ReadonlySet<string>,
  aliasParents: ReadonlySet<string>,
): boolean {
  if ((segments[0] ?? "") !== provider) return false;

  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!segment || !aliasSegments.has(segment)) continue;
    if (aliasMode === "any") return true;

    const parent = segments[index - 1];
    if (parent && aliasParents.has(parent)) {
      return true;
    }
  }

  return false;
}

function compareEvents(left: DigestChangeEvent, right: DigestChangeEvent): number {
  const leftMs = eventTimeMs(left);
  const rightMs = eventTimeMs(right);
  return (
    leftMs - rightMs ||
    compareDigestStrings(left.id ?? "", right.id ?? "") ||
    compareDigestStrings(digestEventPath(left), digestEventPath(right))
  );
}

function compareDigestStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function eventTime(event: DigestChangeEvent): string {
  return event.timestamp ?? event.occurredAt ?? "";
}

function eventTimeMs(event: DigestChangeEvent): number {
  const raw = eventTime(event);
  if (!raw) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function digestEventPath(event: DigestChangeEvent): string {
  return event.canonicalPath ?? event.path ?? "";
}

function normalizeDigestPath(path: string): string {
  return path.replace(/^\/+/u, "");
}

function pastTense(
  event: DigestChangeEvent,
  rules: readonly CompiledActionRule[],
  defaultPastTense: string,
): string {
  const action = (event.action ?? event.eventType ?? event.type ?? "").toLowerCase();
  for (const rule of rules) {
    if (rule.regex.test(action)) {
      return rule.pastTense;
    }
  }
  return defaultPastTense;
}

function compileActionRules(
  rules: readonly DigestActionRule[],
): readonly CompiledActionRule[] {
  return rules.map((rule) => ({
    regex: new RegExp(`(^|[^a-z0-9])(${rule.verbs})([^a-z0-9]|$)`, "u"),
    pastTense: rule.pastTense,
  }));
}
