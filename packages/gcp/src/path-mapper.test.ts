import assert from "node:assert/strict";
import test from "node:test";

import {
  computeGcpPath,
  gcpBillingPath,
  gcpCloudRunServicePath,
  gcpMonitoringAlertPath,
} from "./path-mapper.js";

test("GCP path helpers produce canonical resource paths", () => {
  assert.equal(gcpCloudRunServicePath("api"), "/gcp/run/services/api.json");
  assert.equal(gcpMonitoringAlertPath("policy-123"), "/gcp/monitoring/alerts/policy-123.json");
  assert.equal(gcpBillingPath(), "/gcp/billing/current.json");
});

test("computeGcpPath resolves supported object types", () => {
  assert.equal(computeGcpPath("cloud-run-service", "api"), "/gcp/run/services/api.json");
  assert.equal(computeGcpPath("monitoring-alert", "policy-123"), "/gcp/monitoring/alerts/policy-123.json");
  assert.equal(computeGcpPath("billing", "ignored"), "/gcp/billing/current.json");
});

test("computeGcpPath normalizes aliases and URL-encodes ids", () => {
  assert.equal(
    computeGcpPath("GcpCloudRunService", "svc with spaces"),
    "/gcp/run/services/svc%20with%20spaces.json",
  );
  assert.equal(
    computeGcpPath("GcpMonitoringAlert", "policy/with/slashes"),
    "/gcp/monitoring/alerts/policy%2Fwith%2Fslashes.json",
  );
});

test("computeGcpPath rejects unsupported object types and empty ids", () => {
  assert.throws(() => computeGcpPath("bucket", "bucket-1"), /Unsupported GCP object type/u);
  assert.throws(() => computeGcpPath("cloud-run-service", " "), /GCP object id must be a non-empty string/u);
});
