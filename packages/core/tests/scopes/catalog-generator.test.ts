import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADAPTERS_WITHOUT_KNOWN_SCOPES, KNOWN_SCOPE_CATALOG } from "../../src/index.js";
import {
  generateScopeCatalog,
  renderScopeCatalogModule,
  scopeCatalogPaths,
} from "../../src/scopes/catalog-generator.js";
import { findRepoRoot } from "../../src/triggers/catalog-generator.js";

test("generated scope catalog is in sync with adapter supportedScopes", async () => {
  const repoRoot = await findRepoRoot();
  const generation = await generateScopeCatalog(repoRoot);
  const paths = scopeCatalogPaths(repoRoot);

  const catalogJson = JSON.parse(await readFile(paths.catalogJson, "utf8"));
  const noScopeJson = JSON.parse(await readFile(paths.noScopeJson, "utf8"));
  const catalogTs = await readFile(paths.catalogTs, "utf8");

  assert.deepEqual(catalogJson, generation.catalog);
  assert.deepEqual(noScopeJson, generation.adaptersWithoutKnownScopes);
  assert.equal(catalogTs, renderScopeCatalogModule(generation));

  assert.deepEqual(KNOWN_SCOPE_CATALOG, generation.catalog);
  assert.deepEqual(ADAPTERS_WITHOUT_KNOWN_SCOPES, generation.adaptersWithoutKnownScopes);
});

test("github declares its connection scope keys (owner/repo)", () => {
  assert.deepEqual([...KNOWN_SCOPE_CATALOG.github], ["owner", "repo"]);
});
