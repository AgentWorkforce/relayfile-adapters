import assert from "node:assert/strict";
import test from "node:test";

import {
  computeGcpPath,
  gcpBillingPath,
  gcpCloudRunServiceByRegionAliasPath,
  gcpCloudRunServiceByStatusAliasPath,
  gcpCloudRunServicePath,
  gcpErrorGroupByServiceAliasPath,
  gcpErrorGroupByStatusAliasPath,
  gcpErrorGroupPath,
  gcpMonitoringAlertByStateAliasPath,
  gcpMonitoringAlertByTitleAliasPath,
  gcpMonitoringAlertPath,
  normalizeNangoGcpModel,
  parseGcpPath,
} from "./path-mapper.js";

test("GCP path helpers produce canonical resource paths", () => {
  assert.equal(gcpCloudRunServicePath("api"), "/gcp/run/services/api.json");
  assert.equal(gcpMonitoringAlertPath("policy-123"), "/gcp/monitoring/alerts/policy-123.json");
  assert.equal(gcpBillingPath(), "/gcp/billing/current.json");
  assert.equal(gcpErrorGroupPath("group-123"), "/gcp/error-reporting/groups/group-123.json");
});

test("computeGcpPath resolves supported object types", () => {
  assert.equal(computeGcpPath("cloud-run-service", "api"), "/gcp/run/services/api.json");
  assert.equal(computeGcpPath("monitoring-alert", "policy-123"), "/gcp/monitoring/alerts/policy-123.json");
  assert.equal(computeGcpPath("billing", "ignored"), "/gcp/billing/current.json");
  assert.equal(computeGcpPath("error-group", "group-123"), "/gcp/error-reporting/groups/group-123.json");
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
  assert.equal(
    computeGcpPath("GcpErrorGroup", "group/with/slashes"),
    "/gcp/error-reporting/groups/group%2Fwith%2Fslashes.json",
  );
});

test("GCP canonical paths round-trip through parseGcpPath", () => {
  assert.deepEqual(parseGcpPath(gcpCloudRunServicePath("api service")), {
    objectType: "cloud-run-service",
    id: "api service",
  });
  assert.deepEqual(parseGcpPath(gcpMonitoringAlertPath("policy/with/slashes")), {
    objectType: "monitoring-alert",
    id: "policy/with/slashes",
  });
  assert.deepEqual(parseGcpPath(gcpBillingPath()), {
    objectType: "billing",
    id: "current",
  });
  assert.deepEqual(parseGcpPath(gcpErrorGroupPath("group/with/slashes")), {
    objectType: "error-group",
    id: "group/with/slashes",
  });
});

test("GCP alias helpers use shared slug normalization and deterministic suffixes", () => {
  assert.equal(
    gcpCloudRunServiceByRegionAliasPath("US Central 1", "api"),
    "/gcp/run/services/by-region/us-central-1/api.json",
  );
  assert.equal(
    gcpCloudRunServiceByStatusAliasPath("not ready", "api"),
    "/gcp/run/services/by-status/not-ready/api.json",
  );
  assert.match(
    gcpMonitoringAlertByTitleAliasPath("Cloud Run 5xx ratio", "policy-123"),
    /^\/gcp\/monitoring\/alerts\/by-title\/cloud-run-5xx-ratio-[a-f0-9]{8}__policy-123\.json$/u,
  );
  assert.equal(
    gcpMonitoringAlertByStateAliasPath("Open", "policy-123"),
    "/gcp/monitoring/alerts/by-state/open/policy-123.json",
  );
  assert.equal(
    gcpErrorGroupByServiceAliasPath("NightCTO API", "group-1"),
    "/gcp/error-reporting/groups/by-service/nightcto-api/group-1.json",
  );
  assert.equal(
    gcpErrorGroupByStatusAliasPath("OPEN", "group-1"),
    "/gcp/error-reporting/groups/by-status/open/group-1.json",
  );
});

test("GCP title aliases remain distinct for display name collisions", () => {
  const first = gcpMonitoringAlertByTitleAliasPath("Same title", "policy-a");
  const second = gcpMonitoringAlertByTitleAliasPath("Same title", "policy-b");

  assert.notEqual(first, second);
  assert.match(first, /\/same-title-[a-f0-9]{8}__policy-a\.json$/u);
  assert.match(second, /\/same-title-[a-f0-9]{8}__policy-b\.json$/u);
});

test("normalizeNangoGcpModel accepts singular and plural GCP-prefixed models", () => {
  assert.equal(normalizeNangoGcpModel("GcpCloudRunService"), "cloud-run-service");
  assert.equal(normalizeNangoGcpModel("GcpCloudRunServices"), "cloud-run-service");
  assert.equal(normalizeNangoGcpModel("GcpMonitoringAlert"), "monitoring-alert");
  assert.equal(normalizeNangoGcpModel("GcpMonitoringAlerts"), "monitoring-alert");
  assert.equal(normalizeNangoGcpModel("GcpErrorGroup"), "error-group");
  assert.equal(normalizeNangoGcpModel("error-groups"), "error-group");
});

test("computeGcpPath rejects unsupported object types and empty ids", () => {
  assert.throws(() => computeGcpPath("bucket", "bucket-1"), /Unsupported GCP object type/u);
  assert.throws(() => computeGcpPath("cloud-run-service", " "), /GCP object id must be a non-empty string/u);
  assert.equal(parseGcpPath("/gcp/run/services/_index.json"), null);
});
