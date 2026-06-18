import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudflareByIdAliasPath,
  cloudflareCollectionIndexPath,
  cloudflareRootIndexPath,
  computeCloudflarePath,
  computeCloudflarePathFromModel,
  normalizeNangoCloudflareModel,
} from "./path-mapper.js";
import type { CloudflarePathObjectType } from "./types.js";

test("cloudflare path helpers cover every canonical collection", () => {
  const cases: Array<[CloudflarePathObjectType, string]> = [
    ["worker-script", "/cloudflare/workers/scripts/_index.json"],
    ["worker-usage", "/cloudflare/analytics/workers/scripts/_index.json"],
    ["pages-project", "/cloudflare/pages/projects/_index.json"],
    ["d1-database", "/cloudflare/d1/databases/_index.json"],
    ["kv-namespace", "/cloudflare/kv/namespaces/_index.json"],
    ["r2-bucket", "/cloudflare/r2/buckets/_index.json"],
    ["queue", "/cloudflare/queues/_index.json"],
    ["tunnel", "/cloudflare/tunnels/_index.json"],
    ["zone", "/cloudflare/zones/_index.json"],
    ["notification-webhook", "/cloudflare/notifications/webhooks/_index.json"],
    ["notification-policy", "/cloudflare/notifications/policies/_index.json"],
    ["notification-event", "/cloudflare/notifications/events/_index.json"],
  ];

  assert.equal(cloudflareRootIndexPath(), "/cloudflare/_index.json");
  for (const [objectType, expected] of cases) {
    assert.equal(cloudflareCollectionIndexPath(objectType), expected);
  }
  assert.equal(
    cloudflareCollectionIndexPath("dns-record", { zoneId: "zone/1" }),
    "/cloudflare/zones/zone%2F1/dns-records/_index.json",
  );
});

test("cloudflare path helpers encode ids and zone context deterministically", () => {
  assert.equal(
    cloudflareByIdAliasPath("pages-project", "project with spaces"),
    "/cloudflare/pages/projects/by-id/project%20with%20spaces.json",
  );
  assert.equal(
    cloudflareByIdAliasPath("dns-record", "record/1", { zoneId: "zone/1" }),
    "/cloudflare/zones/zone%2F1/dns-records/by-id/record%2F1.json",
  );
  assert.equal(
    computeCloudflarePath("worker-script", "script/1"),
    "/cloudflare/workers/scripts/script%2F1.json",
  );
  assert.equal(
    computeCloudflarePath("dns-record", "record/1", { zoneId: "zone/1" }),
    "/cloudflare/zones/zone%2F1/dns-records/record%2F1.json",
  );
});

test("computeCloudflarePathFromModel normalizes sync model aliases", () => {
  assert.equal(
    computeCloudflarePathFromModel("CloudflareWorkerScript", "script-1"),
    "/cloudflare/workers/scripts/script-1.json",
  );
  assert.equal(
    computeCloudflarePathFromModel("workers-script", "script-2"),
    "/cloudflare/workers/scripts/script-2.json",
  );
  assert.equal(
    computeCloudflarePathFromModel("CloudflareDnsRecord", "record-1", { zoneId: "zone-1" }),
    "/cloudflare/zones/zone-1/dns-records/record-1.json",
  );
});

test("normalizeNangoCloudflareModel maps supported sync models", () => {
  assert.equal(normalizeNangoCloudflareModel("CloudflareWorkerUsage"), "worker-usage");
  assert.equal(normalizeNangoCloudflareModel("pages-project"), "pages-project");
  assert.equal(normalizeNangoCloudflareModel("CloudflareNotificationPolicy"), "notification-policy");
  assert.equal(normalizeNangoCloudflareModel("unknown"), null);
});

test("cloudflare path helpers reject missing dns zone context and unsupported models", () => {
  assert.throws(() => cloudflareCollectionIndexPath("dns-record"), /requires zoneId/u);
  assert.throws(
    () => cloudflareByIdAliasPath("dns-record", "record-1"),
    /requires zoneId/u,
  );
  assert.throws(
    () => computeCloudflarePath("dns-record", "record-1"),
    /requires zoneId/u,
  );
  assert.throws(
    () => computeCloudflarePathFromModel("unsupported", "record-1"),
    /Unsupported Cloudflare object type/u,
  );
});
