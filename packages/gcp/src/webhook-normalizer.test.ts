import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGcpWebhook } from "./webhook-normalizer.js";

test("normalizes a firing (open) GCP Monitoring incident", () => {
  const normalized = normalizeGcpWebhook({
    incident: {
      incident_id: "0.abc",
      policy_name: "projects/demo/alertPolicies/12345",
      condition_name: "Cloud Run 5xx ratio",
      state: "open",
      started_at: 1_718_000_000,
      resource_name: "demo Cloud Run service api",
    },
  });

  assert.deepEqual(normalized, {
    provider: "gcp",
    eventType: "monitoring.incident.open",
    objectType: "monitoring-alert",
    objectId: "12345",
    policyId: "12345",
    displayName: "projects/demo/alertPolicies/12345",
    conditionName: "Cloud Run 5xx ratio",
    resourceName: "demo Cloud Run service api",
    state: "open",
    firing: true,
    timestamp: new Date(1_718_000_000 * 1000).toISOString(),
    payload: {
      incident: {
        incident_id: "0.abc",
        policy_name: "projects/demo/alertPolicies/12345",
        condition_name: "Cloud Run 5xx ratio",
        state: "open",
        started_at: 1_718_000_000,
        resource_name: "demo Cloud Run service api",
      },
    },
    fileEventType: "file.created",
    shouldDelete: false,
    path: "/gcp/monitoring/alerts/12345.json",
  });
});

test("normalizes a resolved (closed) GCP Monitoring incident as an update", () => {
  const normalized = normalizeGcpWebhook({
    incident: {
      policy_name: "projects/demo/alertPolicies/67890",
      state: "closed",
      ended_at: 1_718_100_000,
    },
  });

  assert.equal(normalized?.eventType, "monitoring.incident.closed");
  assert.equal(normalized?.state, "closed");
  assert.equal(normalized?.firing, false);
  assert.equal(normalized?.fileEventType, "file.updated");
  assert.equal(normalized?.policyId, "67890");
  assert.equal(normalized?.path, "/gcp/monitoring/alerts/67890.json");
});

test("decodes Pub/Sub push envelopes before normalizing the incident", () => {
  const data = Buffer.from(JSON.stringify({
    incident: {
      policy_name: "projects/demo/alertPolicies/pubsub-policy",
      state: "open",
      started_at: 1_718_000_000,
    },
  })).toString("base64");

  const normalized = normalizeGcpWebhook({
    message: {
      data,
      messageId: "pubsub-message-1",
    },
    subscription: "projects/demo/subscriptions/alerts",
  });

  assert.equal(normalized?.policyId, "pubsub-policy");
  assert.equal(normalized?.eventType, "monitoring.incident.open");
  assert.deepEqual(normalized?.payload, {
    incident: {
      policy_name: "projects/demo/alertPolicies/pubsub-policy",
      state: "open",
      started_at: 1_718_000_000,
    },
  });
});

test("accepts an incident object at the top level (no envelope)", () => {
  const normalized = normalizeGcpWebhook({
    policy_name: "projects/demo/alertPolicies/flat",
    state: "open",
  });
  assert.equal(normalized?.objectId, "flat");
});

test("normalizes Cloud Billing budget Pub/Sub notifications", () => {
  const data = Buffer.from(JSON.stringify({
    budgetDisplayName: "NightCTO Budget",
    costAmount: 141.23,
    budgetAmount: 200,
    currencyCode: "USD",
  })).toString("base64");

  const normalized = normalizeGcpWebhook({
    message: {
      attributes: {
        billingAccountId: "01D4EE-079462-DFD6EC",
        budgetId: "budget-123",
      },
      data,
    },
  });

  assert.equal(normalized?.eventType, "billing.budget.alert");
  assert.equal(normalized?.objectType, "billing");
  assert.equal(normalized?.path, "/gcp/billing/current.json");
  assert.deepEqual(normalized?.syncNames, ["fetch-billing"]);
});

test("normalizes Cloud Run audit log create events", () => {
  const normalized = normalizeGcpWebhook({
    protoPayload: {
      serviceName: "run.googleapis.com",
      methodName: "google.cloud.run.v2.Services.CreateService",
      resourceName: "projects/demo/locations/us-central1/services/api",
    },
    resource: {
      type: "cloud_run_revision",
      labels: {
        service_name: "api",
        location: "us-central1",
      },
    },
  });

  assert.equal(normalized?.eventType, "cloud-run.service.created");
  assert.equal(normalized?.objectType, "cloud-run-service");
  assert.equal(normalized?.path, "/gcp/run/services/api.json");
  assert.deepEqual(normalized?.syncNames, ["fetch-cloud-run"]);
});

test("normalizes Error Reporting native webhook payloads", () => {
  const normalized = normalizeGcpWebhook({
    version: "1.0",
    subject: "Reopened error group: TypeError",
    group_info: {
      project_id: "nightcto-production",
      detail_link: "https://console.cloud.google.com/errors/detail/abc123?project=nightcto-production",
    },
    exception_info: {
      type: "TypeError",
      message: "undefined is not a function",
    },
    event_info: {
      service: "nightcto-production-api",
      version: "2026-06-17",
    },
  });

  assert.equal(normalized?.eventType, "error-reporting.group.reopened");
  assert.equal(normalized?.objectType, "error-group");
  assert.deepEqual(normalized?.syncNames, ["fetch-error-groups"]);
});

test("normalizes Cloud Run error log signals into Error Reporting refreshes", () => {
  const normalized = normalizeGcpWebhook({
    severity: "ERROR",
    resource: {
      type: "cloud_run_revision",
      labels: {
        service_name: "nightcto-production-api",
      },
    },
    textPayload: "Unhandled exception",
  });

  assert.equal(normalized?.eventType, "error-reporting.event.logged");
  assert.equal(normalized?.objectType, "error-group");
  assert.equal(normalized?.path, "/gcp/error-reporting/groups/_index.json");
  assert.deepEqual(normalized?.syncNames, ["fetch-error-groups"]);
});

test("returns null for incomplete or non-incident payloads", () => {
  assert.equal(normalizeGcpWebhook({ incident: { state: "open" } }), null);
  assert.equal(normalizeGcpWebhook({ incident: { policy_name: "p/1", state: "unknown" } }), null);
  assert.equal(normalizeGcpWebhook({ incident: { incident_id: "0.abc", state: "open" } }), null);
  assert.equal(normalizeGcpWebhook("not-json"), null);
});
