import assert from "node:assert/strict";
import test from "node:test";

import { layoutManifest } from "./layout.js";

test("layoutManifest exposes GCP resources as read-only lazy materialization targets", () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, "gcp");
  assert.deepEqual(manifest.aliasSegments, [
    "by-id",
    "by-region",
    "by-service",
    "by-state",
    "by-status",
    "by-title",
  ]);
  assert.deepEqual(
    manifest.resources.map((resource) => ({
      path: resource.path,
      materialization: resource.materialization,
      aliasSegments: resource.aliasSegments,
      writebackResources: resource.writebackResources,
    })),
    [
      {
        path: "gcp/run/services",
        materialization: "lazy",
        aliasSegments: ["by-id", "by-region", "by-status"],
        writebackResources: [],
      },
      {
        path: "gcp/monitoring/alerts",
        materialization: "lazy",
        aliasSegments: ["by-id", "by-title", "by-state"],
        writebackResources: [],
      },
      {
        path: "gcp/billing",
        materialization: "lazy",
        aliasSegments: [],
        writebackResources: [],
      },
      {
        path: "gcp/error-reporting/groups",
        materialization: "lazy",
        aliasSegments: ["by-id", "by-service", "by-status"],
        writebackResources: [],
      },
    ],
  );
});
