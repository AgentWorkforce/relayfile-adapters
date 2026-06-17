import { aliasCollisionSuffix, slugifyAlias } from "@relayfile/adapter-core";

import { GCP_PATH_ROOT, type GcpPathObjectType } from "./types.js";

export type GcpNangoModel =
  | "GcpCloudRunService"
  | "GcpMonitoringAlert"
  | "GcpBilling"
  | "GcpErrorGroup";

export type ParsedGcpPath =
  | { objectType: "cloud-run-service"; id: string }
  | { objectType: "monitoring-alert"; id: string }
  | { objectType: "billing"; id: "current" }
  | { objectType: "error-group"; id: string };

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`GCP ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeGcpPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmpty(value, "path segment"));
}

export function gcpRootIndexPath(): string {
  return `${GCP_PATH_ROOT}/_index.json`;
}

export function gcpCloudRunServicePath(id: string): string {
  return `${GCP_PATH_ROOT}/run/services/${encodeGcpPathSegment(id)}.json`;
}

export function gcpCloudRunServicesIndexPath(): string {
  return `${GCP_PATH_ROOT}/run/services/_index.json`;
}

export function gcpCloudRunServiceByIdAliasPath(id: string): string {
  return `${GCP_PATH_ROOT}/run/services/by-id/${encodeGcpPathSegment(id)}.json`;
}

export function gcpCloudRunServiceByRegionAliasPath(region: string, id: string): string {
  return `${GCP_PATH_ROOT}/run/services/by-region/${encodeGcpPathSegment(slugifyAlias(region))}/${encodeGcpPathSegment(id)}.json`;
}

export function gcpCloudRunServiceByStatusAliasPath(status: string, id: string): string {
  return `${GCP_PATH_ROOT}/run/services/by-status/${encodeGcpPathSegment(slugifyAlias(status))}/${encodeGcpPathSegment(id)}.json`;
}

export function gcpMonitoringAlertPath(policyId: string): string {
  return `${GCP_PATH_ROOT}/monitoring/alerts/${encodeGcpPathSegment(policyId)}.json`;
}

export function gcpMonitoringAlertsIndexPath(): string {
  return `${GCP_PATH_ROOT}/monitoring/alerts/_index.json`;
}

export function gcpMonitoringAlertByIdAliasPath(policyId: string): string {
  return `${GCP_PATH_ROOT}/monitoring/alerts/by-id/${encodeGcpPathSegment(policyId)}.json`;
}

export function gcpMonitoringAlertByTitleAliasPath(title: string, policyId: string): string {
  const slug = slugifyAlias(title);
  const suffix = aliasCollisionSuffix(policyId);
  return `${GCP_PATH_ROOT}/monitoring/alerts/by-title/${encodeGcpPathSegment(`${slug}-${suffix}__${policyId}`)}.json`;
}

export function gcpMonitoringAlertByStateAliasPath(state: string, policyId: string): string {
  return `${GCP_PATH_ROOT}/monitoring/alerts/by-state/${encodeGcpPathSegment(slugifyAlias(state))}/${encodeGcpPathSegment(policyId)}.json`;
}

export function gcpBillingPath(): string {
  return `${GCP_PATH_ROOT}/billing/current.json`;
}

export function gcpBillingIndexPath(): string {
  return `${GCP_PATH_ROOT}/billing/_index.json`;
}

export function gcpErrorGroupPath(groupId: string): string {
  return `${GCP_PATH_ROOT}/error-reporting/groups/${encodeGcpPathSegment(groupId)}.json`;
}

export function gcpErrorGroupsIndexPath(): string {
  return `${GCP_PATH_ROOT}/error-reporting/groups/_index.json`;
}

export function gcpErrorGroupByIdAliasPath(groupId: string): string {
  return `${GCP_PATH_ROOT}/error-reporting/groups/by-id/${encodeGcpPathSegment(groupId)}.json`;
}

export function gcpErrorGroupByServiceAliasPath(service: string, groupId: string): string {
  return `${GCP_PATH_ROOT}/error-reporting/groups/by-service/${encodeGcpPathSegment(slugifyAlias(service))}/${encodeGcpPathSegment(groupId)}.json`;
}

export function gcpErrorGroupByStatusAliasPath(status: string, groupId: string): string {
  return `${GCP_PATH_ROOT}/error-reporting/groups/by-status/${encodeGcpPathSegment(slugifyAlias(status))}/${encodeGcpPathSegment(groupId)}.json`;
}

export function normalizeNangoGcpModel(model: string): GcpPathObjectType | null {
  const normalized = model.trim().toLowerCase().replace(/[_\s]+/gu, "-");
  if (
    normalized === "gcpcloudrunservice" ||
    normalized === "gcpcloudrunservices" ||
    normalized === "cloud-run-service" ||
    normalized === "cloud-run-services" ||
    normalized === "service"
  ) {
    return "cloud-run-service";
  }
  if (
    normalized === "gcpmonitoringalert" ||
    normalized === "gcpmonitoringalerts" ||
    normalized === "monitoring-alert" ||
    normalized === "monitoring-alerts" ||
    normalized === "alert"
  ) {
    return "monitoring-alert";
  }
  if (normalized === "gcpbilling" || normalized === "billing") {
    return "billing";
  }
  if (
    normalized === "gcperrorgroup" ||
    normalized === "gcperrorgroups" ||
    normalized === "error-group" ||
    normalized === "error-groups" ||
    normalized === "group"
  ) {
    return "error-group";
  }
  return null;
}

export function parseGcpPath(path: string): ParsedGcpPath | null {
  const cloudRunMatch = /^\/gcp\/run\/services\/([^/]+)\.json$/u.exec(path);
  if (cloudRunMatch) {
    if (cloudRunMatch[1] === "_index") {
      return null;
    }
    return {
      objectType: "cloud-run-service",
      id: decodeURIComponent(cloudRunMatch[1]!),
    };
  }

  const alertMatch = /^\/gcp\/monitoring\/alerts\/([^/]+)\.json$/u.exec(path);
  if (alertMatch) {
    if (alertMatch[1] === "_index") {
      return null;
    }
    return {
      objectType: "monitoring-alert",
      id: decodeURIComponent(alertMatch[1]!),
    };
  }

  if (path === gcpBillingPath()) {
    return { objectType: "billing", id: "current" };
  }

  const errorGroupMatch = /^\/gcp\/error-reporting\/groups\/([^/]+)\.json$/u.exec(path);
  if (errorGroupMatch) {
    if (errorGroupMatch[1] === "_index") {
      return null;
    }
    return {
      objectType: "error-group",
      id: decodeURIComponent(errorGroupMatch[1]!),
    };
  }

  return null;
}

export function computeGcpPath(objectType: string, objectId: string): string {
  const normalizedType = normalizeGcpObjectType(objectType);

  if (normalizedType === "billing") {
    return gcpBillingPath();
  }

  const normalizedId = assertNonEmpty(objectId, "object id");

  if (normalizedType === "cloud-run-service") {
    return gcpCloudRunServicePath(normalizedId);
  }
  if (normalizedType === "monitoring-alert") {
    return gcpMonitoringAlertPath(normalizedId);
  }
  if (normalizedType === "error-group") {
    return gcpErrorGroupPath(normalizedId);
  }

  throw new Error(`Unsupported GCP object type: ${objectType}`);
}

function normalizeGcpObjectType(objectType: string): GcpPathObjectType {
  const normalized = normalizeNangoGcpModel(objectType);
  if (normalized) {
    return normalized;
  }
  throw new Error(`Unsupported GCP object type: ${objectType}`);
}
