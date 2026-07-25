import {
  aliasCollisionSuffix,
  slugifyAlias,
} from "@relayfile/adapter-core";

import {
  POSTHOG_PATH_ROOT,
  type PostHogAggregateCollection,
  type PostHogPathObjectType,
} from "./types.js";

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`PostHog ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodePostHogPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmpty(value, "path segment"));
}

export function posthogRootIndexPath(): string {
  return `${POSTHOG_PATH_ROOT}/_index.json`;
}

export function posthogProjectsIndexPath(): string {
  return `${POSTHOG_PATH_ROOT}/projects/_index.json`;
}

export function posthogAggregateIndexPath(
  collection: PostHogAggregateCollection,
): string {
  return `${POSTHOG_PATH_ROOT}/${collection}/_index.json`;
}

export function posthogProjectPath(projectId: string): string {
  return `${POSTHOG_PATH_ROOT}/projects/${encodePostHogPathSegment(projectId)}.json`;
}

export function posthogProjectByIdAliasPath(projectId: string): string {
  return `${POSTHOG_PATH_ROOT}/projects/by-id/${encodePostHogPathSegment(projectId)}.json`;
}

export function posthogProjectByNameAliasPath(
  name: string,
  projectId: string,
): string {
  const slug = slugifyAlias(name);
  const suffix = aliasCollisionSuffix(projectId);
  return `${POSTHOG_PATH_ROOT}/projects/by-name/${encodePostHogPathSegment(`${slug}-${suffix}__${projectId}`)}.json`;
}

export function posthogProjectLocalIndexPath(
  objectType: Exclude<PostHogPathObjectType, "project">,
  projectId: string,
): string {
  return `${posthogProjectCollectionPrefix(
    objectType,
    projectId,
  )}/_index.json`;
}

export function posthogGlobalByIdAliasPath(
  objectType: Exclude<PostHogPathObjectType, "project">,
  projectId: string,
  objectId: string,
): string {
  return `${POSTHOG_PATH_ROOT}/${posthogAggregateCollection(
    objectType,
  )}/by-id/${encodePostHogPathSegment(composeProjectScopedId(projectId, objectId))}.json`;
}

export function posthogProjectLocalByIdAliasPath(
  objectType: Exclude<PostHogPathObjectType, "project">,
  projectId: string,
  objectId: string,
): string {
  return `${posthogProjectCollectionPrefix(
    objectType,
    projectId,
  )}/by-id/${encodePostHogPathSegment(objectId)}.json`;
}

export function posthogInsightByShortIdAliasPath(
  projectId: string,
  shortId: string,
): string {
  return `${posthogProjectCollectionPrefix(
    "insight",
    projectId,
  )}/by-short-id/${encodePostHogPathSegment(shortId)}.json`;
}

export function posthogFeatureFlagByKeyAliasPath(
  projectId: string,
  key: string,
): string {
  return `${posthogProjectCollectionPrefix(
    "feature-flag",
    projectId,
  )}/by-key/${encodePostHogPathSegment(key)}.json`;
}

export function posthogProjectCollectionPrefix(
  objectType: Exclude<PostHogPathObjectType, "project">,
  projectId: string,
): string {
  const project = encodePostHogPathSegment(projectId);
  return `${POSTHOG_PATH_ROOT}/projects/${project}/${posthogAggregateCollection(
    objectType,
  )}`;
}

export function posthogAggregateCollection(
  objectType: PostHogPathObjectType,
): PostHogAggregateCollection {
  switch (objectType) {
    case "project":
      return "projects";
    case "insight":
      return "insights";
    case "dashboard":
      return "dashboards";
    case "feature-flag":
      return "feature-flags";
    case "annotation":
      return "annotations";
    case "experiment":
      return "experiments";
    case "survey":
      return "surveys";
    case "alert-event":
      return "alert-events";
  }
}

export function computePostHogPath(
  objectType: PostHogPathObjectType,
  objectId: string,
  context: { projectId?: string } = {},
): string {
  const id = encodePostHogPathSegment(objectId);
  if (objectType === "project") {
    return posthogProjectPath(objectId);
  }

  const projectId = context.projectId
    ? encodePostHogPathSegment(context.projectId)
    : null;
  if (!projectId) {
    throw new Error(`PostHog ${objectType} path requires projectId`);
  }
  return `${POSTHOG_PATH_ROOT}/projects/${projectId}/${posthogAggregateCollection(
    objectType,
  )}/${id}.json`;
}

export function composeProjectScopedId(
  projectId: string,
  objectId: string,
): string {
  return `${assertNonEmpty(projectId, "project id")}__${assertNonEmpty(
    objectId,
    "object id",
  )}`;
}

export function normalizeNangoPostHogModel(
  model: string,
): PostHogPathObjectType | null {
  const normalized = model.trim().toLowerCase().replace(/[_\s]+/gu, "-");
  switch (normalized) {
    case "posthogproject":
    case "project":
      return "project";
    case "posthoginsight":
    case "insight":
      return "insight";
    case "posthogdashboard":
    case "dashboard":
      return "dashboard";
    case "posthogfeatureflag":
    case "feature-flag":
    case "feature-flags":
      return "feature-flag";
    case "posthogannotation":
    case "annotation":
    case "annotations":
      return "annotation";
    case "posthogexperiment":
    case "experiment":
    case "experiments":
      return "experiment";
    case "posthogsurvey":
    case "survey":
    case "surveys":
      return "survey";
    case "posthogalertevent":
    case "alert-event":
    case "alert-events":
      return "alert-event";
    default:
      return null;
  }
}
