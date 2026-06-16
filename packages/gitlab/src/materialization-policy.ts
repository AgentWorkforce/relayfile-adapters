import {
  resolveTargetMaterialization,
  shouldWriteWebhookForTarget,
  type ResolvedResourceMaterialization,
  type ResolvedTargetMaterialization,
} from '@relayfile/adapter-core';
import type {
  GitLabAdapterConfig,
  GitLabMaterializationResource,
  GitLabMaterializationState,
  SyncOptions,
} from './types.js';

export type { ResolvedResourceMaterialization };
export type ResolvedProjectMaterialization =
  ResolvedTargetMaterialization<GitLabMaterializationResource, GitLabMaterializationState>;

export const GITLAB_MATERIALIZATION_RESOURCES = [
  'merge_requests',
  'issues',
  'pipelines',
  'commits',
] as const satisfies readonly GitLabMaterializationResource[];
export const GITLAB_MATERIALIZATION_STATES = [
  'opened',
  'closed',
  'locked',
  'merged',
  'all',
] as const satisfies readonly GitLabMaterializationState[];

const FULL_PROJECT_MATERIALIZATION: ResolvedProjectMaterialization = {
  merge_requests: { mode: 'eager' },
  issues: { mode: 'eager' },
  pipelines: { mode: 'eager' },
  commits: { mode: 'eager' },
};

export function resolveProjectMaterialization(
  config: GitLabAdapterConfig,
  projectPath: string,
  options: SyncOptions = {},
): ResolvedProjectMaterialization {
  if (!config.materialization) {
    return FULL_PROJECT_MATERIALIZATION;
  }

  return resolveTargetMaterialization(config.materialization, projectPath, options, {
    defaultMode: 'eager',
    resources: GITLAB_MATERIALIZATION_RESOURCES,
    targetKey: 'projects',
    webhookWritesKey: 'webhookWritesForLazyProjects',
  });
}

export function shouldWriteWebhookForProject(
  config: GitLabAdapterConfig,
  projectPath: string,
): boolean {
  return shouldWriteWebhookForTarget(config.materialization, projectPath, {
    defaultMode: 'eager',
    resources: GITLAB_MATERIALIZATION_RESOURCES,
    targetKey: 'projects',
    webhookWritesKey: 'webhookWritesForLazyProjects',
  });
}
