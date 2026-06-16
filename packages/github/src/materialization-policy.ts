import type {
  GitHubAdapterConfig,
  GitHubBulkMaterializationResource,
  GitHubMaterializationFilter,
  GitHubMaterializationMode,
  GitHubMaterializationRule,
  GitHubResourceMaterializationPolicy,
  SyncOptions,
} from './types.js';

export interface ResolvedResourceMaterialization {
  mode: GitHubMaterializationMode;
  filter?: GitHubMaterializationFilter;
  since?: string;
}

export type ResolvedRepoMaterialization = Record<GitHubBulkMaterializationResource, ResolvedResourceMaterialization>;

const BULK_RESOURCES: GitHubBulkMaterializationResource[] = ['issues', 'pulls'];

export function resolveRepoMaterialization(
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
  options: SyncOptions = {},
): ResolvedRepoMaterialization {
  return {
    issues: resolveResourceMaterialization(config, owner, repo, 'issues', options),
    pulls: resolveResourceMaterialization(config, owner, repo, 'pulls', options),
  };
}

export function shouldWriteWebhookForRepo(
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
): boolean {
  if (config.materialization?.webhookWritesForLazyRepos !== false) {
    return true;
  }

  return BULK_RESOURCES.some(
    (resource) => resolveResourceMaterialization(config, owner, repo, resource).mode === 'eager',
  );
}

function resolveResourceMaterialization(
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
  resource: GitHubBulkMaterializationResource,
  options: SyncOptions = {},
): ResolvedResourceMaterialization {
  const policy = config.materialization;
  const defaultMode = policy?.default ?? (config.lazy ? 'lazy' : 'eager');
  const rule = policy?.rules?.find((candidate) => matchesRepo(candidate, owner, repo));

  if (!rule) {
    return { mode: defaultMode };
  }

  const resourcePolicy = normalizeResourcePolicy(rule[resource]);
  const mode =
    resourcePolicy?.mode ??
    modeFromResourceList(rule, resource) ??
    (typeof rule.eager === 'boolean' ? (rule.eager ? 'eager' : 'lazy') : defaultMode);

  const filter = resourcePolicy?.filter ?? rule.filter;
  const since = resourcePolicy?.since ?? filter?.since ?? rule.since ?? (resourcePolicy?.incremental || rule.incremental ? options.cursor : undefined);

  return {
    mode,
    filter,
    since,
  };
}

function normalizeResourcePolicy(
  value: GitHubMaterializationMode | GitHubResourceMaterializationPolicy | undefined,
): GitHubResourceMaterializationPolicy | undefined {
  if (!value) {
    return undefined;
  }

  return typeof value === 'string' ? { mode: value } : value;
}

function modeFromResourceList(
  rule: GitHubMaterializationRule,
  resource: GitHubBulkMaterializationResource,
): GitHubMaterializationMode | undefined {
  if (!rule.resources) {
    return undefined;
  }

  return rule.resources.includes(resource) ? 'eager' : 'lazy';
}

function matchesRepo(rule: GitHubMaterializationRule, owner: string, repo: string): boolean {
  if (!rule.repos || rule.repos.length === 0) {
    return true;
  }

  const repoSlug = `${owner}/${repo}`;
  return rule.repos.some((pattern) => matchesRepoPattern(pattern, repoSlug));
}

function matchesRepoPattern(pattern: string, repoSlug: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) {
    return false;
  }

  const normalizedRepo = repoSlug.toLowerCase();
  if (!normalizedPattern.includes('*') && !normalizedPattern.includes('?')) {
    return normalizedPattern === normalizedRepo;
  }

  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return regex.test(normalizedRepo);
}
