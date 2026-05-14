import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  LayoutManifest,
  LayoutManifestProvider,
  MaterializationMode,
} from "./layout-contract.js";

describe("layout manifest contract", () => {
  it("types provider manifests with eager and lazy resources", () => {
    const provider: LayoutManifestProvider = () => ({
      provider: "example",
      filenameConvention: "<slug>__<id>.json",
      aliasSegments: ["by-title"],
      resources: [
        {
          path: "example/pages",
          title: "Pages",
          materialization: "eager",
          aliasSegments: ["by-title"],
          writebackResources: [
            { path: "example/pages", schemaId: "example/page" },
          ],
        },
        {
          path: "example/users",
          title: "Users",
          materialization: "lazy",
          aliasSegments: [],
          writebackResources: [],
        },
      ],
    });

    const manifest = provider();
    const modes: readonly MaterializationMode[] = manifest.resources.map(
      (resource) => resource.materialization,
    );

    assert.equal(manifest.provider, "example");
    assert.deepEqual(modes, ["eager", "lazy"]);
  });

  it("accepts readonly manifest literals", () => {
    const manifest = {
      provider: "example",
      filenameConvention: "<id>__<slug>/meta.json",
      aliasSegments: ["by-name"],
      resources: [],
    } as const satisfies LayoutManifest;

    assert.equal(manifest.filenameConvention, "<id>__<slug>/meta.json");
  });
});
