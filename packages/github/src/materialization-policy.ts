import {
  resolveTargetMaterialization,
  shouldWriteWebhookForTarget,
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
const FULL_REPO_MATERIALIZATION: ResolvedRepoMaterialization = {
  issues: { mode: 'eager' },
  pulls: { mode: 'eager' },
  commits: { mode: 'eager' },
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
    } : FULL_REPO_MATERIALIZATION;
  }

  return resolveTargetMaterialization(config.materialization, `${owner}/${repo}`, options, {
    defaultMode: config.lazy ? 'lazy' : 'eager',
    resources: BULK_RESOURCES,
    targetKey: 'repos',
    webhookWritesKey: 'webhookWritesForLazyRepos',
  });
}

export function shouldWriteWebhookForRepo(
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
): boolean {
  return shouldWriteWebhookForTarget(config.materialization, `${owner}/${repo}`, {
    defaultMode: config.lazy ? 'lazy' : 'eager',
    resources: BULK_RESOURCES,
    targetKey: 'repos',
    webhookWritesKey: 'webhookWritesForLazyRepos',
  });
}
