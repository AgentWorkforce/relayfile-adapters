import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudflareByIdAliasPath,
  cloudflareCollectionIndexPath,
  cloudflareRootIndexPath,
  computeCloudflarePath,
  computeCloudflarePathFromModel,
  cloudflareWorkerErrorRollupHour,
  cloudflareWorkerErrorRollupId,
  cloudflareWorkerErrorRollupPath,
  cloudflareWorkerErrorRollupRootIndexPath,
  cloudflareWorkerErrorRollupScriptIndexPath,
  normalizeNangoCloudflareModel,
  parseCloudflareWorkerErrorRollupId,
  parseCloudflareWorkerErrorRollupPath,
} from "./path-mapper.js";
import type { CloudflarePathObjectType } from "./types.js";

test("cloudflare path helpers cover every canonical collection", () => {
  const cases: Array<[CloudflarePathObjectType, string]> = [
    ["worker-script", "/cloudflare/workers/scripts/_index.json"],
    ["worker-usage", "/cloudflare/analytics/workers/scripts/_index.json"],
    ["worker-error-rollup", "/cloudflare/workers/errors/_index.json"],
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

test("worker error rollup paths round-trip through compose and parse", () => {
  const cases: Array<[string, string, string]> = [
    ["api-proxy", "2026-10-14T07:00:00.000Z", "/cloudflare/workers/errors/api-proxy/2026-10-14/07.json"],
    // Any instant inside the hour buckets to the UTC hour start.
    ["api-proxy", "2026-10-14T07:59:59.999Z", "/cloudflare/workers/errors/api-proxy/2026-10-14/07.json"],
    ["script/with space", "2026-01-02T23:15:00+00:00", "/cloudflare/workers/errors/script%2Fwith%20space/2026-01-02/23.json"],
  ];
  for (const [scriptName, hourStart, expected] of cases) {
    const path = cloudflareWorkerErrorRollupPath(scriptName, hourStart);
    assert.equal(path, expected);
    assert.equal(computeCloudflarePath("worker-error-rollup", scriptName, { hourStart }), expected);
    assert.equal(
      computeCloudflarePathFromModel("CloudflareWorkerErrorRollup", scriptName, { hourStart }),
      expected,
    );
    const parsed = parseCloudflareWorkerErrorRollupPath(path);
    assert.ok(parsed);
    assert.equal(parsed.scriptName, scriptName);
    assert.equal(parsed.hourStart, cloudflareWorkerErrorRollupHour(hourStart).hourStart);
    assert.equal(cloudflareWorkerErrorRollupPath(parsed.scriptName, parsed.hourStart), path);
  }
});

test("worker error rollups live under /cloudflare/workers/** without colliding with script inventory", () => {
  const rollup = cloudflareWorkerErrorRollupPath("scripts", "2026-10-14T07:00:00Z");
  assert.ok(rollup.startsWith("/cloudflare/workers/errors/"));
  assert.equal(rollup.startsWith("/cloudflare/workers/scripts/"), false);
  assert.equal(cloudflareWorkerErrorRollupRootIndexPath(), "/cloudflare/workers/errors/_index.json");
  assert.equal(cloudflareCollectionIndexPath("worker-error-rollup"), "/cloudflare/workers/errors/_index.json");
  assert.equal(
    cloudflareCollectionIndexPath("worker-error-rollup", { scriptName: "api/proxy" }),
    "/cloudflare/workers/errors/api%2Fproxy/_index.json",
  );
  assert.equal(
    cloudflareWorkerErrorRollupScriptIndexPath("api-proxy"),
    "/cloudflare/workers/errors/api-proxy/_index.json",
  );
  assert.equal(
    cloudflareWorkerErrorRollupId(" api-proxy ", "2026-10-14T07:42:00Z"),
    "api-proxy/2026-10-14T07:00:00.000Z",
  );
});

test("worker error rollup helpers reject malformed input", () => {
  assert.throws(() => computeCloudflarePath("worker-error-rollup", "api-proxy"), /requires hourStart/u);
  assert.throws(() => cloudflareWorkerErrorRollupPath("api-proxy", "not-a-date"), /not a valid date/u);
  assert.throws(() => cloudflareWorkerErrorRollupPath(" ", "2026-10-14T07:00:00Z"), /non-empty/u);
  assert.throws(() => cloudflareByIdAliasPath("worker-error-rollup", "x"), /no by-id alias/u);
  assert.equal(normalizeNangoCloudflareModel("CloudflareWorkerErrorRollup"), "worker-error-rollup");
  assert.equal(normalizeNangoCloudflareModel("worker_error_rollup"), "worker-error-rollup");
  assert.equal(parseCloudflareWorkerErrorRollupPath("/cloudflare/workers/errors/api-proxy/_index.json"), null);
  assert.equal(parseCloudflareWorkerErrorRollupPath("/cloudflare/workers/errors/api-proxy/2026-10-14/24.json"), null);
  assert.equal(parseCloudflareWorkerErrorRollupPath("/cloudflare/workers/errors/api-proxy/2026-02-30/01.json"), null);
  assert.equal(parseCloudflareWorkerErrorRollupPath("/cloudflare/workers/scripts/api-proxy.json"), null);
  // Only canonical encodings parse, so parse is a true inverse of compose.
  assert.equal(parseCloudflareWorkerErrorRollupPath("/cloudflare/workers/errors/%20api/2026-10-14/07.json"), null);
  assert.equal(parseCloudflareWorkerErrorRollupPath("/cloudflare/workers/errors/api%2fproxy/2026-10-14/07.json"), null);
  assert.ok(parseCloudflareWorkerErrorRollupPath("/cloudflare/workers/errors/api%2Fproxy/2026-10-14/07.json"));
});

test("worker error rollup ids round-trip and locate tombstones", () => {
  const id = cloudflareWorkerErrorRollupId("api-proxy", "2026-10-14T07:42:00Z");
  assert.deepEqual(parseCloudflareWorkerErrorRollupId(id), {
    scriptName: "api-proxy",
    hourStart: "2026-10-14T07:00:00.000Z",
  });
  assert.deepEqual(parseCloudflareWorkerErrorRollupId("ns/script/2026-10-14T07:00:00.000Z"), {
    scriptName: "ns/script",
    hourStart: "2026-10-14T07:00:00.000Z",
  });
  for (const bad of ["api-proxy", "/2026-10-14T07:00:00.000Z", "api-proxy/2026-10-14T07:30:00.000Z", "api-proxy/nope"]) {
    assert.equal(parseCloudflareWorkerErrorRollupId(bad), null, bad);
  }
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
