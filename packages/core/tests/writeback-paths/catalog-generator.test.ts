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
  assert.equal(
    catalogTs.replace(/\r\n/g, "\n"),
    renderWritebackPathCatalogModule(generation).replace(/\r\n/g, "\n")
  );

  assert.deepEqual(WRITEBACK_PATH_CATALOG, generation.catalog);
});

test("linear/github/slack writeback templates match the canonical mount paths", () => {
  assert.equal(WRITEBACK_PATH_CATALOG.linear.comments[0].path, "/linear/issues/{issueId}/comments");
  assert.equal(
    WRITEBACK_PATH_CATALOG.github["issue-comments"][0].path,
    "/github/repos/{owner}/{repo}/issues/{issueNumber}/comments"
  );
  assert.equal(WRITEBACK_PATH_CATALOG.slack.messages[0].path, "/slack/channels/{channelId}/messages");
});

test("a resource name with multiple mount paths keeps every distinct template", () => {
  // notion `pages` is mounted at three distinct roots — none may be dropped.
  const paths = WRITEBACK_PATH_CATALOG.notion.pages.map((variant) => variant.path).sort();
  assert.deepEqual(paths, [
    "/notion/databases/{databaseId}/pages",
    "/notion/databases/{databaseId}/pages/{pageId}/meta.json",
    "/notion/pages/{pageId}/meta.json",
  ]);
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

test("writebackPath disambiguates multi-template resources by exact param set", () => {
  assert.equal(writebackPath("notion", "pages", { databaseId: "db1" }), "/notion/databases/db1/pages");
  assert.equal(
    writebackPath("notion", "pages", { databaseId: "db1", pageId: "p9" }),
    "/notion/databases/db1/pages/p9/meta.json"
  );
  assert.equal(writebackPath("notion", "pages", { pageId: "p9" }), "/notion/pages/p9/meta.json");
  // A param set matching no template must throw, never silently pick one.
  assert.throws(() => writebackPath("notion", "pages", { teamId: "t1" }), WritebackPathError);
});

test("writebackPath throws loudly rather than guessing", () => {
  assert.throws(() => writebackPath("nope" as never, "x" as never), WritebackPathError);
  assert.throws(() => writebackPath("linear", "nope" as never), WritebackPathError);
  // Missing a required param must fail, not emit a path with a literal `{issueId}`.
  assert.throws(() => writebackPath("linear", "comments", {}), WritebackPathError);
  // Prototype keys must not bypass the guard via Object.prototype.
  assert.throws(() => writebackPath("constructor", "x"), WritebackPathError);
  assert.throws(() => writebackPath("toString", "x"), WritebackPathError);
  assert.throws(() => writebackPath("linear", "hasOwnProperty"), WritebackPathError);
});
