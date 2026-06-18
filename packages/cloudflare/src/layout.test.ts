import assert from "node:assert/strict";
import test from "node:test";

import { layoutManifest } from "./layout.js";

test("layoutManifest advertises Cloudflare read-only resources including zone-scoped DNS", () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, "cloudflare");
  assert.deepEqual(manifest.aliasSegments, ["by-id"]);
  assert.deepEqual(
    manifest.resources.map((resource) => ({
      path: resource.path,
      aliasSegments: resource.aliasSegments,
      materialization: resource.materialization,
      writebackResources: resource.writebackResources,
    })),
    [
      { path: "cloudflare/workers/scripts", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/analytics/workers/scripts", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/pages/projects", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/d1/databases", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/kv/namespaces", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/r2/buckets", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/queues", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/tunnels", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/zones", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/zones/*/dns-records", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/notifications/webhooks", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/notifications/policies", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
      { path: "cloudflare/notifications/events", aliasSegments: ["by-id"], materialization: "lazy", writebackResources: [] },
    ],
  );
});
