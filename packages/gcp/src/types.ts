export const GCP_PATH_ROOT = "/gcp";

export const GCP_WEBHOOK_EVENTS = [
  "monitoring.incident.open",
  "monitoring.incident.closed",
] as const;

export type GcpWebhookEvent = (typeof GCP_WEBHOOK_EVENTS)[number];

export type GcpPathObjectType = "cloud-run-service" | "monitoring-alert" | "billing";

/**
 * Normalized Cloud Run service shape.
 * Sourced from Cloud Run Admin API:
 * GET https://run.googleapis.com/v2/projects/{project}/locations/{location}/services
 * (and .../services/{service}/revisions).
 */
export interface GcpCloudRunService {
  /** Short service name (last path segment of the resource name). */
  serviceName: string;
  /** Cloud Run region / location, e.g. "us-central1". */
  region: string;
  /** Latest created/ready revision name, if known. */
  latestRevision?: string;
  /** Whether the service's Ready condition is true. */
  ready: boolean;
  /** Public URL of the service, if exposed. */
  url?: string;
  /** ISO-8601 timestamp of the last modification (updateTime). */
  lastModified?: string;
}

/**
 * Normalized Cloud Monitoring alert policy shape.
 * Sourced from Cloud Monitoring API:
 * GET https://monitoring.googleapis.com/v3/projects/{project}/alertPolicies
 * plus firing incidents.
 */
export interface GcpMonitoringAlert {
  /** Alert policy id (last path segment of the policy name). */
  policyId: string;
  /** Human-readable display name of the policy. */
  displayName: string;
  /** Whether the policy is enabled. */
  enabled: boolean;
  /** Short summary of the policy's conditions. */
  conditionsSummary: string;
  /** Whether the alert currently has an open/firing incident. */
  firing: boolean;
  /** ISO-8601 timestamp of the most recent incident, if any. */
  lastIncidentTs?: string;
}

/**
 * Normalized Cloud Billing current-state shape (the FinOps mount).
 * Sourced from Cloud Billing API:
 * GET https://cloudbilling.googleapis.com/v1/billingAccounts/{id} and project
 * billing info.
 */
export interface GcpBilling {
  /** Billing account id (last path segment of the billing account name). */
  billingAccountId: string;
  /** Whether the billing account is open/active. */
  open: boolean;
  /** ISO-4217 currency code for the account, if known. */
  currency?: string;
  /** Current period cost amount, if available. */
  amount?: number;
  /** ISO-8601 timestamp when this snapshot was captured. */
  capturedAt?: string;
}
