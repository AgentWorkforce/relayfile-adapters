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
  return posthogNamedAliasPath(
    `${POSTHOG_PATH_ROOT}/projects`,
    name,
    projectId,
  );
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

export function posthogDashboardByNameAliasPath(
  projectId: string,
  name: string,
  dashboardId: string,
): string {
  return posthogProjectScopedByNameAliasPath(
    "dashboard",
    projectId,
    name,
    dashboardId,
  );
}

export function posthogExperimentByNameAliasPath(
  projectId: string,
  name: string,
  experimentId: string,
): string {
  return posthogProjectScopedByNameAliasPath(
    "experiment",
    projectId,
    name,
    experimentId,
  );
}

export function posthogSurveyByNameAliasPath(
  projectId: string,
  name: string,
  surveyId: string,
): string {
  return posthogProjectScopedByNameAliasPath(
    "survey",
    projectId,
    name,
    surveyId,
  );
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
  context: { projectId?: string; displayName?: string } = {},
): string {
  if (objectType === "project") {
    return posthogProjectPath(objectId);
  }

  if (!context.projectId) {
    throw new Error(`PostHog ${objectType} path requires projectId`);
  }
  return posthogProjectScopedPath(
    objectType,
    context.projectId,
    objectId,
    context.displayName,
  );
}

export function posthogProjectScopedPath(
  objectType: Exclude<PostHogPathObjectType, "project">,
  projectId: string,
  objectId: string,
  displayName?: string,
): string {
  return `${posthogProjectCollectionPrefix(
    objectType,
    projectId,
  )}/${posthogCanonicalFlatRecordSegment(objectId, displayName)}.json`;
}

export interface ParsedPostHogPath {
  objectType: PostHogPathObjectType;
  objectId: string;
  projectId?: string;
}

export function parsePostHogPath(path: string): ParsedPostHogPath | null {
  const projectMatch = /^\/posthog\/projects\/([^/]+)\.json$/u.exec(path);
  if (projectMatch?.[1]) {
    return {
      objectType: "project",
      objectId: decodeURIComponent(projectMatch[1]),
    };
  }

  const scopedMatch =
    /^\/posthog\/projects\/([^/]+)\/(insights|dashboards|feature-flags|annotations|experiments|surveys|alert-events)\/([^/]+)\.json$/u.exec(
      path,
    );
  if (!scopedMatch?.[1] || !scopedMatch[2] || !scopedMatch[3]) {
    return null;
  }

  const objectType = posthogObjectTypeFromCollection(scopedMatch[2]);
  if (!objectType) {
    return null;
  }
  return {
    objectType,
    objectId: extractPostHogIdFromCanonicalSegment(scopedMatch[3]),
    projectId: decodeURIComponent(scopedMatch[1]),
  };
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

export function posthogRecordDisplayName(
  objectType: Exclude<PostHogPathObjectType, "project">,
  record: Record<string, unknown>,
  objectId: string,
): string {
  switch (objectType) {
    case "insight":
      return (
        readDisplayString(record.name) ??
        readDisplayString(record.derived_name) ??
        readDisplayString(record.short_id) ??
        objectId
      );
    case "dashboard":
      return (
        readDisplayString(record.name) ??
        readDisplayString(record.description) ??
        objectId
      );
    case "feature-flag":
      return (
        readDisplayString(record.name) ??
        readDisplayString(record.key) ??
        objectId
      );
    case "annotation":
      return (
        readDisplayString(record.content) ??
        readDisplayString(record.scope) ??
        objectId
      );
    case "experiment":
      return (
        readDisplayString(record.name) ??
        readDisplayString(record.feature_flag_key) ??
        objectId
      );
    case "survey":
      return (
        readDisplayString(record.name) ??
        readDisplayString(record.type) ??
        objectId
      );
    case "alert-event":
      return (
        readDisplayString(record.title) ??
        readDisplayString(record.event_type) ??
        objectId
      );
  }
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

function posthogProjectScopedByNameAliasPath(
  objectType: "dashboard" | "experiment" | "survey",
  projectId: string,
  name: string,
  objectId: string,
): string {
  return posthogNamedAliasPath(
    posthogProjectCollectionPrefix(objectType, projectId),
    name,
    objectId,
  );
}

function posthogNamedAliasPath(
  collectionPrefix: string,
  name: string,
  objectId: string,
): string {
  const slug = slugifyAlias(name);
  const suffix = aliasCollisionSuffix(objectId);
  return `${collectionPrefix}/by-name/${encodePostHogPathSegment(
    `${slug}-${suffix}__${objectId}`,
  )}.json`;
}

function posthogCanonicalFlatRecordSegment(
  objectId: string,
  displayName: string | undefined,
): string {
  const id = assertNonEmpty(objectId, "object id");
  const name = displayName?.trim();
  return encodePostHogPathSegment(
    name ? `${slugifyAlias(name)}__${id}` : id,
  );
}

function extractPostHogIdFromCanonicalSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const separatorIndex = decoded.lastIndexOf("__");
  return separatorIndex >= 0 ? decoded.slice(separatorIndex + 2) : decoded;
}

function posthogObjectTypeFromCollection(
  collection: string,
): Exclude<PostHogPathObjectType, "project"> | null {
  switch (collection) {
    case "insights":
      return "insight";
    case "dashboards":
      return "dashboard";
    case "feature-flags":
      return "feature-flag";
    case "annotations":
      return "annotation";
    case "experiments":
      return "experiment";
    case "surveys":
      return "survey";
    case "alert-events":
      return "alert-event";
    default:
      return null;
  }
}

function readDisplayString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
