import {
  computeGcpPath,
  gcpBillingPath,
  gcpCloudRunServicesIndexPath,
  gcpErrorGroupsIndexPath,
} from "./path-mapper.js";
import { GCP_WEBHOOK_EVENTS, type GcpWebhookEvent } from "./types.js";

export type GcpWebhookObjectType =
  | "monitoring-alert"
  | "cloud-run-service"
  | "billing"
  | "error-group";

type FileEventType = "file.created" | "file.updated" | "file.deleted";

export interface NormalizedGcpWebhook {
  provider: "gcp";
  eventType: GcpWebhookEvent;
  objectType: GcpWebhookObjectType;
  objectId: string;
  payload: Record<string, unknown>;
  fileEventType: FileEventType;
  shouldDelete: boolean;
  path: string;
  syncNames?: readonly string[];
  policyId?: string;
  displayName?: string;
  conditionName?: string;
  resourceName?: string;
  state?: "open" | "closed";
  firing?: boolean;
  timestamp?: string;
  serviceName?: string;
  region?: string;
  billingAccountId?: string;
  budgetId?: string;
  budgetDisplayName?: string;
  budgetAmount?: number;
  costAmount?: number;
  currencyCode?: string;
  groupId?: string;
  detailLink?: string;
  exceptionType?: string;
  exceptionMessage?: string;
  service?: string;
  version?: string;
  resolutionStatus?: string;
}

const GCP_CLOUD_RUN_SYNC = "fetch-cloud-run";
const GCP_BILLING_SYNC = "fetch-billing";
const GCP_ERROR_GROUPS_SYNC = "fetch-error-groups";

