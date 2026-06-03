import { DAYTONA_PATH_ROOT, type DaytonaPathObjectType } from "./types.js";

export type DaytonaNangoModel = "DaytonaUsage";

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Daytona ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeDaytonaPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmpty(value, "path segment"));
}

export function daytonaRootIndexPath(): string {
  return `${DAYTONA_PATH_ROOT}/_index.json`;
}

export function daytonaUsagePath(organizationId: string): string {
  return `${DAYTONA_PATH_ROOT}/usage/${encodeDaytonaPathSegment(organizationId)}.json`;
}

export function daytonaUsageIndexPath(): string {
  return `${DAYTONA_PATH_ROOT}/usage/_index.json`;
}

export function daytonaUsageByIdAliasPath(organizationId: string): string {
  return `${DAYTONA_PATH_ROOT}/usage/by-id/${encodeDaytonaPathSegment(organizationId)}.json`;
}

export function daytonaSandboxPath(id: string): string {
  return `${DAYTONA_PATH_ROOT}/sandboxes/${encodeDaytonaPathSegment(id)}.json`;
}

export function daytonaSnapshotPath(id: string): string {
  return `${DAYTONA_PATH_ROOT}/snapshots/${encodeDaytonaPathSegment(id)}.json`;
}

export function daytonaVolumePath(id: string): string {
  return `${DAYTONA_PATH_ROOT}/volumes/${encodeDaytonaPathSegment(id)}.json`;
}

export function normalizeNangoDaytonaModel(model: string): DaytonaPathObjectType | null {
  const normalized = model.trim().toLowerCase().replace(/[_\s]+/gu, "-");
  if (normalized === "daytonausage" || normalized === "usage") {
    return "usage";
  }
  if (normalized === "sandbox" || normalized === "daytonasandbox") {
    return "sandbox";
  }
  if (normalized === "snapshot" || normalized === "daytonasnapshot") {
    return "snapshot";
  }
  if (normalized === "volume" || normalized === "daytonavolume") {
    return "volume";
  }
  return null;
}

export function computeDaytonaPath(objectType: string, objectId: string): string {
  const normalizedType = normalizeDaytonaObjectType(objectType);
  const normalizedId = assertNonEmpty(objectId, "object id");

  if (normalizedType === "usage") {
    return daytonaUsagePath(normalizedId);
  }
  if (normalizedType === "sandbox") {
    return daytonaSandboxPath(normalizedId);
  }
  if (normalizedType === "snapshot") {
    return daytonaSnapshotPath(normalizedId);
  }
  if (normalizedType === "volume") {
    return daytonaVolumePath(normalizedId);
  }

  throw new Error(`Unsupported Daytona object type: ${objectType}`);
}

function normalizeDaytonaObjectType(objectType: string): DaytonaPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[_\s]+/gu, "-");
  if (
    normalized === "usage" ||
    normalized === "daytonausage"
  ) {
    return "usage";
  }
  if (normalized === "sandbox" || normalized === "daytonasandbox") {
    return "sandbox";
  }
  if (normalized === "snapshot" || normalized === "daytonasnapshot") {
    return "snapshot";
  }
  if (normalized === "volume" || normalized === "daytonavolume") {
    return "volume";
  }
  throw new Error(`Unsupported Daytona object type: ${objectType}`);
}
