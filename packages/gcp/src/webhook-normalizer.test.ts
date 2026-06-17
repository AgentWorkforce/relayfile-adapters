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

test("accepts an incident object at the top level (no envelope)", () => {
  const normalized = normalizeGcpWebhook({
    policy_name: "projects/demo/alertPolicies/flat",
    state: "open",
  });
  assert.equal(normalized?.objectId, "flat");
});

test("returns null for incomplete or non-incident payloads", () => {
  assert.equal(normalizeGcpWebhook({ incident: { state: "open" } }), null);
  assert.equal(normalizeGcpWebhook({ incident: { policy_name: "p/1", state: "unknown" } }), null);
  assert.equal(normalizeGcpWebhook("not-json"), null);
});
