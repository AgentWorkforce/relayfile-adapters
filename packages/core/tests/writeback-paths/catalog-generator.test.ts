import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WRITEBACK_PATH_CATALOG, readbackPath, writebackPath, WritebackPathError } from "../../src/index.js";
import {
  generateWritebackPathCatalog,
  renderWritebackPathCatalogModule,
  writebackPathCatalogPaths,
} from "../../src/writeback-paths/catalog-generator.js";
import { findRepoRoot } from "../../src/triggers/catalog-generator.js";

test("catalog preserves adapter-owned read paths and rejects mismatched parameters in built and source declarations", async (t) => {
  for (const built of [false, true]) for (const valid of [true, false]) {
    const root = await mkdtemp(join(tmpdir(), "readback-path-metadata-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "packages", "gitlab", built ? "dist" : "src");
    await mkdir(directory, { recursive: true });
    await writeFile(join(root, "packages", "gitlab", "package.json"), JSON.stringify({ name: "@relayfile/adapter-gitlab", type: "module" }));
    await writeFile(join(directory, built ? "resources.js" : "resources.ts"), `export const resources = [\n  {\n    name: "merge-requests",\n    path: "/gitlab/projects/{projectPath}/merge-requests",\n    readPath: "/gitlab/projects/{${valid ? "projectPath" : "other"}}/merge_requests",\n  },\n];\n`);
    if (valid) {
      const { catalog } = await generateWritebackPathCatalog(root);
      assert.equal((catalog.gitlab['merge-requests'][0] as { readPath?: string }).readPath,
        "/gitlab/projects/{projectPath}/merge_requests");
    } else {
      await assert.rejects(generateWritebackPathCatalog(root), /Invalid readPath/);
    }
  }
});

test("catalog preserves and validates multi-segment declarations from built and source resources", async (t) => {
  for (const built of [false, true]) for (const quote of ['"', "'"]) for (const valid of [true, false]) {
    const root = await mkdtemp(join(tmpdir(), "writeback-path-metadata-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "packages", "gitlab", built ? "dist" : "src");
    await mkdir(directory, { recursive: true });
    await writeFile(join(root, "packages", "gitlab", "package.json"), JSON.stringify({ name: "@relayfile/adapter-gitlab", type: "module" }));
    const file = join(directory, built ? "resources.js" : "resources.ts");
    await writeFile(file, `export const resources = [\n  {\n    name: "issues",\n    path: "/gitlab/projects/{projectPath}/issues",\n    multiSegmentParams: [${quote}${valid ? "projectPath" : "typo"}${quote},],\n  },\n];\n`);
    if (valid) {
      const { catalog } = await generateWritebackPathCatalog(root);
      assert.deepEqual(catalog.gitlab.issues[0].multiSegmentParams, ["projectPath"]);
    } else {
      await assert.rejects(generateWritebackPathCatalog(root), /Invalid multiSegmentParams/);
    }
    if (!built && valid) {
      const source = await readFile(file, "utf8");
      for (const expression of ["null", "projectParams", '"projectPath"']) {
        await writeFile(file, source.replace(/multiSegmentParams: \[[^\]]*\]/u, `multiSegmentParams : ${expression}`));
        await assert.rejects(generateWritebackPathCatalog(root), /must be a literal array/);
      }
    }
  }
});

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
  assert.equal(WRITEBACK_PATH_CATALOG.telegram.messages[0].path, "/telegram/chats/{chatId}/messages");
  assert.equal(WRITEBACK_PATH_CATALOG.telegram.reactions[0].path, "/telegram/chats/{chatId}/messages/{messageId}/reactions");
  assert.equal(Object.hasOwn(WRITEBACK_PATH_CATALOG.shortcut, "members"), false);
  assert.equal(Object.hasOwn(WRITEBACK_PATH_CATALOG.shortcut, "workflows"), false);
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
  assert.equal(writebackPath("telegram", "messages", { chatId: "C/1" }), "/telegram/chats/C%2F1/messages");
});

test("GitLab project parameters preserve namespace segments in canonical paths", () => {
  for (const projectPath of ["acme/web", "acme/platform/web", "acme/a b/web"]) {
    const root = `/gitlab/projects/${projectPath.split("/").map(encodeURIComponent).join("/")}`;
    assert.equal(writebackPath("gitlab", "issues", { projectPath }), `${root}/issues`);
    assert.equal(writebackPath("gitlab", "issues", { projectPath, issueIid: 42, slug: "hello world" }), `${root}/issues/42__hello%20world/meta.json`);
    assert.equal(writebackPath("gitlab", "comments", { projectPath, issueIid: 42, slug: "hello" }), `${root}/issues/42__hello/comments`);
  }
  for (const projectPath of ["/acme/web", "acme//web", "acme/../web", "acme/./web", "acme/web/"]) {
    assert.throws(() => writebackPath("gitlab", "issues", { projectPath }), WritebackPathError);
  }
});

test("readbackPath uses adapter read targets with the same variant selection and path validation", () => {
  for (const projectPath of ["acme/web", "acme/platform/web", "acme/a b/web"]) {
    const root = `/gitlab/projects/${projectPath.split("/").map(encodeURIComponent).join("/")}`;
    assert.equal(readbackPath("gitlab", "merge-requests", { projectPath }), `${root}/merge_requests`);
    assert.equal(writebackPath("gitlab", "merge-requests", { projectPath }), `${root}/merge-requests`);
    assert.equal(readbackPath("gitlab", "merge-requests", { projectPath, mergeRequestIid: 7, slug: "hello world" }),
      `${root}/merge_requests/7__hello%20world/meta.json`);
  }
  assert.equal(readbackPath("linear", "comments", { issueId: "ISS/1" }),
    writebackPath("linear", "comments", { issueId: "ISS/1" }));
  for (const projectPath of ["/acme/web", "acme//web", "acme/../web", "acme/./web", "acme/web/"]) {
    assert.throws(() => readbackPath("gitlab", "merge-requests", { projectPath }), WritebackPathError);
  }
  assert.throws(() => readbackPath("gitlab", "merge-requests", {}), WritebackPathError);
  assert.throws(() => readbackPath("gitlab", "merge-requests", { projectPath: "acme/web", unknown: 1 }), WritebackPathError);
  assert.throws(() => readbackPath("constructor", "x"), WritebackPathError);
});

test("writebackPath disambiguates multi-template resources by exact param set", () => {
  assert.equal(writebackPath("notion", "pages", { databaseId: "db1" }), "/notion/databases/db1/pages");
  assert.equal(
    writebackPath("notion", "pages", { databaseId: "db1", pageId: "p9" }),
    "/notion/databases/db1/pages/p9/meta.json"
  );
  assert.equal(writebackPath("notion", "pages", { pageId: "p9" }), "/notion/pages/p9/meta.json");
  assert.equal(
    writebackPath("telegram", "messages", { chatId: "C1", messageId: 42 }),
    "/telegram/chats/C1/messages/42.json"
  );
  // A param set matching no template must throw, never silently pick one.
  assert.throws(() => writebackPath("notion", "pages", { teamId: "t1" }), WritebackPathError);
});

test("writebackPath throws loudly rather than guessing", () => {
  assert.throws(() => writebackPath("nope" as never, "x" as never), WritebackPathError);
  assert.throws(() => writebackPath("linear", "nope" as never), WritebackPathError);
  for (const issueId of [".", ".."]) {
    assert.throws(() => writebackPath("linear", "comments", { issueId }), WritebackPathError);
  }
  // Missing a required param must fail, not emit a path with a literal `{issueId}`.
  assert.throws(() => writebackPath("linear", "comments", {}), WritebackPathError);
  // Prototype keys must not bypass the guard via Object.prototype.
  assert.throws(() => writebackPath("constructor", "x"), WritebackPathError);
  assert.throws(() => writebackPath("toString", "x"), WritebackPathError);
  assert.throws(() => writebackPath("linear", "hasOwnProperty"), WritebackPathError);
});
