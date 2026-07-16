import {
  matchesMaterializationTarget,
  resolveTargetMaterialization,
  type ResolvedResourceMaterialization as CoreResolvedResourceMaterialization,
  type ResolvedTargetMaterialization,
} from '@relayfile/adapter-core';
import type {
  GitHubAdapterConfig,
  GitHubBulkMaterializationResource,
  GitHubMaterializationFilter,
  SyncOptions,
} from './types.js';

type GitHubMaterializationState = NonNullable<GitHubMaterializationFilter['state']>;
export type ResolvedResourceMaterialization = CoreResolvedResourceMaterialization<GitHubMaterializationState>;
export type ResolvedRepoMaterialization =
  ResolvedTargetMaterialization<GitHubBulkMaterializationResource, GitHubMaterializationState>;

const BULK_RESOURCES = ['issues', 'pulls', 'commits'] as const satisfies readonly GitHubBulkMaterializationResource[];
export const DEFAULT_REPO_MATERIALIZATION: ResolvedRepoMaterialization = {
  issues: { mode: 'eager' },
  pulls: { mode: 'eager' },
  commits: { mode: 'lazy' },
};

export function resolveRepoMaterialization(
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
  options: SyncOptions = {},
): ResolvedRepoMaterialization {
  if (!config.materialization) {
    return config.lazy ? {
      issues: { mode: 'lazy' },
      pulls: { mode: 'lazy' },
      commits: { mode: 'lazy' },
    } : DEFAULT_REPO_MATERIALIZATION;
  }

  const target = `${owner}/${repo}`;
  const resolved = resolveTargetMaterialization(config.materialization, target, options, {
    defaultMode: config.lazy ? 'lazy' : 'eager',
    resources: BULK_RESOURCES,
    targetKey: 'repos',
    webhookWritesKey: 'webhookWritesForLazyRepos',
  });

  // Repository history is intentionally opt-in: adding commits must not make
  // every pre-existing eager GitHub connection backfill up to maxCommits.
  // A matching rule must name commits either in `resources` or via the
  // resource-specific `commits` policy before the generic resolved mode is
  // allowed through.
  if (!hasExplicitCommitRule(config, target)) {
    resolved.commits = { mode: 'lazy' };
  }

  return resolved;
}

function hasExplicitCommitRule(config: GitHubAdapterConfig, target: string): boolean {
  const rule = config.materialization?.rules?.find((candidate) => {
    const patterns = candidate.repos;
    return !patterns?.length || patterns.some((pattern) => matchesMaterializationTarget(pattern, target));
  });

  return Boolean(
    rule
    && (rule.resources?.includes('commits') || rule.commits !== undefined)
  );
}

export function shouldWriteWebhookForRepo(
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
): boolean {
  if (config.materialization?.webhookWritesForLazyRepos !== false) {
    return true;
  }

  const plan = resolveRepoMaterialization(config, owner, repo);
  return BULK_RESOURCES.some((resource) => plan[resource].mode === 'eager');
}
