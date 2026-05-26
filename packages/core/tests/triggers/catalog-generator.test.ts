import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADAPTERS_WITHOUT_KNOWN_TRIGGERS, KNOWN_TRIGGER_CATALOG } from "../../src/index.js";
import {
  findRepoRoot,
  generateTriggerCatalog,
  renderTriggerCatalogModule,
  triggerCatalogPaths,
} from "../../src/triggers/catalog-generator.js";

test("generated trigger catalog is in sync with adapter supportedEvents", async () => {
  const repoRoot = await findRepoRoot();
  const generation = await generateTriggerCatalog(repoRoot);
  const paths = triggerCatalogPaths(repoRoot);

  const catalogJson = JSON.parse(await readFile(paths.catalogJson, "utf8"));
  const noEventJson = JSON.parse(await readFile(paths.noEventJson, "utf8"));
  const catalogTs = await readFile(paths.catalogTs, "utf8");

  assert.deepEqual(catalogJson, generation.catalog);
  assert.deepEqual(noEventJson, generation.adaptersWithoutKnownTriggers);
  assert.equal(catalogTs, renderTriggerCatalogModule(generation));

  assert.deepEqual(KNOWN_TRIGGER_CATALOG, generation.catalog);
  assert.deepEqual(ADAPTERS_WITHOUT_KNOWN_TRIGGERS, generation.adaptersWithoutKnownTriggers);

  const coveredPackagePaths = new Set([
    ...generation.sources.map((source) => source.packagePath),
    ...generation.adaptersWithoutKnownTriggers.map((adapter) => adapter.packagePath),
  ]);
  assert.equal(
    coveredPackagePaths.size,
    generation.sources.length + generation.adaptersWithoutKnownTriggers.length
  );
});

test("catalog preserves provider-specific event names verbatim", () => {
  assert.ok(KNOWN_TRIGGER_CATALOG.github.includes("pull_request.opened"));
  assert.ok(KNOWN_TRIGGER_CATALOG.github.includes("issues.labeled"));
  assert.ok(KNOWN_TRIGGER_CATALOG.gitlab.includes("note.MergeRequest"));
  assert.ok(KNOWN_TRIGGER_CATALOG.linear.includes("issue.create"));
  assert.ok(KNOWN_TRIGGER_CATALOG.salesforce.includes("Account.created"));
  assert.ok(KNOWN_TRIGGER_CATALOG.slack.includes("message.created"));
  assert.ok(KNOWN_TRIGGER_CATALOG.stripe.includes("invoice.paid"));
  assert.ok(KNOWN_TRIGGER_CATALOG.fathom.includes("new-meeting-content-ready"));
  assert.ok(KNOWN_TRIGGER_CATALOG.notion.includes("page.created"));
  assert.ok(KNOWN_TRIGGER_CATALOG.notion.includes("database.schema_updated"));
});
