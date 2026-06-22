import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADAPTERS_WITHOUT_KNOWN_SCOPE_KEYS, KNOWN_SCOPE_KEY_CATALOG } from "../../src/index.js";
import {
  generateScopeKeyCatalog,
  renderScopeKeyCatalogModule,
  scopeKeyCatalogPaths,
} from "../../src/scope-keys/catalog-generator.js";
import { findRepoRoot } from "../../src/triggers/catalog-generator.js";

test("generated scope catalog is in sync with adapter supportedScopes", async () => {
  const repoRoot = await findRepoRoot();
  const generation = await generateScopeKeyCatalog(repoRoot);
  const paths = scopeKeyCatalogPaths(repoRoot);

  const catalogJson = JSON.parse(await readFile(paths.catalogJson, "utf8"));
  const noScopeJson = JSON.parse(await readFile(paths.noScopeKeyJson, "utf8"));
  const catalogTs = await readFile(paths.catalogTs, "utf8");

  assert.deepEqual(catalogJson, generation.catalog);
  assert.deepEqual(noScopeJson, generation.adaptersWithoutKnownScopeKeys);
  assert.equal(catalogTs, renderScopeKeyCatalogModule(generation));

  assert.deepEqual(KNOWN_SCOPE_KEY_CATALOG, generation.catalog);
  assert.deepEqual(ADAPTERS_WITHOUT_KNOWN_SCOPE_KEYS, generation.adaptersWithoutKnownScopeKeys);
});

test("github declares its connection scope keys (owner/repo)", () => {
  assert.deepEqual([...KNOWN_SCOPE_KEY_CATALOG.github], ["owner", "repo"]);
});

test("telegram declares chat-oriented connection scope keys", () => {
  assert.deepEqual([...KNOWN_SCOPE_KEY_CATALOG.telegram], ["chatId", "messageThreadId", "userId"]);
});
