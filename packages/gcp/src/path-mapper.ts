import { GCP_PATH_ROOT, type GcpPathObjectType } from "./types.js";

export type GcpNangoModel =
  | "GcpCloudRunService"
  | "GcpMonitoringAlert"
  | "GcpBilling";

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

export function gcpMonitoringAlertPath(policyId: string): string {
  return `${GCP_PATH_ROOT}/monitoring/alerts/${encodeGcpPathSegment(policyId)}.json`;
}

export function gcpMonitoringAlertsIndexPath(): string {
  return `${GCP_PATH_ROOT}/monitoring/alerts/_index.json`;
}

export function gcpMonitoringAlertByIdAliasPath(policyId: string): string {
  return `${GCP_PATH_ROOT}/monitoring/alerts/by-id/${encodeGcpPathSegment(policyId)}.json`;
}

export function gcpBillingPath(): string {
  return `${GCP_PATH_ROOT}/billing/current.json`;
}

export function normalizeNangoGcpModel(model: string): GcpPathObjectType | null {
  const normalized = model.trim().toLowerCase().replace(/[_\s]+/gu, "-");
  if (
    normalized === "gcpcloudrunservice" ||
    normalized === "cloud-run-service" ||
    normalized === "cloud-run-services" ||
    normalized === "service"
  ) {
    return "cloud-run-service";
  }
  if (
    normalized === "gcpmonitoringalert" ||
    normalized === "monitoring-alert" ||
    normalized === "monitoring-alerts" ||
    normalized === "alert"
  ) {
    return "monitoring-alert";
  }
  if (normalized === "gcpbilling" || normalized === "billing") {
    return "billing";
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

  throw new Error(`Unsupported GCP object type: ${objectType}`);
}

function normalizeGcpObjectType(objectType: string): GcpPathObjectType {
  const normalized = normalizeNangoGcpModel(objectType);
  if (normalized) {
    return normalized;
  }
  throw new Error(`Unsupported GCP object type: ${objectType}`);
}