const CLOUD_RUN_METHODS: Readonly<Record<string, GcpWebhookEvent>> = {
  "google.cloud.run.v1.Services.ReplaceService": "cloud-run.service.updated",
  "google.cloud.run.v2.Services.CreateService": "cloud-run.service.created",
  "google.cloud.run.v2.Services.UpdateService": "cloud-run.service.updated",
  "google.cloud.run.v2.Services.DeleteService": "cloud-run.service.deleted",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNestedRecord(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = payload[key];
  return isRecord(value) ? value : undefined;
}

function readState(incident: Record<string, unknown>): "open" | "closed" | undefined {
  const raw = readString(incident.state)?.toLowerCase();
  if (raw === "open" || raw === "closed") {
    return raw;
  }
  return undefined;
}

function readPolicyId(incident: Record<string, unknown>): string | undefined {
  const policyName =
    readString(incident.policy_name) ??
    readString(incident.policyName) ??
    readString(incident.policy_user_label) ??
    readString(incident.condition_name);
  if (!policyName) {
    return undefined;
  }
  return lastPathSegment(policyName) ?? policyName;
}

function unwrapPubSubEnvelope(payload: Record<string, unknown>): {
  body: Record<string, unknown>;
  attributes: Record<string, string>;
} {
  const message = payload.message;
  if (!isRecord(message)) {
    return { body: payload, attributes: {} };
  }

  const attributes = normalizeStringRecord(message.attributes);
  const data = readString(message.data);
  if (!data) {
    return { body: payload, attributes };
  }

  try {
    const parsed = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as unknown;
    return { body: isRecord(parsed) ? parsed : payload, attributes };
  } catch {
    return { body: payload, attributes };
  }
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, readString(entry)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function readDisplayName(incident: Record<string, unknown>): string | undefined {
  return (
    readString(incident.policy_name) ??
    readString(incident.condition_name) ??
    readString(incident.summary)
  );
}

function readTimestamp(incident: Record<string, unknown>): string {
  const seconds =
    typeof incident.started_at === "number"
      ? incident.started_at
      : typeof incident.ended_at === "number"
        ? incident.ended_at
        : undefined;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return new Date(seconds * 1000).toISOString();
  }
  return (
    readString(incident.started_at) ??
    readString(incident.ended_at) ??
    new Date().toISOString()
  );
}

function lastPathSegment(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.split("/").filter(Boolean).at(-1);
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeMonitoringWebhook(body: Record<string, unknown>): NormalizedGcpWebhook | null {
  const incident = readNestedRecord(body, "incident") ?? body;
  const state = readState(incident);
  if (!state) {
    return null;
  }

  const policyId = readPolicyId(incident);
  if (!policyId) {
    return null;
  }

  const eventType: GcpWebhookEvent =
    state === "open" ? "monitoring.incident.open" : "monitoring.incident.closed";
  if (!GCP_WEBHOOK_EVENTS.includes(eventType)) {
    return null;
  }

  const displayName = readDisplayName(incident) ?? policyId;
  const conditionName = readString(incident.condition_name);
  const resourceName = readString(incident.resource_name);
  const firing = state === "open";

  return {
    provider: "gcp",
    eventType,
    objectType: "monitoring-alert",
    objectId: policyId,
    policyId,
    displayName,
    ...(conditionName ? { conditionName } : {}),
    ...(resourceName ? { resourceName } : {}),
    state,
    firing,
    timestamp: readTimestamp(incident),
    payload: body,
    fileEventType: firing ? "file.created" : "file.updated",
    shouldDelete: false,
    path: computeGcpPath("monitoring-alert", policyId),
  };
}

function normalizeBillingBudgetWebhook(
  body: Record<string, unknown>,
  attributes: Record<string, string>,
): NormalizedGcpWebhook | null {
  const budgetDisplayName = readString(body.budgetDisplayName);
  const costAmount = readNumber(body.costAmount);
  const budgetAmount = readNumber(body.budgetAmount);
  const billingAccountId = attributes.billingAccountId;
  const budgetId = attributes.budgetId;

  if (!budgetDisplayName && costAmount === undefined && budgetAmount === undefined) {
    return null;
  }
  if (!billingAccountId && !budgetId) {
    return null;
  }

  const eventType: GcpWebhookEvent = "billing.budget.alert";
  if (!GCP_WEBHOOK_EVENTS.includes(eventType)) {
    return null;
  }
  const currencyCode = readString(body.currencyCode);

  return {
    provider: "gcp",
    eventType,
    objectType: "billing",
    objectId: billingAccountId ?? budgetId ?? "current",
    payload: body,
    fileEventType: "file.updated",
    shouldDelete: false,
    path: gcpBillingPath(),
    syncNames: [GCP_BILLING_SYNC],
    ...(billingAccountId ? { billingAccountId } : {}),
    ...(budgetId ? { budgetId } : {}),
    ...(budgetDisplayName ? { budgetDisplayName } : {}),
    ...(budgetAmount !== undefined ? { budgetAmount } : {}),
    ...(costAmount !== undefined ? { costAmount } : {}),
    ...(currencyCode ? { currencyCode } : {}),
  };
}

function normalizeCloudRunWebhook(body: Record<string, unknown>): NormalizedGcpWebhook | null {
  const protoPayload = readNestedRecord(body, "protoPayload");
  if (!protoPayload) {
    return null;
  }
  if (readString(protoPayload.serviceName) !== "run.googleapis.com") {
    return null;
  }

  const methodName = readString(protoPayload.methodName);
  const eventType = methodName ? CLOUD_RUN_METHODS[methodName] : undefined;
  if (!eventType || !GCP_WEBHOOK_EVENTS.includes(eventType)) {
    return null;
  }

  const resource = readNestedRecord(body, "resource");
  const resourceLabels = readNestedRecord(resource ?? {}, "labels");
  const resourceName =
    readString(protoPayload.resourceName) ??
    readString(resourceLabels?.service_name) ??
    readString(resourceLabels?.serviceName);
  const serviceName =
    readString(resourceLabels?.service_name) ??
    readString(resourceLabels?.serviceName) ??
    lastPathSegment(resourceName);
  const region =
    readString(resourceLabels?.location) ??
    readString(resourceLabels?.region) ??
    regionFromResourceName(resourceName);

  return {
    provider: "gcp",
    eventType,
    objectType: "cloud-run-service",
    objectId: serviceName ?? resourceName ?? eventType,
    payload: body,
    fileEventType:
      eventType === "cloud-run.service.created"
        ? "file.created"
        : eventType === "cloud-run.service.deleted"
          ? "file.deleted"
          : "file.updated",
    shouldDelete: eventType === "cloud-run.service.deleted",
    path: serviceName ? computeGcpPath("cloud-run-service", serviceName) : gcpCloudRunServicesIndexPath(),
    syncNames: [GCP_CLOUD_RUN_SYNC],
    ...(serviceName ? { serviceName } : {}),
    ...(region ? { region } : {}),
    ...(resourceName ? { resourceName } : {}),
  };
}

function regionFromResourceName(resourceName: string | undefined): string | undefined {
  if (!resourceName) {
    return undefined;
  }
  const match = /\/locations\/([^/]+)\//u.exec(resourceName);
  return match?.[1];
}

function normalizeErrorReportingWebhook(body: Record<string, unknown>): NormalizedGcpWebhook | null {
  const groupInfo = readNestedRecord(body, "group_info");
  if (!groupInfo) {
    return null;
  }

  const subject = readString(body.subject);
  const detailLink = readString(groupInfo.detail_link);
  const groupId = extractErrorGroupId(detailLink);
  const eventType: GcpWebhookEvent =
    subject?.toLowerCase().includes("reopen")
      ? "error-reporting.group.reopened"
      : "error-reporting.group.opened";

  if (!GCP_WEBHOOK_EVENTS.includes(eventType)) {
    return null;
  }

  const exceptionInfo = readNestedRecord(body, "exception_info");
  const eventInfo = readNestedRecord(body, "event_info");
  const exceptionType = readString(exceptionInfo?.type);
  const exceptionMessage = readString(exceptionInfo?.message);
  const service = readString(eventInfo?.service);
  const version = readString(eventInfo?.version);
  return {
    provider: "gcp",
    eventType,
    objectType: "error-group",
    objectId: groupId ?? subject ?? eventType,
    payload: body,
    fileEventType: "file.updated",
    shouldDelete: false,
    path: groupId ? computeGcpPath("error-group", groupId) : gcpErrorGroupsIndexPath(),
    syncNames: [GCP_ERROR_GROUPS_SYNC],
    ...(groupId ? { groupId } : {}),
    ...(detailLink ? { detailLink } : {}),
    ...(exceptionType ? { exceptionType } : {}),
    ...(exceptionMessage ? { exceptionMessage } : {}),
    ...(service ? { service } : {}),
    ...(version ? { version } : {}),
    resolutionStatus: "OPEN",
  };
}

function normalizeErrorLogSignal(body: Record<string, unknown>): NormalizedGcpWebhook | null {
  const resource = readNestedRecord(body, "resource");
  const resourceType = readString(resource?.type);
  const severity = readString(body.severity);
  if (resourceType !== "cloud_run_revision") {
    return null;
  }
  if (!severity || !["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(severity.toUpperCase())) {
    return null;
  }

  const labels = readNestedRecord(resource ?? {}, "labels");
  const serviceName =
    readString(labels?.service_name) ??
    readString(labels?.serviceName);
  const eventType: GcpWebhookEvent = "error-reporting.event.logged";
  if (!GCP_WEBHOOK_EVENTS.includes(eventType)) {
    return null;
  }

  return {
    provider: "gcp",
    eventType,
    objectType: "error-group",
    objectId: serviceName ?? eventType,
    payload: body,
    fileEventType: "file.updated",
    shouldDelete: false,
    path: gcpErrorGroupsIndexPath(),
    syncNames: [GCP_ERROR_GROUPS_SYNC],
    ...(serviceName ? { service: serviceName } : {}),
  };
}

function extractErrorGroupId(detailLink: string | undefined): string | undefined {
  if (!detailLink) {
    return undefined;
  }
  try {
    const url = new URL(detailLink);
    const groupId =
      url.searchParams.get("groupId") ??
      url.searchParams.get("group") ??
      undefined;
    if (groupId) {
      return groupId;
    }
    const match = /groups\/([^/?#]+)/u.exec(url.pathname);
    if (match?.[1]) {
      return match[1];
    }
    const detailMatch = /errors\/detail\/([^/?#]+)/u.exec(url.pathname);
    if (detailMatch?.[1]) {
      return detailMatch[1];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function normalizeGcpWebhook(
  payload: unknown,
  _headers: Record<string, unknown> = {},
): NormalizedGcpWebhook | null {
  const source = isRecord(payload) ? payload : {};
  const { body, attributes } = unwrapPubSubEnvelope(source);

  return (
    normalizeMonitoringWebhook(body) ??
    normalizeBillingBudgetWebhook(body, attributes) ??
    normalizeCloudRunWebhook(body) ??
    normalizeErrorReportingWebhook(body) ??
    normalizeErrorLogSignal(body)
  );
}
