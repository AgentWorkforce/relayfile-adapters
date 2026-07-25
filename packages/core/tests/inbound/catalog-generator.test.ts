import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INBOUND_CAPABILITY_CATALOG,
  INBOUND_CAPABILITY_CATALOG_VERSION,
} from "../../src/inbound/index.js";
import {
  generateInboundCapabilityCatalog,
  inboundCapabilityCatalogPaths,
  renderInboundCapabilityCatalogModule,
} from "../../src/inbound/catalog-generator.js";
import { findRepoRoot } from "../../src/triggers/catalog-generator.js";

test("generated inbound capability catalog is in sync with adapter declarations", async () => {
  const repoRoot = await findRepoRoot();
  const generation = await generateInboundCapabilityCatalog(repoRoot);
  const paths = inboundCapabilityCatalogPaths(repoRoot);

  const catalogJson = JSON.parse(await readFile(paths.catalogJson, "utf8"));
  const catalogTs = await readFile(paths.catalogTs, "utf8");

  assert.deepEqual(catalogJson, {
    schema: "relayfile.inbound-capability-catalog/1",
    catalogVersion: generation.catalogVersion,
    capabilities: generation.catalog,
  });
  assert.equal(catalogTs, renderInboundCapabilityCatalogModule(generation));
  assert.deepEqual(INBOUND_CAPABILITY_CATALOG, generation.catalog);
  assert.equal(INBOUND_CAPABILITY_CATALOG_VERSION, generation.catalogVersion);

  assert.deepEqual(
    generation.sources.map((source) => source.providerId),
    ["github", "gitlab", "gmail", "hubspot", "linear", "notion", "slack"],
  );
});
