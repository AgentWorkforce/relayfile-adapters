import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WRITEBACK_PATH_CATALOG, writebackPath, WritebackPathError } from "../../src/index.js";
import {
  generateWritebackPathCatalog,
  renderWritebackPathCatalogModule,
  writebackPathCatalogPaths,
} from "../../src/writeback-paths/catalog-generator.js";
import { findRepoRoot } from "../../src/triggers/catalog-generator.js";

test("generated writeback-path catalog is in sync with adapter resources", async () => {
  const repoRoot = await findRepoRoot();
  const generation = await generateWritebackPathCatalog(repoRoot);
  const paths = writebackPathCatalogPaths(repoRoot);

  const catalogJson = JSON.parse(await readFile(paths.catalogJson, "utf8"));
  const withoutJson = JSON.parse(await readFile(paths.withoutJson, "utf8"));
  const catalogTs = await readFile(paths.catalogTs, "utf8");

  assert.deepEqual(catalogJson, generation.catalog);
  assert.deepEqual(withoutJson, generation.adaptersWithoutWritebackPaths);
  assert.equal(catalogTs, renderWritebackPathCatalogModule(generation));

  assert.deepEqual(WRITEBACK_PATH_CATALOG, generation.catalog);
});

test("linear/github/slack writeback templates match the canonical mount paths", () => {
  assert.equal(WRITEBACK_PATH_CATALOG.linear.comments.path, "/linear/issues/{issueId}/comments");
  assert.equal(
    WRITEBACK_PATH_CATALOG.github["issue-comments"].path,
    "/github/repos/{owner}/{repo}/issues/{issueNumber}/comments"
  );
  assert.equal(WRITEBACK_PATH_CATALOG.slack.messages.path, "/slack/channels/{channelId}/messages");
});

test("writebackPath substitutes and url-encodes params in template order", () => {
  assert.equal(writebackPath("linear", "comments", { issueId: "ISS-1" }), "/linear/issues/ISS-1/comments");
  assert.equal(
    writebackPath("github", "issue-comments", { owner: "AgentWorkforce", repo: "cloud", issueNumber: 1643 }),
    "/github/repos/AgentWorkforce/cloud/issues/1643/comments"
  );
  // Path segments are percent-encoded so identifiers round-trip safely.
  assert.equal(writebackPath("slack", "messages", { channelId: "C/1" }), "/slack/channels/C%2F1/messages");
});

test("writebackPath throws loudly rather than guessing", () => {
  assert.throws(() => writebackPath("nope" as never, "x" as never), WritebackPathError);
  assert.throws(() => writebackPath("linear", "nope" as never), WritebackPathError);
  // Missing a required param must fail, not emit a path with a literal `{issueId}`.
  assert.throws(() => writebackPath("linear", "comments", {}), WritebackPathError);
});
